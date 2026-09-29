"""Administration dans l'app : droits, statistiques, moderation, annonce, bannissement."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email, admin=False):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    if admin:
        sql("UPDATE users SET role = 'admin' WHERE email = ?", (email,))
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_reserve_aux_admins(client):
    tok, _ = compte(client, 'pasadmin@test.ci')
    assert client.get('/api/me', headers=entete(tok)).get_json()['est_admin'] is False
    for url in ('/api/admin/stats', '/api/admin/moderation', '/api/admin/utilisateurs'):
        assert client.get(url, headers=entete(tok)).status_code == 403
    assert client.post('/api/admin/annonce', json={'message': 'pirate !'}, headers=entete(tok)).status_code == 403


def test_stats_et_annonce(client):
    admin, _ = compte(client, 'chef.app@test.ci', admin=True)
    assert client.get('/api/me', headers=entete(admin)).get_json()['est_admin'] is True
    st = client.get('/api/admin/stats', headers=entete(admin)).get_json()
    assert st['totaux']['utilisateurs'] >= 1 and len(st['inscriptions']) == 14
    assert 'retention' in st and 'facs' in st and 'cohortes' in st and len(st['cohortes']) == 8
    assert client.post('/api/admin/annonce', json={'message': 'Bonne rentree a tous'}, headers=entete(admin)).status_code == 200
    assert sql("SELECT COUNT(*) AS nb FROM notifications WHERE type = 'annonce'")[0]['nb'] >= 1


def test_moderation_et_bannissement(client):
    admin, _ = compte(client, 'chef2.app@test.ci', admin=True)
    etu, id_etu = compte(client, 'etu2.app@test.ci')
    oid = client.post('/api/opportunites', json={'type': 'job', 'titre': 'Serveur week-end', 'entreprise': 'Maquis',
                                                 'contact': 'contact@maquis.ci'}, headers=entete(etu)).get_json()['id']
    props = client.get('/api/admin/moderation', headers=entete(admin)).get_json()['propositions']
    assert any(p['genre'] == 'opportunite' and p['id'] == oid for p in props)
    assert client.post(f'/api/admin/moderation/opportunite/{oid}/valider', headers=entete(admin)).status_code == 200
    assert sql('SELECT valide FROM opportunites WHERE id = ?', (oid,))[0]['valide'] == 1
    assert client.post(f'/api/admin/moderation/opportunite/{oid}/valider', headers=entete(admin)).status_code == 404

    pid = client.post('/api/posts', json={'contenu': 'spam spam'}, headers=entete(etu)).get_json()['id']
    client.post(f'/api/posts/{pid}/signaler', json={'motif': 'spam'}, headers=entete(admin))
    assert client.delete(f'/api/admin/signalements/{pid}', headers=entete(admin)).status_code == 200
    assert not sql('SELECT 1 FROM posts WHERE id = ?', (pid,))

    assert client.post(f'/api/admin/utilisateurs/{id_etu}/bannir', headers=entete(admin)).get_json()['banni'] is True
    assert client.get('/api/me', headers=entete(etu)).status_code == 401  # jeton refuse une fois banni


def test_tableau_de_bord_croissance(client):
    """Retention et activite par fac/filiere : calculs directs des fonctions du tableau de bord."""
    import app as linkci_app
    from datetime import datetime, timedelta, timezone

    conn = linkci_app.get_db()
    assert linkci_app.taux_retention(conn, 9999) is None  # personne n'est inscrit depuis 9999 jours
    conn.close()

    tok1, id1 = compte(client, 'dash.actif@test.ci')
    tok2, id2 = compte(client, 'dash.inactif@test.ci')
    uni = 'Universite Test Dashboard'
    sql("UPDATE users SET universite = ?, filiere = 'Test A' WHERE id IN (?, ?)", (uni, id1, id2))
    il_y_a_10j = (datetime.now(timezone.utc) - timedelta(days=10))
    sql("UPDATE users SET date_inscription = ? WHERE id IN (?, ?)", (il_y_a_10j.strftime('%Y-%m-%d %H:%M:%S'), id1, id2))
    # compte(...) authentifie deja id1 et id2 aujourd'hui (noter_jour_actif a chaque appel API) :
    # on retire id2 pour simuler un compte inactif cette semaine.
    sql('DELETE FROM jours_actifs WHERE user_id = ?', (id2,))

    conn = linkci_app.get_db()
    facs = linkci_app.activite_par_fac(conn, limite=1000)
    ligne = next(f for f in facs if f['universite'] == uni and f['filiere'] == 'Test A')
    assert ligne['utilisateurs'] == 2 and ligne['actifs_7j'] == 1

    # NB : suppose qu'aucun autre test ne recule date_inscription au-dela de 7/30 jours (vrai aujourd'hui).
    assert linkci_app.taux_retention(conn, 7) == 50  # 1 actif sur 2 eligibles (nos 2 comptes de test)
    assert linkci_app.taux_retention(conn, 30) is None  # personne n'est inscrit depuis 30 jours

    lundi = lambda d: d - timedelta(days=d.weekday())
    semaine = lundi(il_y_a_10j.date()).isoformat()
    cohortes = linkci_app.cohortes_retention(conn, nb_semaines=8)
    conn.close()
    ligne_cohorte = next(c for c in cohortes if c['semaine'] == semaine)
    assert ligne_cohorte['inscrits'] >= 2 and ligne_cohorte['actifs'] >= 1
