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
