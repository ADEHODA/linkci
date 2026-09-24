"""Stages et emplois : moderation, filtres, alertes, securite."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email, admin=False):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    if admin:
        sql("UPDATE users SET role = 'admin' WHERE email = ?", (email,))
    return tok


OFFRE = {'type': 'stage', 'titre': 'Stage comptable', 'entreprise': 'Orange CI', 'ville': 'Abidjan',
         'domaine': 'Finance', 'lien': 'https://exemple.ci/postuler'}


def test_offre_etudiant_attend_validation(client):
    tok = compte(client, 'etu.opp@test.ci')
    r = client.post('/api/opportunites', json=OFFRE, headers=entete(tok))
    assert r.status_code == 201 and r.get_json()['publie'] is False
    assert not any(o['titre'] == OFFRE['titre'] and o['user_id'] for o in client.get('/api/opportunites', headers=entete(tok)).get_json()
                   if o['entreprise'] == OFFRE['entreprise'] and o['titre'] == 'Stage comptable')


def test_offre_admin_publiee_et_abonnes_prevenus(client):
    admin = compte(client, 'admin.opp@test.ci', admin=True)
    etu = compte(client, 'abonne.opp@test.ci')
    assert client.put('/api/opportunites/alertes', json={'types': ['stage', 'pirate']}, headers=entete(etu)).get_json()['types'] == ['stage']
    r = client.post('/api/opportunites', json={**OFFRE, 'titre': 'Stage audit'}, headers=entete(admin))
    assert r.get_json()['publie'] is True
    offres = client.get('/api/opportunites?type=stage&ville=abidj', headers=entete(etu)).get_json()
    assert any(o['titre'] == 'Stage audit' for o in offres)
    notifs = sql("SELECT n.message FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = ? AND n.type = 'opportunite'",
                 ('abonne.opp@test.ci',))
    assert notifs and 'Stage audit' in notifs[0]['message']


def test_offre_invalide_refusee(client):
    tok = compte(client, 'invalide.opp@test.ci')
    assert client.post('/api/opportunites', json={**OFFRE, 'type': 'arnaque'}, headers=entete(tok)).status_code == 400
    # lien javascript: retire, et sans contact l'offre est refusee
    assert client.post('/api/opportunites', json={**OFFRE, 'lien': 'javascript:alert(1)'}, headers=entete(tok)).status_code == 400


def test_offres_expirees_masquees(client):
    admin = compte(client, 'admin2.opp@test.ci', admin=True)
    client.post('/api/opportunites', json={**OFFRE, 'titre': 'Vieille offre', 'date_limite': '2020-01-01'}, headers=entete(admin))
    assert not any(o['titre'] == 'Vieille offre' for o in client.get('/api/opportunites', headers=entete(admin)).get_json())


def test_seul_auteur_ou_admin_supprime(client):
    admin = compte(client, 'admin3.opp@test.ci', admin=True)
    autre = compte(client, 'autre.opp@test.ci')
    oid = client.post('/api/opportunites', json={**OFFRE, 'titre': 'A garder'}, headers=entete(admin)).get_json()['id']
    assert client.delete(f'/api/opportunites/{oid}', headers=entete(autre)).status_code == 403
    assert client.delete(f'/api/opportunites/{oid}', headers=entete(admin)).status_code == 200


def test_page_web(client):
    from test_securite import inscrire, connecter
    inscrire(client, 'web.opp@test.ci')
    connecter(client, 'web.opp@test.ci')
    assert client.get('/opportunites').status_code == 200
    r = client.post('/opportunites', data={**OFFRE, 'titre': 'Via le site'})
    assert r.status_code == 302
    assert sql("SELECT valide FROM opportunites WHERE titre = 'Via le site'")[0]['valide'] == 0
