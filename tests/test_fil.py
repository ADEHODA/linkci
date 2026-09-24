"""Fil : reactions, sondages, stories 24 h, filtre Ma fac."""
import base64
import app as linkci_app
from test_securite import sql, entete

PNG = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 64).decode()


def compte(client, email, universite=''):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123',
                                              'universite': universite}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_reactions(client):
    tok, _ = compte(client, 'reac.a@test.ci')
    pid = client.post('/api/posts', json={'contenu': 'Examen reussi !'}, headers=entete(tok)).get_json()['id']
    r = client.post(f'/api/posts/{pid}/reaction', json={'emoji': '🔥'}, headers=entete(tok)).get_json()
    assert r['reactions'] == {'🔥': 1} and r['ma_reaction'] == '🔥'
    r = client.post(f'/api/posts/{pid}/reaction', json={'emoji': '👏'}, headers=entete(tok)).get_json()
    assert r['reactions'] == {'👏': 1}  # remplacee
    r = client.post(f'/api/posts/{pid}/reaction', json={'emoji': '👏'}, headers=entete(tok)).get_json()
    assert r['reactions'] == {} and r['ma_reaction'] is None  # retiree
    assert client.post(f'/api/posts/{pid}/reaction', json={'emoji': '<script>'}, headers=entete(tok)).status_code == 400


def test_sondage(client):
    tok, _ = compte(client, 'sond.a@test.ci')
    tok_b, _ = compte(client, 'sond.b@test.ci')
    assert client.post('/api/posts', json={'contenu': 'Un seul choix ?', 'sondage': ['Oui']}, headers=entete(tok)).status_code == 400
    pid = client.post('/api/posts', json={'contenu': 'Quel amphi ?', 'sondage': ['A', 'B', '']}, headers=entete(tok)).get_json()['id']
    post = [p for p in client.get('/api/posts', headers=entete(tok_b)).get_json() if p['id'] == pid][0]
    assert [o['texte'] for o in post['sondage']] == ['A', 'B']
    a, b = post['sondage'][0]['id'], post['sondage'][1]['id']
    r = client.post(f'/api/posts/{pid}/vote', json={'option_id': a}, headers=entete(tok_b)).get_json()
    assert r['mon_vote'] == a and r['sondage'][0]['votes'] == 1
    r = client.post(f'/api/posts/{pid}/vote', json={'option_id': b}, headers=entete(tok_b)).get_json()  # change d'avis
    assert [o['votes'] for o in r['sondage']] == [0, 1]
    autre = client.post('/api/posts', json={'contenu': 'x', 'sondage': ['C', 'D']}, headers=entete(tok)).get_json()['id']
    assert client.post(f'/api/posts/{pid}/vote', json={'option_id': autre * 1000}, headers=entete(tok_b)).status_code == 400


def test_stories_24h(client):
    tok, id_a = compte(client, 'story.a@test.ci')
    tok_b, _ = compte(client, 'story.b@test.ci')
    assert client.post('/api/stories', json={'texte': 'sans photo'}, headers=entete(tok)).status_code == 400
    sid = client.post('/api/stories', json={'image': PNG, 'texte': 'Soutenance ok'}, headers=entete(tok)).get_json()['id']
    groupes = client.get('/api/stories', headers=entete(tok_b)).get_json()
    assert any(g['user_id'] == id_a and g['stories'][0]['texte'] == 'Soutenance ok' for g in groupes)
    assert client.get('/api/stories', headers=entete(tok)).get_json()[0]['est_moi'] is True
    # vieille de 25 h : effacee
    sql("UPDATE stories SET date_creation = '2000-01-01 00:00:00' WHERE id = ?", (sid,))
    assert not any(g['user_id'] == id_a for g in client.get('/api/stories', headers=entete(tok_b)).get_json())
    assert not sql('SELECT 1 FROM stories WHERE id = ?', (sid,))


def test_ma_fac(client):
    tok_a, id_a = compte(client, 'fac.a@test.ci', 'UFHB')
    tok_b, id_b = compte(client, 'fac.b@test.ci', 'ufhb')
    tok_c, id_c = compte(client, 'fac.c@test.ci', 'INP-HB')
    for t in (tok_b, tok_c):
        client.post('/api/posts', json={'contenu': 'bonjour'}, headers=entete(t))
    auteurs = {p['user_id'] for p in client.get('/api/posts?fac=1', headers=entete(tok_a)).get_json()}
    assert id_b in auteurs and id_c not in auteurs
