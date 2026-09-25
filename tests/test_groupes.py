"""Groupes 2.0 : photos, vocaux, mentions, admin de groupe, suggestions."""
import base64
import io
import app as linkci_app
from test_securite import sql, entete

PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


def compte(client, email, prenom, universite='', filiere=''):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': prenom, 'email': email, 'mot_de_passe': 'motdepasse123',
                                              'universite': universite, 'filiere': filiere}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_messages_riches_et_mentions(client):
    tok_a, id_a = compte(client, 'grp.a@test.ci', 'Kofi')
    tok_b, id_b = compte(client, 'grp.b@test.ci', 'Awa')
    gid = client.post('/api/groupes', json={'nom': 'Promo test'}, headers=entete(tok_a)).get_json()['id']
    client.post(f'/api/groupes/{gid}/rejoindre', headers=entete(tok_b))
    assert client.post(f'/api/groupes/{gid}/messages', json={'image': PNG}, headers=entete(tok_b)).status_code == 201
    assert client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'Salut @Awa, tu viens ?'}, headers=entete(tok_a)).status_code == 201
    m4a = b'\x00\x00\x00\x1cftypM4A \x00\x00\x02\x00' + b'\x00' * 100
    r = client.post(f'/api/groupes/{gid}/vocal', headers=entete(tok_a), content_type='multipart/form-data',
                    data={'duree': '4', 'audio': (io.BytesIO(m4a), 'n.m4a')})
    assert r.status_code == 201
    msgs = client.get(f'/api/groupes/{gid}/messages', headers=entete(tok_b)).get_json()
    assert msgs[0]['image'] and msgs[-1]['audio'] and msgs[-1]['duree'] == 4
    notif = sql("SELECT message FROM notifications WHERE user_id = ? AND type = 'mention'", (id_b,))
    assert notif and 'Kofi' in notif[0]['message']


def test_admin_de_groupe(client):
    tok_a, id_a = compte(client, 'adm.a@test.ci', 'Admin')
    tok_b, id_b = compte(client, 'adm.b@test.ci', 'Membre')
    gid = client.post('/api/groupes', json={'nom': 'Groupe gere'}, headers=entete(tok_a)).get_json()['id']
    client.post(f'/api/groupes/{gid}/rejoindre', headers=entete(tok_b))
    # un membre ne peut ni modifier ni retirer
    assert client.put(f'/api/groupes/{gid}', json={'nom': 'Pirate'}, headers=entete(tok_b)).status_code == 403
    assert client.post(f'/api/groupes/{gid}/membres/{id_a}/retirer', headers=entete(tok_b)).status_code == 403
    assert client.put(f'/api/groupes/{gid}', json={'nom': 'Nouveau nom'}, headers=entete(tok_a)).status_code == 200
    mid = client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'hors sujet'}, headers=entete(tok_b)).get_json()['id']
    assert client.delete(f'/api/groupes/{gid}/messages/{mid}', headers=entete(tok_a)).status_code == 200  # l'admin modere
    infos = client.get(f'/api/groupes/{gid}/membres', headers=entete(tok_a)).get_json()
    assert infos['je_suis_admin'] and infos['groupe']['nom'] == 'Nouveau nom' and len(infos['membres']) == 2
    # l'admin quitte : le membre restant devient admin
    client.post(f'/api/groupes/{gid}/quitter', headers=entete(tok_a))
    assert client.get(f'/api/groupes/{gid}/membres', headers=entete(tok_b)).get_json()['je_suis_admin'] is True
    assert client.post(f'/api/groupes/{gid}/membres/{id_b}/retirer', headers=entete(tok_b)).status_code == 400  # pas soi-meme


def test_suggestions(client):
    tok_a, _ = compte(client, 'sug.a@test.ci', 'A', 'INP-HB', 'Genie civil')
    tok_b, _ = compte(client, 'sug.b@test.ci', 'B', 'INP-HB', 'Genie civil')
    r = client.get('/api/groupes', headers=entete(tok_a)).get_json()
    assert r['a_creer'] and 'Genie civil' in r['a_creer']['nom']
    client.post('/api/groupes', json={'nom': r['a_creer']['nom'], 'universite': 'INP-HB', 'filiere': 'Genie civil'}, headers=entete(tok_a))
    r = client.get('/api/groupes', headers=entete(tok_b)).get_json()
    assert r['a_creer'] is None and r['tous_groupes'][0]['suggere'] is True
