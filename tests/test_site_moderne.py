"""Site modernise : pont session -> API (en-tete X-LinkCI) et nouvelles pages."""
from test_securite import inscrire, connecter


def test_pont_session_api(client):
    inscrire(client, 'web.pont@test.ci')
    connecter(client, 'web.pont@test.ci')
    # sans l'en-tete du site, la session ne suffit pas (protection CSRF)
    assert client.get('/api/me').status_code == 401
    assert client.post('/api/posts', json={'contenu': 'pirate'}).status_code == 401
    r = client.get('/api/me', headers={'X-LinkCI': 'web'})
    assert r.status_code == 200 and r.get_json()['email'] == 'web.pont@test.ci'
    assert client.post('/api/posts', json={'contenu': 'depuis le site'}, headers={'X-LinkCI': 'web'}).status_code == 201


def test_nouvelles_pages(client):
    for url in ('/fil', '/feed', '/entraide', '/entraide/1', '/parametres', '/decouvrir?q=test'):
        assert client.get(url).status_code == 302  # connexion requise
    inscrire(client, 'web.pages@test.ci')
    connecter(client, 'web.pages@test.ci')
    for url in ('/fil', '/feed', '/entraide', '/entraide/1', '/parametres', '/decouvrir?q=test'):
        r = client.get(url)
        assert r.status_code == 200 and 'linkci.js' in r.get_data(as_text=True), url


def test_deconnexion_coupe_le_pont(client):
    inscrire(client, 'web.deco@test.ci')
    connecter(client, 'web.deco@test.ci')
    client.get('/deconnexion')
    assert client.get('/api/me', headers={'X-LinkCI': 'web'}).status_code == 401


def test_pages_converties(client):
    """Toutes les pages du site s'affichent avec la nouvelle mise en page."""
    inscrire(client, 'web.conv@test.ci')
    connecter(client, 'web.conv@test.ci')
    from test_securite import sql
    uid = sql("SELECT id FROM users WHERE email = 'web.conv@test.ci'")[0]['id']
    for url in ('/bourses', '/formations', '/documents', '/documents/ajouter', '/bourses/ajouter', '/calendrier',
                '/groupes', '/messagerie', f'/profil/{uid}', '/profil/modifier', '/notifications', '/opportunites', '/annonces'):
        r = client.get(url)
        assert r.status_code == 200, url
        html = r.get_data(as_text=True)
        assert 'class="menu"' in html and 'app.css' in html, url
