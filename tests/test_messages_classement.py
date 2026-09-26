"""Messages 2.0 (reponse, reactions, suppression pour tous, transfert), classement et defis."""
from datetime import datetime, timedelta, timezone
import app as linkci_app
from test_securite import sql, entete


def compte(client, email, **extra):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123', **extra}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_reponse_reaction_suppression_transfert(client):
    a, b, c = compte(client, 'msg2.a@test.ci'), compte(client, 'msg2.b@test.ci'), compte(client, 'msg2.c@test.ci')
    ida, idb, idc = uid(client, a), uid(client, b), uid(client, c)
    m1 = client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'On revise ce soir ?'}, headers=entete(a)).get_json()['id']
    m2 = client.post('/api/messages', json={'destinataire_id': ida, 'contenu': 'Oui, 20 h', 'reponse_a': m1}, headers=entete(b)).get_json()['id']
    # une citation d'une autre conversation est ignoree
    autre = client.post('/api/messages', json={'destinataire_id': idc, 'contenu': 'secret'}, headers=entete(a)).get_json()['id']
    m3 = client.post('/api/messages', json={'destinataire_id': ida, 'contenu': 'x', 'reponse_a': autre}, headers=entete(b)).get_json()['id']
    msgs = {m['id']: m for m in client.get(f'/api/messages?avec={idb}', headers=entete(a)).get_json()}
    assert msgs[m2]['reponse']['extrait'] == 'On revise ce soir ?' and msgs[m3]['reponse'] is None
    # reactions : ajout, changement, retrait ; emoji invalide refuse ; pas pour un etranger
    assert client.post(f'/api/messages/{m2}/reaction', json={'emoji': '💩'}, headers=entete(a)).status_code == 400
    assert client.post(f'/api/messages/{m2}/reaction', json={'emoji': '❤️'}, headers=entete(c)).status_code == 404
    r = client.post(f'/api/messages/{m2}/reaction', json={'emoji': '❤️'}, headers=entete(a)).get_json()
    assert r['reactions'] == [{'emoji': '❤️', 'nb': 1, 'moi': True}]
    r = client.post(f'/api/messages/{m2}/reaction', json={'emoji': '👍'}, headers=entete(a)).get_json()
    assert r['reactions'] == [{'emoji': '👍', 'nb': 1, 'moi': True}]
    r = client.post(f'/api/messages/{m2}/reaction', json={'emoji': '👍'}, headers=entete(a)).get_json()
    assert r['reactions'] == []
    # transfert vers c
    assert client.post(f'/api/messages/{m1}/transferer', json={'destinataires': [idc]}, headers=entete(c)).status_code == 404
    t = client.post(f'/api/messages/{m1}/transferer', json={'destinataires': [idc]}, headers=entete(a)).get_json()
    assert t['envoyes'] == 1
    recu = client.get(f'/api/messages?avec={ida}', headers=entete(c)).get_json()
    assert any(m['transfere'] and m['contenu'] == 'On revise ce soir ?' for m in recu)
    # suppression pour tous : seulement l'auteur, et pas apres 48 h
    assert client.delete(f'/api/messages/{m1}', headers=entete(b)).status_code == 403
    assert client.delete(f'/api/messages/{m1}', headers=entete(a)).status_code == 200
    msgs = {m['id']: m for m in client.get(f'/api/messages?avec={ida}', headers=entete(b)).get_json()}
    assert msgs[m1]['supprime'] and msgs[m1]['contenu'] == '' and msgs[m2]['reponse']['extrait'] == 'Message supprime'
    sql('UPDATE messages SET date_envoi = ? WHERE id = ?', ('2099-01-01 00:00:00', m1))  # le plus recent
    convs = {cv['autre_id']: cv for cv in client.get('/api/conversations', headers=entete(b)).get_json()}
    assert convs[ida]['dernier_message'] == 'Message supprime'
    sql('UPDATE messages SET date_envoi = CURRENT_TIMESTAMP WHERE id = ?', (m1,))
    vieux = (datetime.now(timezone.utc) - timedelta(days=3)).strftime('%Y-%m-%d %H:%M:%S')
    sql('UPDATE messages SET date_envoi = ? WHERE id = ?', (vieux, m2))
    assert client.delete(f'/api/messages/{m2}', headers=entete(b)).status_code == 400


def test_classement_et_defis(client):
    a = compte(client, 'cl.a@test.ci', universite='UFHB', filiere='Informatique')
    b = compte(client, 'cl.b@test.ci', universite='INP-HB', filiere='Genie civil')
    ida, idb = uid(client, a), uid(client, b)
    for k in range(2):
        client.post('/api/posts', json={'contenu': f'Publication {k}'}, headers=entete(a))
    c = client.get('/api/classement', headers=entete(a)).get_json()
    cb = client.get('/api/classement', headers=entete(b)).get_json()
    assert c['moi']['points'] > cb['moi']['points'] and c['moi']['rang'] < (cb['moi']['rang'] or 10 ** 6)
    fac = client.get('/api/classement?portee=universite', headers=entete(a)).get_json()
    assert idb not in [l['id'] for l in fac['classement']] and ida in [l['id'] for l in fac['classement']]
    assert client.get('/api/classement?periode=total', headers=entete(b)).get_json()['periode'] == 'total'
    d = client.get('/api/defis', headers=entete(a)).get_json()
    assert len(d['defis']) == 3 and len({x['cle'] for x in d['defis']}) == 3
    # tous les defis de la semaine reussis -> enregistre une fois, +20 points, badge Challenger
    linkci_app.DEFIS_SAUVE = linkci_app.DEFIS
    try:
        linkci_app.DEFIS = [('facile', '✅', 'Facile', 0, 'SELECT 1 AS nb WHERE ? IS NOT NULL AND ? IS NOT NULL')] * 3
        assert client.get('/api/defis', headers=entete(b)).get_json()['tous_reussis']
        client.get('/api/defis', headers=entete(b))
    finally:
        linkci_app.DEFIS = linkci_app.DEFIS_SAUVE
    assert sql('SELECT COUNT(*) AS n FROM defis_reussis WHERE user_id = ?', (idb,))[0]['n'] == 1
    assert sql("SELECT COUNT(*) AS n FROM user_badges ub JOIN badges bd ON bd.id = ub.badge_id WHERE ub.user_id = ? AND bd.nom = 'Challenger'", (idb,))[0]['n'] == 1


def test_defis_tournent():
    lundi = datetime(2026, 9, 28, tzinfo=timezone.utc)
    assert linkci_app.debut_semaine(lundi + timedelta(days=3, hours=5)) == '2026-09-28 00:00:00'
    assert linkci_app.defis_de_la_semaine(lundi) != linkci_app.defis_de_la_semaine(lundi + timedelta(days=7))
