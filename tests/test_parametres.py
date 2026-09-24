"""Parametres : qui peut m'ecrire, Vu masque, notifications, mot de passe, deconnexion, effacer, aide."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def envoyer(client, tok, dest, texte='salut'):
    return client.post('/api/messages', json={'destinataire_id': dest, 'contenu': texte}, headers=entete(tok))


def test_qui_peut_ecrire(client):
    tok_a, id_a = compte(client, 'param.a@test.ci')
    tok_b, id_b = compte(client, 'param.b@test.ci')
    r = client.put('/api/parametres', json={'qui_peut_ecrire': 'abonnes'}, headers=entete(tok_a)).get_json()
    assert r['qui_peut_ecrire'] == 'abonnes'
    assert envoyer(client, tok_b, id_a).status_code == 409  # A ne suit pas B
    assert envoyer(client, tok_a, id_b).status_code == 201  # A ecrit a B...
    assert envoyer(client, tok_b, id_a).status_code == 201  # ...donc B peut lui repondre


def test_vu_masque(client):
    tok_a, id_a = compte(client, 'vu.a@test.ci')
    tok_b, id_b = compte(client, 'vu.b@test.ci')
    client.put('/api/parametres', json={'masquer_vu': True}, headers=entete(tok_b))
    envoyer(client, tok_a, id_b)
    client.get(f'/api/messages?avec={id_a}', headers=entete(tok_b))  # B lit
    assert client.get(f'/api/messages?avec={id_b}', headers=entete(tok_a)).get_json()[-1]['lu'] == 0


def test_notifications_coupees(client):
    tok, _ = compte(client, 'notif.a@test.ci')
    r = client.put('/api/parametres', json={'notifications': {'reactions': False, 'messages': True}}, headers=entete(tok)).get_json()
    assert r['notifications']['reactions'] is False and r['notifications']['messages'] is True


def test_changer_mot_de_passe_et_deconnexion(client):
    tok, _ = compte(client, 'mdp.a@test.ci')
    autre_appareil = client.post('/api/login', json={'email': 'mdp.a@test.ci', 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    assert client.post('/api/mot_de_passe', json={'actuel': 'faux', 'nouveau': 'nouveaumdp123'}, headers=entete(tok)).status_code == 400
    r = client.post('/api/mot_de_passe', json={'actuel': 'motdepasse123', 'nouveau': 'nouveaumdp123'}, headers=entete(tok)).get_json()
    assert client.get('/api/me', headers=entete(r['token'])).status_code == 200
    assert client.get('/api/me', headers=entete(autre_appareil)).status_code == 401  # deconnecte
    assert client.post('/api/login', json={'email': 'mdp.a@test.ci', 'mot_de_passe': 'nouveaumdp123'}).status_code == 200
    nouveau = client.post('/api/deconnecter_partout', headers=entete(r['token'])).get_json()['token']
    assert client.get('/api/me', headers=entete(r['token'])).status_code == 401
    assert client.get('/api/me', headers=entete(nouveau)).status_code == 200


def test_effacer_discussion_pour_moi(client):
    tok_a, id_a = compte(client, 'eff.a@test.ci')
    tok_b, id_b = compte(client, 'eff.b@test.ci')
    envoyer(client, tok_a, id_b, 'ancien message')
    sql("UPDATE messages SET date_envoi = '2020-01-01 00:00:00' WHERE contenu = 'ancien message'")
    client.post(f'/api/conversations/{id_b}/effacer', headers=entete(tok_a))
    assert client.get(f'/api/messages?avec={id_b}', headers=entete(tok_a)).get_json() == []
    assert not any(c['autre_id'] == id_b for c in client.get('/api/conversations', headers=entete(tok_a)).get_json())
    assert len(client.get(f'/api/messages?avec={id_a}', headers=entete(tok_b)).get_json()) == 1  # B garde tout


def test_contact_aide(client):
    tok, _ = compte(client, 'aide.a@test.ci')
    compte(client, 'aide.admin@test.ci')
    sql("UPDATE users SET role = 'admin' WHERE email = 'aide.admin@test.ci'")
    assert client.get('/api/aide/contact', headers=entete(tok)).get_json().get('id')
