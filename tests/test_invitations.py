"""Parrainage : code, filleuls, suivi mutuel, badge Ambassadeur ; retour apres connexion."""
import app as linkci_app
from test_securite import sql, entete, inscrire


def compte(client, email, invitation=None):
    linkci_app.rate_limits.clear()
    corps = {'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'}
    if invitation:
        corps['invitation'] = invitation
    tok = client.post('/api/register', json=corps).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_parrainage_et_badge(client):
    tok_p, id_p = compte(client, 'parrain@test.ci')
    inv = client.get('/api/invitations', headers=entete(tok_p)).get_json()
    assert len(inv['code']) == 7 and inv['code'] in inv['lien'] and inv['nb_filleuls'] == 0
    assert client.get('/api/invitations', headers=entete(tok_p)).get_json()['code'] == inv['code']  # stable
    for i in range(3):
        _, id_f = compte(client, f'filleul{i}@test.ci', inv['code'].lower())
        assert sql('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (id_f, id_p))
        assert sql('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (id_p, id_f))
    assert client.get('/api/invitations', headers=entete(tok_p)).get_json()['nb_filleuls'] == 3
    assert sql("""SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? AND b.nom = 'Ambassadeur'""", (id_p,))
    assert sql("SELECT 1 FROM notifications WHERE user_id = ? AND message LIKE '%grace a toi%'", (id_p,))
    # code inconnu : aucun parrain
    _, id_x = compte(client, 'sansparrain@test.ci', 'XXXXXXX')
    assert sql('SELECT parrain_id FROM users WHERE id = ?', (id_x,))[0]['parrain_id'] is None


def test_inscription_web_avec_invitation(client):
    tok_p, id_p = compte(client, 'parrain.web@test.ci')
    code = client.get('/api/invitations', headers=entete(tok_p)).get_json()['code']
    assert 'bienvenue' in client.get(f'/inscription?invite={code}').get_data(as_text=True)
    inscrire(client, 'filleul.web@test.ci', invitation=code)
    assert sql("SELECT parrain_id FROM users WHERE email = 'filleul.web@test.ci'")[0]['parrain_id'] == id_p


def test_retour_apres_connexion(client):
    inscrire(client, 'retour@test.ci')
    r = client.post('/connexion?suivant=/entraide', data={'email': 'retour@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert r.headers['Location'].endswith('/entraide')
    client.get('/deconnexion')
    r = client.post('/connexion', data={'email': 'retour@test.ci', 'mot_de_passe': 'motdepasse123', 'suivant': '//pirate.com'})
    assert 'pirate' not in r.headers['Location']
