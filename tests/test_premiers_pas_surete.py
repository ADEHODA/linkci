"""Premiers pas, badge etudiant verifie, faux profils signales, qui peut voir ma photo."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_premiers_pas(client):
    tok = compte(client, 'pp.a@test.ci')
    assert client.get('/api/me', headers=entete(tok)).get_json()['premiers_pas_fini'] is False
    client.post('/api/premiers_pas/fini', headers=entete(tok))
    assert client.get('/api/me', headers=entete(tok)).get_json()['premiers_pas_fini'] is True


def test_verification_email_universitaire(client):
    a, b = compte(client, 'ver2.a@test.ci'), compte(client, 'ver2.b@test.ci')
    ida = uid(client, a)
    assert client.post('/api/verification/email', json={'email': 'moi@gmail.com'}, headers=entete(a)).status_code == 400
    assert client.post('/api/verification/email', json={'email': 'awa.kone@etu.univ.edu.ci'}, headers=entete(a)).status_code == 200
    assert client.post('/api/verification/code', json={'code': '000000x'}, headers=entete(a)).status_code == 400
    code = sql('SELECT code FROM codes_etudiant WHERE user_id = ?', (ida,))[0]['code']
    assert client.post('/api/verification/code', json={'code': code}, headers=entete(a)).get_json()['verifie']
    assert client.get(f'/api/profil/{ida}', headers=entete(b)).get_json()['user']['verifie'] == 1
    # la meme adresse ne peut pas verifier un 2e compte
    assert client.post('/api/verification/email', json={'email': 'awa.kone@etu.univ.edu.ci'}, headers=entete(b)).status_code == 409
    assert client.post('/api/verification/email', json={'email': 'x@inphb.ci'}, headers=entete(b)).status_code == 200
    # l'admin seulement peut donner le badge
    assert client.post(f'/api/admin/utilisateurs/{ida}/verifier', headers=entete(b)).status_code in (401, 403)


def test_signaler_profil(client):
    a, b = compte(client, 'sp.a@test.ci'), compte(client, 'sp.b@test.ci')
    idb = uid(client, b)
    assert client.post(f'/api/utilisateurs/{idb}/signaler', json={'motif': 'nimporte'}, headers=entete(a)).status_code == 400
    assert client.post(f'/api/utilisateurs/{idb}/signaler', json={'motif': 'Faux profil ou usurpation'}, headers=entete(a)).status_code == 200
    client.post(f'/api/utilisateurs/{idb}/signaler', json={'motif': 'Arnaque'}, headers=entete(a))  # une seule fois par personne
    assert sql('SELECT COUNT(*) AS n FROM signalements_profils WHERE profil_id = ?', (idb,))[0]['n'] == 1
    assert client.post(f'/api/utilisateurs/{uid(client, a)}/signaler', json={'motif': 'Arnaque'}, headers=entete(a)).status_code == 400


def test_photo_privee(client):
    a, b, c = compte(client, 'ph.a@test.ci'), compte(client, 'ph.b@test.ci'), compte(client, 'ph.c@test.ci')
    ida, idb, idc = uid(client, a), uid(client, b), uid(client, c)
    sql('UPDATE users SET avatar = ? WHERE id = ?', ('photo_a.png', ida))
    voir = lambda tok: client.get(f'/api/profil/{ida}', headers=entete(tok)).get_json()['user']['avatar']
    assert voir(b) == 'photo_a.png'
    client.put('/api/parametres', json={'photo_visible': 'suivis'}, headers=entete(a))
    client.post(f'/api/utilisateurs/{idb}/suivre', headers=entete(a))  # a suit b : b peut voir la photo
    assert voir(b) == 'photo_a.png' and voir(c) is None
    assert voir(a) == 'photo_a.png'  # toujours visible pour soi
    client.post('/api/posts', json={'contenu': 'Photo privee ?'}, headers=entete(a))
    posts = [p for p in client.get('/api/posts', headers=entete(c)).get_json() if p['user_id'] == ida]
    assert posts and posts[0]['avatar'] is None
    client.put('/api/parametres', json={'photo_visible': 'personne'}, headers=entete(a))
    assert voir(b) is None
    client.put('/api/parametres', json={'photo_visible': 'tous'}, headers=entete(a))
    assert voir(c) == 'photo_a.png'
