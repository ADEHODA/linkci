"""Profil riche : competences, parcours, liens, couverture, qui a vu mon profil, e-mail cache."""
import base64
import app as linkci_app
from test_securite import sql, entete, inscrire, connecter

PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


def compte(client, email, prenom='P'):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': prenom, 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def maj(client, tok, **extra):
    return client.put('/api/profil', json={'prenom': 'Ama', 'nom': 'Kone', **extra}, headers=entete(tok))


def test_competences_parcours_liens_couverture(client):
    tok, uid = compte(client, 'riche.a@test.ci')
    r = maj(client, tok, competences=['Python', 'Excel', 'Python', ''] + [f'c{i}' for i in range(20)],
            parcours=[{'titre': 'Licence Info', 'lieu': 'UFHB', 'periode': '2023-2026'}, {'lieu': 'sans titre'}],
            lien_linkedin='https://www.linkedin.com/in/ama', lien_github='https://github.com/ama', couverture=PNG)
    assert r.status_code == 200
    p = r.get_json()
    assert p['competences'][:2] == ['Python', 'Excel'] and len(p['competences']) == 15
    assert p['parcours'] == [{'titre': 'Licence Info', 'lieu': 'UFHB', 'periode': '2023-2026'}]
    assert p['couverture'] and p['lien_github'] == 'https://github.com/ama'
    # liens pieges refuses
    assert maj(client, tok, lien_linkedin='https://evil.com/linkedin.com/').status_code == 400
    assert maj(client, tok, lien_site='javascript:alert(1)').get_json()['lien_site'] == ''
    tok_b, _ = compte(client, 'riche.b@test.ci')
    vu = client.get(f'/api/profil/{uid}', headers=entete(tok_b)).get_json()['user']
    assert vu['competences'][0] == 'Python' and 'email' not in vu


def test_qui_a_vu_mon_profil(client):
    tok_a, id_a = compte(client, 'vues.a@test.ci', 'Awa')
    tok_b, id_b = compte(client, 'vues.b@test.ci', 'Yao')
    tok_c, id_c = compte(client, 'vues.c@test.ci', 'Discret')
    client.get(f'/api/profil/{id_a}', headers=entete(tok_b))
    client.put('/api/parametres', json={'masquer_visites': True}, headers=entete(tok_c))
    client.get(f'/api/profil/{id_a}', headers=entete(tok_c))  # visite masquee
    client.get(f'/api/profil/{id_a}', headers=entete(tok_a))  # soi-meme : ignore
    r = client.get('/api/profil/vues', headers=entete(tok_a)).get_json()
    assert [v['id'] for v in r['vues']] == [id_b]
    # reciproque : qui masque ses visites ne voit pas les siennes
    assert client.get('/api/profil/vues', headers=entete(tok_c)).get_json()['masque'] is True


def test_email_cache_sur_le_site(client):
    inscrire(client, 'cache.a@test.ci')
    uid = sql("SELECT id FROM users WHERE email = 'cache.a@test.ci'")[0]['id']
    client.get('/deconnexion')
    inscrire(client, 'cache.b@test.ci')
    connecter(client, 'cache.b@test.ci')
    assert 'cache.a@test.ci' not in client.get(f'/profil/{uid}').get_data(as_text=True)
