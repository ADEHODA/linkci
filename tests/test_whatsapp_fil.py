"""Vocal ecoute, message modifie, presence ; publications enregistrees et hashtags."""
from datetime import datetime, timedelta, timezone
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_modifier_ecoute_presence(client):
    a, b = compte(client, 'wa.a@test.ci'), compte(client, 'wa.b@test.ci')
    ida, idb = uid(client, a), uid(client, b)
    m = client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'Salut Awa'}, headers=entete(a)).get_json()['id']
    assert client.put(f'/api/messages/{m}', json={'contenu': 'pirate'}, headers=entete(b)).status_code == 403
    assert client.put(f'/api/messages/{m}', json={'contenu': '  '}, headers=entete(a)).status_code == 400
    assert client.put(f'/api/messages/{m}', json={'contenu': 'Salut Awa !'}, headers=entete(a)).get_json()['modifie']
    lu = {x['id']: x for x in client.get(f'/api/messages?avec={ida}', headers=entete(b)).get_json()}[m]
    assert lu['contenu'] == 'Salut Awa !' and lu['modifie']
    sql('UPDATE messages SET date_envoi = ? WHERE id = ?', ((datetime.now(timezone.utc) - timedelta(minutes=20)).strftime('%Y-%m-%d %H:%M:%S'), m))
    assert client.put(f'/api/messages/{m}', json={'contenu': 'trop tard'}, headers=entete(a)).status_code == 400
    # note vocale ecoutee : seulement par le destinataire
    sql("INSERT INTO messages (expediteur_id, destinataire_id, contenu, audio, duree) VALUES (?, ?, '', 'x.m4a', 3)", (ida, idb))
    v = sql('SELECT id FROM messages WHERE audio = ? AND expediteur_id = ?', ('x.m4a', ida))[0]['id']
    assert client.post(f'/api/messages/{v}/ecoute', headers=entete(a)).status_code == 404
    assert client.post(f'/api/messages/{v}/ecoute', headers=entete(b)).get_json()['ecoute']
    assert {x['id']: x for x in client.get(f'/api/messages?avec={idb}', headers=entete(a)).get_json()}[v]['ecoute']
    # presence
    p = client.get(f'/api/presence/{idb}', headers=entete(a)).get_json()
    assert p['masque'] is False and p['en_ligne']
    sql('UPDATE users SET vu_a = ? WHERE id = ?', ('2026-01-01 10:00:00', idb))
    linkci_app._presence_notee[idb] = 10 ** 12  # pas de nouvelle ecriture pendant le test
    p = client.get(f'/api/presence/{idb}', headers=entete(a)).get_json()
    assert p['en_ligne'] is False and p['vu_a'] == '2026-01-01 10:00:00'
    sql('UPDATE users SET masquer_vu = 1 WHERE id = ?', (ida,))
    assert client.get(f'/api/presence/{idb}', headers=entete(a)).get_json() == {'masque': True}


def test_enregistres_et_hashtags(client):
    a = compte(client, 'fil2.a@test.ci')
    client.post('/api/posts', json={'contenu': 'Qui a le sujet de #BTS 2025 ? #Revision'}, headers=entete(a))
    client.post('/api/posts', json={'contenu': 'Rien a voir'}, headers=entete(a))
    posts = client.get('/api/posts?tag=bts', headers=entete(a)).get_json()
    assert [p['contenu'] for p in posts] == ['Qui a le sujet de #BTS 2025 ? #Revision']
    assert client.get('/api/posts?tag=%25', headers=entete(a)).get_json() == []  # pas de joker SQL
    pid = posts[0]['id']
    assert posts[0]['enregistre'] == 0
    assert client.post(f'/api/posts/{pid}/enregistrer', headers=entete(a)).get_json() == {'enregistre': True}
    client.post(f'/api/posts/{pid}/enregistrer', headers=entete(a))  # deux fois : pas de doublon
    sauves = client.get('/api/posts/enregistres', headers=entete(a)).get_json()
    assert [p['id'] for p in sauves] == [pid] and sauves[0]['enregistre'] == 1
    client.delete(f'/api/posts/{pid}/enregistrer', headers=entete(a))
    assert client.get('/api/posts/enregistres', headers=entete(a)).get_json() == []
    assert client.post('/api/posts/999999/enregistrer', headers=entete(a)).status_code == 404
