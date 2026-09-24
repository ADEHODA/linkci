"""Verification de l'e-mail, signalements et blocages."""
import re
import pytest
import app as linkci_app
from test_securite import sql, entete


@pytest.fixture
def verif(client, monkeypatch):
    """Active la verification et capture les e-mails au lieu de les envoyer."""
    linkci_app.app.config['VERIFIER_EMAIL'] = True
    boite = []
    monkeypatch.setattr(linkci_app, 'envoyer_email', lambda a, sujet, texte: boite.append((a, sujet, texte)) or True)
    linkci_app.rate_limits.clear()
    yield boite
    linkci_app.app.config['VERIFIER_EMAIL'] = False


def dernier_code(boite):
    return re.search(r'\b(\d{6})\b', boite[-1][2]).group(1)


def inscrire_api(client, email, mdp='motdepasse123'):
    return client.post('/api/register', json={'nom': 'Kone', 'prenom': 'Awa', 'email': email, 'mot_de_passe': mdp})


def test_inscription_api_sans_jeton_avant_verification(client, verif):
    r = inscrire_api(client, 'awa@test.ci')
    assert r.status_code == 201 and r.get_json()['a_verifier'] and 'token' not in r.get_json()
    assert verif[-1][0] == 'awa@test.ci'
    # connexion refusee tant que le code n'est pas saisi
    r = client.post('/api/login', json={'email': 'awa@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert r.status_code == 403 and r.get_json()['a_verifier']


def test_bon_code_donne_un_jeton(client, verif):
    inscrire_api(client, 'bon@test.ci')
    r = client.post('/api/verifier_email', json={'email': 'bon@test.ci', 'code': dernier_code(verif)})
    assert r.status_code == 200 and r.get_json()['token']
    assert client.get('/api/me', headers=entete(r.get_json()['token'])).status_code == 200
    # le code ne sert qu'une fois, et un compte verifie ne s'ouvre plus sans mot de passe
    r = client.post('/api/verifier_email', json={'email': 'bon@test.ci', 'code': dernier_code(verif)})
    assert r.status_code == 400
    assert client.post('/api/login', json={'email': 'bon@test.ci', 'mot_de_passe': 'motdepasse123'}).status_code == 200


def test_code_devine_bloque_apres_5_essais(client, verif):
    inscrire_api(client, 'force@test.ci')
    bon = dernier_code(verif)
    faux = '000000' if bon != '000000' else '111111'
    for _ in range(5):
        assert client.post('/api/verifier_email', json={'email': 'force@test.ci', 'code': faux}).status_code == 400
    r = client.post('/api/verifier_email', json={'email': 'force@test.ci', 'code': bon})
    assert r.status_code == 400 and 'expire' in r.get_json()['error']


def test_code_stocke_hache(client, verif):
    inscrire_api(client, 'hache@test.ci')
    code = dernier_code(verif)
    assert not sql('SELECT 1 FROM codes_verification WHERE code = ?', (code,))


def test_renvoyer_code_ne_revele_pas_les_comptes(client, verif):
    a = client.post('/api/renvoyer_code', json={'email': 'inconnu@test.ci'}).get_json()
    inscrire_api(client, 'connu@test.ci')
    b = client.post('/api/renvoyer_code', json={'email': 'connu@test.ci'}).get_json()
    assert a == b


def test_inscription_web_puis_code(client, verif):
    client.post('/inscription', data={'nom': 'Web', 'prenom': 'Yao', 'email': 'yao@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert client.get('/feed').status_code == 302  # pas encore connecte
    r = client.post('/verifier_email', data={'code': dernier_code(verif)})
    assert r.status_code == 302 and '/feed' in r.headers['Location']
    assert client.get('/feed').status_code == 200


def test_comptes_existants_restent_verifies(client):
    client.post('/api/register', json={'nom': 'A', 'prenom': 'B', 'email': 'ancien@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert sql('SELECT email_verifie FROM users WHERE email = ?', ('ancien@test.ci',))[0]['email_verifie'] == 1


# ---- Signalements et blocages
def compte(client, email):
    linkci_app.rate_limits.clear()  # beaucoup d'inscriptions dans la meme minute pendant les tests
    r = client.post('/api/register', json={'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'})
    tok = r.get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_signaler_une_publication(client):
    tok_a, _ = compte(client, 'auteur.sig@test.ci')
    tok_b, _ = compte(client, 'lecteur.sig@test.ci')
    pid = client.post('/api/posts', json={'contenu': 'contenu douteux'}, headers=entete(tok_a)).get_json()['id']
    assert client.post(f'/api/posts/{pid}/signaler', json={'motif': 'spam'}, headers=entete(tok_b)).status_code == 200
    assert client.post(f'/api/posts/{pid}/signaler', json={}, headers=entete(tok_b)).status_code == 200  # doublon ignore
    assert client.post(f'/api/posts/{pid}/signaler', json={}, headers=entete(tok_a)).status_code == 400  # sa propre publication
    assert len(sql('SELECT * FROM signalements_posts WHERE post_id = ?', (pid,))) == 1


def test_bloquer_masque_les_publications_et_les_messages(client):
    tok_a, id_a = compte(client, 'bloqueur@test.ci')
    tok_b, id_b = compte(client, 'importun@test.ci')
    client.post('/api/posts', json={'contenu': 'post de B'}, headers=entete(tok_b))
    assert any(p['user_id'] == id_b for p in client.get('/api/posts', headers=entete(tok_a)).get_json())

    assert client.post(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok_a)).get_json()['bloque'] is True
    assert not any(p['user_id'] == id_b for p in client.get('/api/posts', headers=entete(tok_a)).get_json())
    assert not any(p['user_id'] == id_a for p in client.get('/api/posts', headers=entete(tok_b)).get_json())
    # aucun message dans un sens ni dans l'autre
    assert client.post('/api/messages', json={'destinataire_id': id_a, 'contenu': 'hey'}, headers=entete(tok_b)).status_code == 409
    assert client.post('/api/messages', json={'destinataire_id': id_b, 'contenu': 'hey'}, headers=entete(tok_a)).status_code == 409
    assert client.get(f'/api/profil/{id_b}', headers=entete(tok_a)).get_json()['bloque'] is True
    assert [u['id'] for u in client.get('/api/bloques', headers=entete(tok_a)).get_json()] == [id_b]

    client.delete(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok_a))
    assert client.post('/api/messages', json={'destinataire_id': id_a, 'contenu': 'pardon'}, headers=entete(tok_b)).status_code in (200, 201)



# ---- Messages avec photo et "vu"
def test_message_photo_et_vu(client):
    import base64
    png = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()
    tok_a, id_a = compte(client, 'photo.a@test.ci')
    tok_b, id_b = compte(client, 'photo.b@test.ci')
    r = client.post('/api/messages', json={'destinataire_id': id_b, 'image': png}, headers=entete(tok_a))
    assert r.status_code == 201
    faux = base64.b64encode(b'MZ\x90\x00 executable').decode()
    assert client.post('/api/messages', json={'destinataire_id': id_b, 'image': faux}, headers=entete(tok_a)).status_code == 400
    msgs = client.get(f'/api/messages?avec={id_a}', headers=entete(tok_b)).get_json()
    assert msgs[-1]['image'] and msgs[-1]['contenu'] == ''
    # B a ouvert la conversation : le message de A est lu
    assert client.get(f'/api/messages?avec={id_b}', headers=entete(tok_a)).get_json()[-1]['lu'] == 1
