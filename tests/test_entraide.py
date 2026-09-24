"""Entraide : questions, reponses, votes, meilleure reponse, reputation, droits."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': email.split('@')[0], 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_parcours_complet(client):
    tok_q, id_q = compte(client, 'ent.q@test.ci')
    tok_r, id_r = compte(client, 'ent.r@test.ci')
    tok_v, _ = compte(client, 'ent.v@test.ci')
    assert client.post('/api/questions', json={'matiere': 'Maths', 'titre': 'x'}, headers=entete(tok_q)).status_code == 400
    qid = client.post('/api/questions', json={'matiere': 'Maths', 'titre': 'Comment deriver x^2 ?'}, headers=entete(tok_q)).get_json()['id']
    liste = client.get('/api/questions?filtre=sans_reponse', headers=entete(tok_r)).get_json()
    assert any(q['id'] == qid for q in liste['questions']) and 'Maths' in liste['matieres']

    rid = client.post(f'/api/questions/{qid}/reponses', json={'contenu': 'La derivee vaut 2x'}, headers=entete(tok_r)).get_json()['id']
    notif = sql("SELECT message FROM notifications WHERE user_id = ? AND type = 'entraide'", (id_q,))
    assert notif and 'repondu' in notif[0]['message']

    assert client.post(f'/api/reponses/{rid}/vote', headers=entete(tok_r)).status_code == 400  # sa propre reponse
    assert client.post(f'/api/reponses/{rid}/vote', headers=entete(tok_v)).get_json() == {'a_vote': True, 'votes': 1}
    assert client.post(f'/api/questions/{qid}/meilleure', json={'reponse_id': rid}, headers=entete(tok_v)).status_code == 403
    assert client.post(f'/api/questions/{qid}/meilleure', json={'reponse_id': rid}, headers=entete(tok_q)).status_code == 200

    detail = client.get(f'/api/questions/{qid}', headers=entete(tok_v)).get_json()
    assert detail['question']['resolue'] and detail['reponses'][0]['id'] == rid
    assert detail['reponses'][0]['points'] == 1 + 2 + 10
    classement = client.get('/api/entraide/classement', headers=entete(tok_r)).get_json()
    assert classement['mes_points'] == 13 and classement['classement'][0]['id'] == id_r


def test_suppression_droits(client):
    tok_a, _ = compte(client, 'ent.a@test.ci')
    tok_b, _ = compte(client, 'ent.b@test.ci')
    qid = client.post('/api/questions', json={'matiere': 'Droit', 'titre': 'Question de droit ?'}, headers=entete(tok_a)).get_json()['id']
    rid = client.post(f'/api/questions/{qid}/reponses', json={'contenu': 'Voir le code civil'}, headers=entete(tok_b)).get_json()['id']
    assert client.delete(f'/api/reponses/{rid}', headers=entete(tok_a)).status_code == 403
    assert client.delete(f'/api/questions/{qid}', headers=entete(tok_b)).status_code == 403
    assert client.delete(f'/api/questions/{qid}', headers=entete(tok_a)).status_code == 200
    assert not sql('SELECT 1 FROM reponses WHERE id = ?', (rid,))


def test_blocage_entraide(client):
    tok_a, id_a = compte(client, 'ent.blo.a@test.ci')
    tok_b, id_b = compte(client, 'ent.blo.b@test.ci')
    qid = client.post('/api/questions', json={'matiere': 'Info', 'titre': 'Python ou Java ?'}, headers=entete(tok_a)).get_json()['id']
    client.post(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok_a))
    assert client.post(f'/api/questions/{qid}/reponses', json={'contenu': 'Python'}, headers=entete(tok_b)).status_code == 409
    assert client.get(f'/api/questions/{qid}', headers=entete(tok_b)).status_code == 404
