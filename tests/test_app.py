def test_index_redirect(client):
    resp = client.get('/')
    assert resp.status_code in (200, 302)

def test_register_page(client):
    resp = client.get('/inscription')
    assert resp.status_code == 200
    assert b'Inscription' in resp.data

def test_login_page(client):
    resp = client.get('/connexion')
    assert resp.status_code == 200
    assert b'Connexion' in resp.data

def test_register_user(client):
    resp = client.post('/inscription', data={
        'nom': 'Test',
        'prenom': 'User',
        'email': 'test@test.com',
        'mot_de_passe': 'password123',
        'universite': 'UNIV',
        'filiere': 'INFO',
        'annee': '2026'
    }, follow_redirects=True)
    assert resp.status_code in (200,)

def test_login_user(client):
    client.post('/inscription', data={
        'nom': 'Test', 'prenom': 'User', 'email': 'test@test.com',
        'mot_de_passe': 'password123', 'universite': 'UNIV',
        'filiere': 'INFO', 'annee': '2026'
    })
    resp = client.post('/connexion', data={
        'email': 'test@test.com', 'mot_de_passe': 'password123'
    }, follow_redirects=True)
    assert resp.status_code in (200, 302)

def test_create_post(client):
    client.post('/inscription', data={
        'nom': 'Test', 'prenom': 'User', 'email': 'post@test.com',
        'mot_de_passe': 'password123', 'universite': 'UNIV',
        'filiere': 'INFO', 'annee': '2026'
    })
    client.post('/connexion', data={
        'email': 'post@test.com', 'mot_de_passe': 'password123'
    })
    resp = client.post('/publier', data={'contenu': 'Hello World!'}, follow_redirects=True)
    assert resp.status_code in (200, 302)

def test_like_post(client):
    client.post('/inscription', data={
        'nom': 'Test', 'prenom': 'User', 'email': 'like@test.com',
        'mot_de_passe': 'password123', 'universite': 'UNIV',
        'filiere': 'INFO', 'annee': '2026'
    })
    client.post('/connexion', data={
        'email': 'like@test.com', 'mot_de_passe': 'password123'
    }, follow_redirects=True)
    client.post('/publier', data={'contenu': 'Like me!'}, follow_redirects=True)
    resp = client.post('/liker/1', follow_redirects=True)
    assert resp.status_code in (200,)

def test_forgot_password_page(client):
    resp = client.get('/mot_de_passe_oublie')
    assert resp.status_code == 200

def test_search_page(client):
    client.post('/inscription', data={
        'nom': 'Search', 'prenom': 'Test', 'email': 'search@test.com',
        'mot_de_passe': 'password123', 'universite': 'UNIV',
        'filiere': 'INFO', 'annee': '2026'
    })
    client.post('/connexion', data={
        'email': 'search@test.com', 'mot_de_passe': 'password123'
    }, follow_redirects=True)
    resp = client.get('/recherche?q=test')
    assert resp.status_code == 200