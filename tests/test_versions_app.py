"""Anciennes versions de l'app : detection, avertissement unique, page de telechargement."""
from datetime import datetime, timedelta, timezone
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def avertissements(uid):
    return sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'mise_a_jour'", (uid,))[0]['n']


def test_page_telecharger(client):
    r = client.get('/app')
    assert r.status_code == 200 and linkci_app.APK_URL.encode() in r.data


def test_nouvelle_app_jamais_avertie(client):
    tok = compte(client, 'ver.a@test.ci')
    uid = client.get('/api/me', headers={**entete(tok), 'X-LinkCI-Version': '1.2.0'}).get_json()['id']
    assert sql('SELECT version_app, sans_version_depuis FROM users WHERE id = ?', (uid,))[0]['version_app'] == '1.2.0'
    assert avertissements(uid) == 0


def test_ancienne_app_avertie_une_fois(client):
    tok = compte(client, 'ver.b@test.ci')
    uid = client.get('/api/me', headers=entete(tok)).get_json()['id']
    assert sql('SELECT sans_version_depuis FROM users WHERE id = ?', (uid,))[0]['sans_version_depuis']
    # vue sans version depuis 2 jours, et depuis 5 minutes aujourd'hui
    maintenant = datetime.now(timezone.utc)
    sql('UPDATE users SET sans_version_depuis = ? WHERE id = ?', ((maintenant - timedelta(days=2)).strftime('%Y-%m-%d %H:%M:%S'), uid))
    etat = linkci_app._version_vue[uid]
    linkci_app._version_vue[uid] = ('sans', etat[1], maintenant - timedelta(minutes=5), maintenant - timedelta(seconds=1))
    client.get('/api/me', headers=entete(tok))
    assert avertissements(uid) == 1
    linkci_app._version_vue[uid] = ('sans', etat[1], maintenant - timedelta(minutes=9), maintenant - timedelta(seconds=1))
    client.get('/api/me', headers=entete(tok))
    assert avertissements(uid) == 1  # pas plus d'une fois tous les 3 jours
    # la nouvelle version remet tout a zero
    client.get('/api/me', headers={**entete(tok), 'X-LinkCI-Version': '1.2.0'})
    assert sql('SELECT sans_version_depuis FROM users WHERE id = ?', (uid,))[0]['sans_version_depuis'] is None
