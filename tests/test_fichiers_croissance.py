"""Fichiers dans les discussions ; page d'accueil, apercu des liens, invitation de groupe."""
import io
import app as linkci_app
from test_securite import sql, entete

PDF = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'


def compte(client, email, **extra):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123', **extra}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def envoyer(client, url, tok, contenu, nom, **champs):
    return client.post(url, headers=entete(tok), content_type='multipart/form-data',
                       data={**champs, 'fichier': (io.BytesIO(contenu), nom)})


def test_fichier_prive_et_groupe(client):
    a, b, c = compte(client, 'fi.a@test.ci'), compte(client, 'fi.b@test.ci'), compte(client, 'fi.c@test.ci')
    ida, idb = uid(client, a), uid(client, b)
    # faux PDF, format interdit
    assert envoyer(client, '/api/messages/fichier', a, b'MZ\x90\x00 pas un pdf', 'cours.pdf', destinataire_id=idb).status_code == 400
    assert envoyer(client, '/api/messages/fichier', a, b'<script>', 'page.html', destinataire_id=idb).status_code == 400
    r = envoyer(client, '/api/messages/fichier', a, PDF, 'Cours algo chap 2.pdf', destinataire_id=idb)
    assert r.status_code == 201, r.get_json()
    mid = r.get_json()['id']
    m = {x['id']: x for x in client.get(f'/api/messages?avec={ida}', headers=entete(b)).get_json()}[mid]
    assert m['fichier_nom'] == 'Cours algo chap 2.pdf' and m['fichier_taille'] == len(PDF) and m['fichier'].endswith('.pdf')
    convs = {cv['autre_id']: cv for cv in client.get('/api/conversations', headers=entete(b)).get_json()}
    assert convs[ida]['dernier_message'] == '📎 Cours algo chap 2.pdf'
    # telechargement sous son vrai nom
    t = client.get(f"/f/{m['fichier']}?n=Cours algo chap 2.pdf")
    assert t.status_code == 200 and t.data == PDF and 'Cours algo chap 2.pdf' in t.headers['Content-Disposition']
    t.close()  # Windows : un fichier encore ouvert ne peut pas etre efface
    assert client.get('/f/..%2Fapp.py').status_code == 404
    # reponse citant le fichier
    r2 = client.post('/api/messages', json={'destinataire_id': ida, 'contenu': 'Merci !', 'reponse_a': mid}, headers=entete(b)).get_json()['id']
    assert {x['id']: x for x in client.get(f'/api/messages?avec={idb}', headers=entete(a)).get_json()}[r2]['reponse']['extrait'] == '📎 Cours algo chap 2.pdf'
    # supprime pour tous : le fichier disparait
    client.delete(f'/api/messages/{mid}', headers=entete(a))
    assert client.get(f"/f/{m['fichier']}").status_code == 404
    # groupe
    gid = client.post('/api/groupes', json={'nom': 'Groupe fichiers test', 'description': 'x'}, headers=entete(a)).get_json()['id']
    assert envoyer(client, f'/api/groupes/{gid}/fichier', c, PDF, 'td.pdf').status_code == 403
    assert envoyer(client, f'/api/groupes/{gid}/fichier', a, PDF, 'td.pdf').status_code == 201
    assert client.get(f'/api/groupes/{gid}/messages', headers=entete(a)).get_json()[-1]['fichier_nom'] == 'td.pdf'


def test_accueil_apercu_et_invitation_groupe(client):
    r = client.get('/')
    assert r.status_code == 200 and b'og:image' in r.data and b'partage.png' in r.data
    a = compte(client, 'inv.a@test.ci')
    gid = client.post('/api/groupes', json={'nom': 'Promo Droit L1', 'description': 'Groupe de promo'}, headers=entete(a)).get_json()['id']
    page = client.get(f'/g/{gid}')  # visiteur non connecte
    assert page.status_code == 200 and 'Promo Droit L1'.encode() in page.data and b'og:title' in page.data
    assert f'/inscription?suivant=/g/{gid}'.encode() in page.data
    assert client.get('/g/999999').status_code == 302
    # lien d'invitation personnel : "Prenom t'invite"
    code = client.get('/api/invitations', headers=entete(a)).get_json()['code']
    ins = client.get(f'/inscription?invite={code}')
    assert b"t&#39;invite" in ins.data or b"t'invite" in ins.data


def test_chemin_suivant():
    assert linkci_app.chemin_suivant('/g/12') == '/g/12'
    assert linkci_app.chemin_suivant('//evil.com') is None
    assert linkci_app.chemin_suivant('https://evil.com') is None
    assert linkci_app.chemin_suivant('/\tevil') is None
