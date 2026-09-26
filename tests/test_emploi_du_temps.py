"""Emploi du temps et examens : validation, droits, suppression de compte."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def test_cours_et_examens(client):
    tok = compte(client, 'edt.a@test.ci')
    autre = compte(client, 'edt.b@test.ci')
    assert client.post('/api/emploi_du_temps', json={'jour': 1, 'debut': '10:00', 'fin': '08:00', 'matiere': 'Algo'}, headers=entete(tok)).status_code == 400
    assert client.post('/api/emploi_du_temps', json={'jour': 9, 'debut': '08:00', 'fin': '10:00', 'matiere': 'Algo'}, headers=entete(tok)).status_code == 400
    client.post('/api/emploi_du_temps', json={'jour': 3, 'debut': '14:00', 'fin': '16:00', 'matiere': 'Reseaux', 'salle': 'Amphi B'}, headers=entete(tok))
    cours = client.post('/api/emploi_du_temps', json={'jour': 1, 'debut': '08:00', 'fin': '10:00', 'matiere': 'Algo'}, headers=entete(tok)).get_json()
    assert [c['matiere'] for c in cours] == ['Algo', 'Reseaux']  # tries par jour
    assert client.get('/api/emploi_du_temps', headers=entete(autre)).get_json() == []  # personnel
    client.delete(f"/api/emploi_du_temps/{cours[0]['id']}", headers=entete(autre))  # pas le sien : sans effet
    assert len(client.get('/api/emploi_du_temps', headers=entete(tok)).get_json()) == 2
    assert client.post('/api/examens', json={'matiere': 'Algo', 'date_examen': '2026-13-40'}, headers=entete(tok)).status_code == 400
    ex = client.post('/api/examens', json={'matiere': 'Algo', 'date_examen': '2026-12-15', 'heure': '08:30', 'salle': 'Amphi A'}, headers=entete(tok)).get_json()
    assert ex[0]['date_examen'] == '2026-12-15'
    client.delete(f"/api/examens/{ex[0]['id']}", headers=entete(tok))
    assert client.get('/api/examens', headers=entete(tok)).get_json() == []
