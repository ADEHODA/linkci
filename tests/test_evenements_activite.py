"""Evenements du campus (participation) et statistiques 'Mon activite'."""
from datetime import date, datetime, timedelta, timezone
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def demain():
    return (datetime.now(timezone.utc) + timedelta(days=1)).strftime('%Y-%m-%d')


def test_evenement_validation_et_participation(client):
    tok = compte(client, 'ev.a@test.ci')
    autre = compte(client, 'ev.b@test.ci')
    assert client.post('/api/evenements', json={'titre': 'X', 'date_event': '2026-02-30'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/evenements', json={'titre': 'X', 'date_event': '2020-01-01'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/evenements', json={'titre': 'X', 'date_event': demain(), 'heure': '25:00'}, headers=entete(tok)).status_code == 400
    ev = client.post('/api/evenements', json={'titre': 'Tournoi de foot', 'date_event': demain(), 'heure': '16:00',
                                               'categorie': 'sport', 'lieu': 'Stade'}, headers=entete(tok)).get_json()
    assert ev['categorie'] == 'sport' and ev['nb_participants'] == 1 and ev['je_participe'] and ev['est_auteur']
    vus = client.get('/api/evenements', headers=entete(autre)).get_json()
    mien = [e for e in vus if e['id'] == ev['id']][0]
    assert mien['je_participe'] is False and mien['est_auteur'] is False
    r = client.post(f"/api/evenements/{ev['id']}/participer", headers=entete(autre)).get_json()
    assert r == {'je_participe': True, 'nb_participants': 2}
    client.post(f"/api/evenements/{ev['id']}/participer", headers=entete(autre))  # deux fois : pas de doublon
    assert len(client.get(f"/api/evenements/{ev['id']}/participants", headers=entete(tok)).get_json()) == 2
    assert [e['id'] for e in client.get('/api/evenements?mes=1', headers=entete(autre)).get_json()] == [ev['id']]
    assert ev['id'] not in [e['id'] for e in client.get('/api/evenements?categorie=soiree', headers=entete(autre)).get_json()]
    r = client.delete(f"/api/evenements/{ev['id']}/participer", headers=entete(autre)).get_json()
    assert r == {'je_participe': False, 'nb_participants': 1}
    assert client.delete(f"/api/evenements/{ev['id']}", headers=entete(autre)).status_code == 403
    assert client.delete(f"/api/evenements/{ev['id']}", headers=entete(tok)).status_code == 200
    assert sql('SELECT COUNT(*) AS n FROM evenement_participants WHERE evenement_id = ?', (ev['id'],))[0]['n'] == 0


def test_serie_jours():
    j = date(2026, 9, 26)
    assert linkci_app.serie_jours([], j) == (0, 0)
    assert linkci_app.serie_jours(['2026-09-26', '2026-09-25', '2026-09-24', '2026-09-20', '2026-09-19'], j) == (3, 3)
    assert linkci_app.serie_jours(['2026-09-25', '2026-09-24'], j) == (2, 2)  # hier actif : la serie tient
    assert linkci_app.serie_jours(['2026-09-23', '2026-09-22', '2026-09-21', '2026-09-20'], j) == (0, 4)


def test_mon_activite(client):
    tok = compte(client, 'act.a@test.ci')
    autre = compte(client, 'act.b@test.ci')
    moi = client.get('/api/me', headers=entete(tok)).get_json()['id']
    client.post('/api/posts', json={'contenu': 'Ma premiere publication'}, headers=entete(tok))
    post = sql('SELECT id FROM posts WHERE user_id = ?', (moi,))[0]['id']
    client.post(f'/api/posts/{post}/like', headers=entete(autre))
    client.post(f'/api/utilisateurs/{moi}/suivre', headers=entete(autre))
    a = client.get('/api/mon_activite', headers=entete(tok)).get_json()
    assert a['publications'] == 1 and a['likes_recus'] == 1 and a['abonnes'] == 1 and a['abonnes_30j'] == 1
    assert a['serie'] == 1 and a['record'] == 1 and a['jours_actifs_30j'] == 1
    assert len(a['calendrier']) == 28 and a['calendrier'][-1]['actif']
    assert a['meilleure_publication']['nb_likes'] == 1
    assert client.get('/api/mon_activite').status_code == 401
