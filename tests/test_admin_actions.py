"""Les boutons d'administration (Bannir, Suppr) marchent avec la vraie protection CSRF."""
import re
import app as linkci_app
from test_securite import inscrire, connecter, sql


def test_admin_bannit_et_supprime_avec_csrf(client):
    inscrire(client, 'chef@test.ci')
    sql("UPDATE users SET role = 'admin' WHERE email = ?", ('chef@test.ci',))
    with linkci_app.app.test_client() as autre:
        inscrire(autre, 'fauteur@test.ci')
        connecter(autre, 'fauteur@test.ci')
        autre.post('/publier', data={'contenu': 'message abusif'})
    cible = sql('SELECT id FROM users WHERE email = ?', ('fauteur@test.ci',))[0]['id']
    post = sql('SELECT id FROM posts WHERE user_id = ?', (cible,))[0]['id']
    connecter(client, 'chef@test.ci')
    linkci_app.app.config['TESTING'] = False  # CSRF actif comme en production
    try:
        page = client.get('/admin').get_data(as_text=True)
        jeton = re.search(r'name="_csrf_token" value="([^"]+)"', page).group(1)
        r = client.post(f'/admin/bannir/{cible}', data={'_csrf_token': jeton})
        assert 'Utilisateur banni' in client.get(r.headers['Location']).get_data(as_text=True)  # message visible
        r = client.post(f'/admin/supprimer_post/{post}', data={'_csrf_token': jeton}, headers={'Referer': 'http://localhost/admin'})
        assert 'Publication supprimee' in client.get('/admin').get_data(as_text=True)
    finally:
        linkci_app.app.config['TESTING'] = True
    assert sql('SELECT banni FROM users WHERE id = ?', (cible,))[0]['banni'] == 1
    assert not sql('SELECT id FROM posts WHERE id = ?', (post,))


def test_pas_de_bouton_bannir_pour_un_admin(client):
    inscrire(client, 'chef2@test.ci')
    sql("UPDATE users SET role = 'admin' WHERE email = ?", ('chef2@test.ci',))
    connecter(client, 'chef2@test.ci')
    moi = sql('SELECT id FROM users WHERE email = ?', ('chef2@test.ci',))[0]['id']
    for page in ('/admin', '/admin/utilisateurs'):
        assert f'/admin/bannir/{moi}"' not in client.get(page).get_data(as_text=True)
