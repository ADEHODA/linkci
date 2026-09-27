"""Groupes de promo prepares par l'admin, publication epinglee, resume du jour, miniatures d'images."""
import base64
import io
from datetime import datetime, timedelta, timezone
import app as linkci_app
from test_securite import sql, entete


def compte(client, email, admin=False):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    if admin:
        sql("UPDATE users SET role = 'admin' WHERE email = ?", (email,))
    return tok


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_groupes_promo_et_epingle(client):
    admin, etu = compte(client, 'ct.admin@test.ci', admin=True), compte(client, 'ct.etu@test.ci')
    assert client.get('/api/admin/groupes_promo', headers=entete(etu)).status_code == 403
    modeles = client.get('/api/admin/groupes_promo', headers=entete(admin)).get_json()
    choix = [m for m in modeles if m['universite'] == 'ESATIC'][:2]
    r = client.post('/api/admin/groupes_promo', json={'groupes': choix}, headers=entete(admin)).get_json()
    assert r['crees'] == 2
    assert client.post('/api/admin/groupes_promo', json={'groupes': choix}, headers=entete(admin)).get_json()['crees'] == 0  # pas de doublon
    noms = {c['nom'] for c in choix}
    assert all(m['existe'] for m in client.get('/api/admin/groupes_promo', headers=entete(admin)).get_json() if m['nom'] in noms)
    # publication de bienvenue epinglee en haut du fil
    client.post('/api/posts', json={'contenu': 'Bienvenue sur LinkCI !'}, headers=entete(admin))
    pid = sql("SELECT id FROM posts WHERE contenu = 'Bienvenue sur LinkCI !'")[0]['id']
    client.post('/api/posts', json={'contenu': 'Un post plus recent'}, headers=entete(etu))
    assert client.post(f'/api/admin/posts/{pid}/epingler', headers=entete(etu)).status_code == 403
    client.post(f'/api/admin/posts/{pid}/epingler', headers=entete(admin))
    fil = client.get('/api/posts', headers=entete(etu)).get_json()
    assert fil[0]['id'] == pid and fil[0]['epingle'] == 1
    assert [p['id'] for p in fil].count(pid) == 1  # pas en double
    assert pid not in [p['id'] for p in client.get('/api/posts?page=2', headers=entete(etu)).get_json()]
    client.delete(f'/api/admin/posts/{pid}/epingler', headers=entete(admin))
    assert sql('SELECT epingle FROM posts WHERE id = ?', (pid,))[0]['epingle'] == 0


def test_resume_du_jour(client):
    a, b = compte(client, 'rs.a@test.ci'), compte(client, 'rs.b@test.ci')
    ida, idb = uid(client, a), uid(client, b)
    maintenant = datetime.now(timezone.utc)
    aujourdhui = maintenant.strftime('%Y-%m-%d')
    depuis = (maintenant - timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'Tu viens demain ?'}, headers=entete(a))
    client.post('/api/messages', json={'destinataire_id': idb, 'contenu': 'Reponds stp'}, headers=entete(a))
    conn = linkci_app.get_db()
    texte = linkci_app.resume_du_jour(conn, idb, depuis, aujourdhui)
    conn.close()
    assert '2 messages non lus' in texte
    # une seule fois par jour
    conn = linkci_app.get_db()
    assert linkci_app.tache_a_faire(conn, 'essai_du_jour', maintenant) is True
    assert linkci_app.tache_a_faire(conn, 'essai_du_jour', maintenant) is False
    conn.close()


def test_miniature(client):
    from PIL import Image
    tok = compte(client, 'mini.a@test.ci')
    img = Image.new('RGB', (1600, 1200), (255, 107, 53))
    tampon = io.BytesIO()
    img.save(tampon, 'PNG')
    client.post('/api/posts', json={'contenu': 'Grande photo', 'image': base64.b64encode(tampon.getvalue()).decode()}, headers=entete(tok))
    nom = sql("SELECT image FROM posts WHERE contenu = 'Grande photo'")[0]['image']
    r = client.get(f'/mini/{nom}')
    assert r.status_code == 200 and r.mimetype == 'image/jpeg'
    mini = Image.open(io.BytesIO(r.data))
    assert mini.width == 640 and len(r.data) < len(tampon.getvalue())
    r.close()
    assert client.get('/mini/..%2Fapp.py').status_code == 404
