"""Petites annonces : publication, photo, vendu, droits, blocage, signalement."""
import base64
import app as linkci_app
from test_securite import sql, entete

PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


def compte(client, email):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_publier_vendre_supprimer(client):
    tok, _ = compte(client, 'vendeur.ann@test.ci')
    autre, _ = compte(client, 'acheteur.ann@test.ci')
    r = client.post('/api/annonces', json={'categorie': 'livres', 'titre': 'Livre de maths', 'prix': '5 000', 'image': PNG}, headers=entete(tok))
    assert r.status_code == 201
    aid = r.get_json()['id']
    a = [x for x in client.get('/api/annonces', headers=entete(autre)).get_json() if x['id'] == aid][0]
    assert a['prix'] == 5000 and a['image'] and not a['est_auteur']
    assert client.post(f'/api/annonces/{aid}/vendu', headers=entete(autre)).status_code == 403
    assert client.post(f'/api/annonces/{aid}/vendu', headers=entete(tok)).get_json()['vendu'] is True
    assert client.delete(f'/api/annonces/{aid}', headers=entete(autre)).status_code == 403
    assert client.delete(f'/api/annonces/{aid}', headers=entete(tok)).status_code == 200


def test_annonce_invalide(client):
    tok, _ = compte(client, 'invalide.ann@test.ci')
    base = {'categorie': 'livres', 'titre': 'Objet'}
    assert client.post('/api/annonces', json={**base, 'categorie': 'drogue'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/annonces', json={**base, 'prix': '-5'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/annonces', json={**base, 'prix': 'abc'}, headers=entete(tok)).status_code == 400
    faux = base64.b64encode(b'<?php system($_GET["c"]); ?>').decode()
    assert client.post('/api/annonces', json={**base, 'image': faux}, headers=entete(tok)).status_code == 400


def test_annonces_des_bloques_masquees(client):
    tok_a, id_a = compte(client, 'a.ann@test.ci')
    tok_b, id_b = compte(client, 'b.ann@test.ci')
    client.post('/api/annonces', json={'categorie': 'autre', 'titre': 'Annonce de B'}, headers=entete(tok_b))
    client.post(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok_a))
    assert not any(x['user_id'] == id_b for x in client.get('/api/annonces', headers=entete(tok_a)).get_json())


def test_signaler_annonce(client):
    tok, _ = compte(client, 'sig.ann@test.ci')
    autre, _ = compte(client, 'sig2.ann@test.ci')
    aid = client.post('/api/annonces', json={'categorie': 'autre', 'titre': 'Suspect'}, headers=entete(tok)).get_json()['id']
    assert client.post(f'/api/annonces/{aid}/signaler', json={'motif': 'arnaque'}, headers=entete(autre)).status_code == 200


def test_page_web(client):
    from test_securite import inscrire, connecter
    inscrire(client, 'web.ann@test.ci')
    connecter(client, 'web.ann@test.ci')
    assert client.get('/annonces').status_code == 200
    assert client.post('/annonces', data={'categorie': 'fournitures', 'titre': 'Calculatrice', 'prix': '3000'}).status_code == 302
    assert 'Calculatrice' in client.get('/annonces').get_data(as_text=True)
