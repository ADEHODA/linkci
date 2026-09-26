"""Recherche dans les messages et photos partagees."""
import app as linkci_app
from test_securite import sql, entete

PNG = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_recherche_prives_groupes_et_medias(client):
    a, b, c = compte(client, 'rm.a@test.ci'), compte(client, 'rm.b@test.ci'), compte(client, 'rm.c@test.ci')
    ida, idb = uid(client, a), uid(client, b)
    client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'Le partiel de Statistiques est lundi'}, headers=entete(a))
    m2 = client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'statistiques : chapitre 3'}, headers=entete(a)).get_json()['id']
    client.post('/api/messages', json={'destinataire_id': ida, 'contenu': 'Rien a voir'}, headers=entete(b))
    client.post('/api/messages', json={'destinataire_id': idb, 'contenu': '', 'image': PNG}, headers=entete(a))
    gid = client.post('/api/groupes', json={'nom': 'Groupe recherche test', 'description': 'x'}, headers=entete(a)).get_json()['id']
    client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'Revision de statistiques samedi'}, headers=entete(a))

    r = client.get('/api/messages/recherche?q=statistiques', headers=entete(b)).get_json()
    assert len(r['prives']) == 2 and all(m['autre_id'] == ida for m in r['prives'])
    assert r['groupes'] == []  # b n'est pas membre du groupe
    assert len(client.get('/api/messages/recherche?q=statistiques', headers=entete(a)).get_json()['groupes']) == 1
    assert client.get('/api/messages/recherche?q=statistiques', headers=entete(c)).get_json() == {'prives': [], 'groupes': []}
    assert client.get('/api/messages/recherche?q=%25', headers=entete(b)).get_json() == {'prives': [], 'groupes': []}
    # message supprime pour tous : plus trouve
    client.delete(f'/api/messages/{m2}', headers=entete(a))
    assert len(client.get('/api/messages/recherche?q=statistiques', headers=entete(b)).get_json()['prives']) == 1
    # photos partagees
    medias = client.get(f'/api/messages/medias?avec={ida}', headers=entete(b)).get_json()
    assert len(medias) == 1 and medias[0]['image']
    assert client.get(f'/api/messages/medias?avec={ida}', headers=entete(c)).get_json() == []
    assert client.get(f'/api/groupes/{gid}/medias', headers=entete(b)).status_code == 403
