import os
import uuid

import app as linkci_app
import db


def test_translate_placeholders_et_like():
    sql = db.translate("SELECT * FROM users WHERE email = ? AND nom LIKE ?")
    assert sql == "SELECT * FROM users WHERE email = %s AND nom ILIKE %s"


def test_translate_pourcent_litteral():
    assert db.translate("SELECT '100%' WHERE a = ?") == "SELECT '100%%' WHERE a = %s"


def test_translate_insert_returning_id():
    assert db.translate("INSERT INTO posts (contenu) VALUES (?)") == \
        "INSERT INTO posts (contenu) VALUES (%s) RETURNING id"


def test_translate_insert_or_ignore():
    assert db.translate("INSERT OR IGNORE INTO likes (a, b) VALUES (?, ?)") == \
        "INSERT INTO likes (a, b) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING id"


def test_translate_ddl():
    sql = db.translate("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                       "d TIMESTAMP DEFAULT CURRENT_TIMESTAMP, e TIMESTAMP NOT NULL, f BLOB)")
    assert 'SERIAL PRIMARY KEY' in sql
    assert "TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" in sql
    assert 'e TEXT NOT NULL' in sql
    assert 'f BYTEA' in sql
    assert db.translate("ALTER TABLE bourses ADD COLUMN expiree INTEGER DEFAULT 0") == \
        "ALTER TABLE bourses ADD COLUMN IF NOT EXISTS expiree INTEGER DEFAULT 0"


def test_row_comme_sqlite_row():
    row = db.Row(['id', 'nom'], {'id': 0, 'nom': 1}, (7, 'Kone'))
    assert row['nom'] == 'Kone' and row[0] == 7
    assert dict(row) == {'id': 7, 'nom': 'Kone'}
    uid, nom = row
    assert (uid, nom) == (7, 'Kone')


def test_fichier_restaure_depuis_la_base():
    chemin = f'static/uploads/test_{uuid.uuid4().hex}.bin'
    disque = os.path.join(linkci_app.app.root_path, *chemin.split('/'))
    try:
        linkci_app.stocker_fichier(chemin, b'\x00contenu')
        os.remove(disque)  # simule un redeploiement Render (disque efface)
        assert linkci_app.restaurer_fichier(chemin)
        with open(disque, 'rb') as f:
            assert f.read() == b'\x00contenu'
    finally:
        linkci_app.supprimer_fichier(chemin)
    assert not os.path.exists(disque)
    assert not linkci_app.restaurer_fichier(chemin)


def test_image_statique_restauree_a_la_demande(client):
    nom = f'test_{uuid.uuid4().hex}.png'
    chemin = 'static/uploads/' + nom
    disque = os.path.join(linkci_app.app.root_path, 'static', 'uploads', nom)
    try:
        linkci_app.stocker_fichier(chemin, b'\x89PNG fake')
        os.remove(disque)
        resp = client.get('/' + chemin)
        assert resp.status_code == 200
        assert resp.data == b'\x89PNG fake'
        resp.close()
    finally:
        linkci_app.supprimer_fichier(chemin)


def test_stats_page(client):
    client.post('/inscription', data={
        'nom': 'Stats', 'prenom': 'Test', 'email': 'stats@test.com',
        'mot_de_passe': 'password123', 'universite': 'UNIV',
        'filiere': 'INFO', 'annee': '2026'
    })
    client.post('/connexion', data={'email': 'stats@test.com', 'mot_de_passe': 'password123'})
    client.post('/publier', data={'contenu': 'Post pour les stats'})
    resp = client.get('/stats')
    assert resp.status_code == 200


def test_ancien_mot_de_passe_sha256_survit_au_redemarrage(client):
    import hashlib
    conn = linkci_app.get_db()
    conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe) VALUES (?, ?, ?, ?)',
                 ('Old', 'User', 'old@test.ci', hashlib.sha256(b'vieuxmdp').hexdigest()))
    conn.commit()
    conn.close()
    linkci_app.init_db()  # redemarrage : ne doit pas abimer le hash
    resp = client.post('/connexion', data={'email': 'old@test.ci', 'mot_de_passe': 'vieuxmdp'})
    assert resp.status_code == 302 and '/feed' in resp.headers['Location']
    conn = linkci_app.get_db()
    h = conn.execute('SELECT mot_de_passe FROM users WHERE email = ?', ('old@test.ci',)).fetchone()['mot_de_passe']
    conn.close()
    assert h.startswith('$2')  # converti en bcrypt a la connexion


PNG_1PX = ('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')


def _id(client, h):
    return client.get('/api/me', headers=h).get_json()['id']


def _jeton_api(client, email):
    resp = client.post('/api/register', json={'nom': 'Api', 'prenom': 'Test', 'email': email, 'mot_de_passe': 'password123'})
    return {'Authorization': 'Bearer ' + resp.get_json()['token']}


def test_api_photo_seule_acceptee(client):
    h = _jeton_api(client, 'photo@test.ci')
    resp = client.post('/api/posts', json={'contenu': '', 'image': PNG_1PX}, headers=h)
    assert resp.status_code == 201
    posts = client.get('/api/posts', headers=h).get_json()
    post = next(p for p in posts if p['id'] == resp.get_json()['id'])
    assert post['image'].endswith('.png') and post['est_auteur']
    linkci_app.supprimer_fichier('static/uploads/' + post['image'])


def test_api_image_invalide_refusee(client):
    h = _jeton_api(client, 'invalide@test.ci')
    resp = client.post('/api/posts', json={'contenu': 'x', 'image': 'cGFzIHVuZSBpbWFnZQ=='}, headers=h)
    assert resp.status_code == 400
    assert client.post('/api/posts', json={'contenu': ''}, headers=h).status_code == 400


def test_api_texte_long_non_tronque(client):
    h = _jeton_api(client, 'long@test.ci')
    texte = 'a' * 1200
    pid = client.post('/api/posts', json={'contenu': texte}, headers=h).get_json()['id']
    post = next(p for p in client.get('/api/posts', headers=h).get_json() if p['id'] == pid)
    assert len(post['contenu']) == 1200


def test_api_lien_document_signe(client):
    h = _jeton_api(client, 'docs@test.ci')
    uid = _id(client, h)
    nom = f'test_{uuid.uuid4().hex}.pdf'
    linkci_app.stocker_fichier('uploads/' + nom, b'%PDF-1.4 test')
    conn = linkci_app.get_db()
    doc_id = conn.execute('INSERT INTO documents (user_id, titre, fichier) VALUES (?, ?, ?)', (uid, 'Cours', nom)).lastrowid
    conn.commit()
    conn.close()
    try:
        assert client.get(f'/api/documents/{doc_id}/lien').status_code == 401
        chemin = client.get(f'/api/documents/{doc_id}/lien', headers=h).get_json()['chemin']
        resp = client.get(chemin)  # sans session ni jeton d'API
        assert resp.status_code == 200 and resp.data == b'%PDF-1.4 test'
        resp.close()
        assert client.get(chemin.split('?')[0] + '?t=faux').status_code == 403
        autre = chemin.replace(f'/documents/{doc_id}/', f'/documents/{doc_id + 1}/')
        assert client.get(autre).status_code == 403  # jeton d'un autre document
    finally:
        linkci_app.supprimer_fichier('uploads/' + nom)
    assert client.get(f'/api/documents/{doc_id}/lien', headers=h).status_code == 404  # fichier disparu


def test_api_modifier_profil_avec_avatar(client):
    h = _jeton_api(client, 'profil@test.ci')
    resp = client.put('/api/profil', json={'prenom': 'Awa', 'nom': 'Kone', 'bio': 'MIAGE', 'filiere': 'Info', 'avatar': PNG_1PX}, headers=h)
    assert resp.status_code == 200
    u = resp.get_json()
    assert (u['prenom'], u['bio'], u['filiere']) == ('Awa', 'MIAGE', 'Info') and u['avatar'].endswith('.png')
    premier = u['avatar']
    u2 = client.put('/api/profil', json={'prenom': 'Awa', 'nom': 'Kone', 'avatar': PNG_1PX}, headers=h).get_json()
    assert u2['avatar'] != premier and not linkci_app.restaurer_fichier('static/avatars/' + premier)  # ancien supprime
    assert client.get('/api/me', headers=h).get_json()['avatar'] == u2['avatar']
    assert client.put('/api/profil', json={'prenom': '', 'nom': 'x'}, headers=h).status_code == 400
    linkci_app.supprimer_fichier('static/avatars/' + u2['avatar'])





def test_temps_reel_app_avec_jeton(client):
    ha, hb = _jeton_api(client, 'rt_a@test.ci'), _jeton_api(client, 'rt_b@test.ci')
    # B se connecte au temps reel avec son jeton d'API (pas de session web)
    sb = linkci_app.socketio.test_client(linkci_app.app, auth={'token': hb['Authorization'][7:]})
    assert sb.is_connected()
    assert any(e['name'] == 'connected' and e['args'][0]['user_id'] == _id(client, hb) for e in sb.get_received())
    # A envoie un message depuis l'app : B le recoit instantanement + une notification
    assert client.post('/api/messages', json={'destinataire_id': _id(client, hb), 'contenu': 'Salut B'}, headers=ha).status_code == 201
    recus = sb.get_received()
    msg = [e for e in recus if e['name'] == 'message_recu']
    assert msg and msg[0]['args'][0]['contenu'] == 'Salut B' and msg[0]['args'][0]['expediteur_id'] == _id(client, ha)
    assert any(e['name'] == 'notification_update' for e in recus)
    sb.disconnect()


def test_socket_jeton_invalide_non_identifie(client):
    s = linkci_app.socketio.test_client(linkci_app.app, auth={'token': '1:faux'})
    assert not any(e['name'] == 'connected' for e in s.get_received())
    s.disconnect()


def test_compteurs_et_lecture_notifications(client):
    ha, hb = _jeton_api(client, 'cpt_a@test.ci'), _jeton_api(client, 'cpt_b@test.ci')
    client.post('/api/messages', json={'destinataire_id': _id(client, hb), 'contenu': 'un'}, headers=ha)
    client.post('/api/messages', json={'destinataire_id': _id(client, hb), 'contenu': 'deux'}, headers=ha)
    linkci_app.creer_notification(_id(client, hb), 'like', 'A aime ta publication')
    c = client.get('/api/compteurs', headers=hb).get_json()
    assert c == {'messages': 2, 'notifications': 1}  # les notifs de message ne comptent pas en double
    client.get(f'/api/messages?avec={_id(client, ha)}', headers=hb)  # ouvrir la conversation marque lu
    client.post('/api/notifications/lire', headers=hb)
    assert client.get('/api/compteurs', headers=hb).get_json() == {'messages': 0, 'notifications': 0}


def test_message_destinataire_inexistant_ou_soi_meme(client):
    h = _jeton_api(client, 'msg_bug@test.ci')
    moi = _id(client, h)
    assert client.post('/api/messages', json={'destinataire_id': 999999, 'contenu': 'x'}, headers=h).status_code == 404
    assert client.post('/api/messages', json={'destinataire_id': moi, 'contenu': 'x'}, headers=h).status_code == 400


def test_rejoindre_groupe_inexistant(client):
    h = _jeton_api(client, 'grp_bug@test.ci')
    assert client.post('/api/groupes/999999/rejoindre', headers=h).status_code == 404


def test_badge_annonce_une_seule_fois(client):
    h = _jeton_api(client, 'badge@test.ci')
    uid = _id(client, h)
    conn = linkci_app.get_db()
    for i in range(10):
        conn.execute('INSERT INTO posts (user_id, contenu) VALUES (?, ?)', (uid, f'post {i}'))
    conn.commit()
    conn.close()
    assert 'Causeur' in linkci_app.check_and_award_badges(uid)
    assert linkci_app.check_and_award_badges(uid) == []  # deja obtenu : rien de nouveau


def test_notifications_push(client, monkeypatch):
    envoyes = []
    monkeypatch.setattr(linkci_app, '_envoyer_push_expo', lambda messages: envoyes.extend(messages))
    monkeypatch.setitem(linkci_app.app.config, 'TESTING', False)  # envoyer_push ne fait rien en mode test

    class ThreadDirect:
        def __init__(self, target, args, daemon):
            self.target, self.args = target, args
        def start(self):
            self.target(*self.args)
    monkeypatch.setattr(linkci_app.threading, 'Thread', ThreadDirect)

    ha, hb = _jeton_api(client, 'push_a@test.ci'), _jeton_api(client, 'push_b@test.ci')
    jeton = 'ExponentPushToken[abc123]'
    assert client.post('/api/expo_push_token', json={'token': 'faux'}, headers=hb).status_code == 400
    assert client.post('/api/expo_push_token', json={'token': jeton}, headers=hb).status_code == 200
    client.post('/api/messages', json={'destinataire_id': _id(client, hb), 'contenu': 'Coucou'}, headers=ha)
    assert envoyes and envoyes[-1]['to'] == jeton and envoyes[-1]['title'] == 'Nouveau message'
    # meme telephone connecte a un autre compte : l'ancien ne recoit plus rien
    client.post('/api/expo_push_token', json={'token': jeton}, headers=ha)
    conn = linkci_app.get_db()
    proprietaires = [r['user_id'] for r in conn.execute('SELECT user_id FROM expo_push_tokens WHERE token = ?', (jeton,)).fetchall()]
    conn.close()
    assert proprietaires == [_id(client, ha)]
    assert client.delete('/api/expo_push_token', json={'token': jeton}, headers=ha).status_code == 200


class _FausseConnexion:
    ouvertes = 0
    closed = False
    broken = False

    def __init__(self):
        _FausseConnexion.ouvertes += 1

    def close(self):
        _FausseConnexion.ouvertes -= 1


def test_une_connexion_par_fil(monkeypatch):
    """Les get_db() d'un meme fil reutilisent la meme connexion ; un autre fil a la sienne."""
    import threading
    import db
    monkeypatch.setattr(db, '_ouvrir', _FausseConnexion)
    monkeypatch.setattr(db, '_local', threading.local())
    _FausseConnexion.ouvertes = 0
    for _ in range(20):
        c = db.PgConnection()
        c.close()
    assert _FausseConnexion.ouvertes == 1
    fil = threading.Thread(target=lambda: db.PgConnection().close())
    fil.start()
    fil.join()
    assert _FausseConnexion.ouvertes == 2
