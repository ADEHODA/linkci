"""Suppression de compte : tout est efface, sauf les donnees des autres ; pages legales publiques."""
import base64
import app as linkci_app
from test_securite import sql, entete

PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


def compte(client, email):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_suppression_complete(client):
    tok, uid = compte(client, 'partant@test.ci')
    tok_b, id_b = compte(client, 'restant@test.ci')
    # des donnees partout
    pid = client.post('/api/posts', json={'contenu': 'au revoir', 'image': PNG, 'sondage': ['a', 'b']}, headers=entete(tok)).get_json()['id']
    client.post(f'/api/posts/{pid}/reaction', json={'emoji': '🔥'}, headers=entete(tok_b))
    post_b = client.post('/api/posts', json={'contenu': 'je reste'}, headers=entete(tok_b)).get_json()['id']
    client.post(f'/api/posts/{post_b}/like', headers=entete(tok))
    client.post('/api/messages', json={'destinataire_id': id_b, 'contenu': 'salut'}, headers=entete(tok))
    client.post('/api/annonces', json={'categorie': 'livres', 'titre': 'Livre', 'image': PNG}, headers=entete(tok))
    qid = client.post('/api/questions', json={'matiere': 'Maths', 'titre': 'Une question ?'}, headers=entete(tok_b)).get_json()['id']
    rid = client.post(f'/api/questions/{qid}/reponses', json={'contenu': 'Ma reponse'}, headers=entete(tok)).get_json()['id']
    client.post(f'/api/questions/{qid}/meilleure', json={'reponse_id': rid}, headers=entete(tok_b))
    client.post('/api/stories', json={'image': PNG}, headers=entete(tok))
    client.post(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok))

    assert client.post('/api/supprimer_compte', json={'mot_de_passe': 'faux'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/supprimer_compte', json={'mot_de_passe': 'motdepasse123'}, headers=entete(tok)).status_code == 200

    assert not sql('SELECT 1 FROM users WHERE id = ?', (uid,))
    for table, col in (('posts', 'user_id'), ('likes', 'user_id'), ('annonces', 'user_id'), ('stories', 'user_id'),
                       ('reponses', 'user_id'), ('blocages', 'bloqueur_id'), ('messages', 'expediteur_id')):
        assert not sql(f'SELECT 1 FROM {table} WHERE {col} = ?', (uid,)), table
    assert not sql('SELECT 1 FROM reactions WHERE post_id = ?', (pid,))
    assert not sql('SELECT 1 FROM post_sondage_options WHERE post_id = ?', (pid,))
    # les donnees de l'autre etudiant restent, sa question redevient sans meilleure reponse
    assert sql('SELECT 1 FROM posts WHERE id = ?', (post_b,))
    assert sql('SELECT meilleure_reponse_id FROM questions WHERE id = ?', (qid,))[0]['meilleure_reponse_id'] is None
    # l'ancien jeton ne marche plus
    assert client.get('/api/me', headers=entete(tok)).status_code == 401


def test_admin_protege(client):
    tok, _ = compte(client, 'admin.supp@test.ci')
    sql("UPDATE users SET role = 'admin' WHERE email = 'admin.supp@test.ci'")
    assert client.post('/api/supprimer_compte', json={'mot_de_passe': 'motdepasse123'}, headers=entete(tok)).status_code == 400


def test_suppression_web(client):
    from test_securite import inscrire, connecter
    inscrire(client, 'web.supp@test.ci')
    connecter(client, 'web.supp@test.ci')
    assert client.get('/compte/supprimer').status_code == 200
    client.post('/compte/supprimer', data={'mot_de_passe': 'motdepasse123'})
    assert not sql("SELECT 1 FROM users WHERE email = 'web.supp@test.ci'")
    assert client.get('/feed').status_code == 302


def test_pages_legales_publiques(client):
    for url in ('/confidentialite', '/conditions'):
        r = client.get(url)
        assert r.status_code == 200 and 'LinkCI' in r.get_data(as_text=True)
