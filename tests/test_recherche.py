"""Recherche globale, decouverte et suivre depuis l'app."""
import app as linkci_app
from test_securite import sql, entete


def compte(client, email, prenom, universite='', filiere=''):
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'Kone', 'prenom': prenom, 'email': email, 'mot_de_passe': 'motdepasse123',
                                              'universite': universite, 'filiere': filiere}).get_json()['token']
    return tok, client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_recherche_globale(client):
    tok, _ = compte(client, 'rech.a@test.ci', 'Moussa', 'UFHB', 'Chimie')
    tok_b, id_b = compte(client, 'rech.b@test.ci', 'Aminata', 'UFHB', 'Chimie')
    client.post('/api/posts', json={'contenu': 'Qui a le cours de thermodynamique ?'}, headers=entete(tok_b))
    client.post('/api/questions', json={'matiere': 'Chimie', 'titre': 'Exercice de thermodynamique ?'}, headers=entete(tok_b))
    client.post('/api/annonces', json={'categorie': 'livres', 'titre': 'Livre de thermodynamique'}, headers=entete(tok_b))
    r = client.get('/api/recherche?q=thermo', headers=entete(tok)).get_json()
    assert r['posts'] and r['questions'] and r['annonces']
    assert any(u['id'] == id_b for u in client.get('/api/recherche?q=aminata', headers=entete(tok)).get_json()['users'])
    # 1 lettre : rien ; caracteres speciaux sans erreur
    assert client.get('/api/recherche?q=a', headers=entete(tok)).get_json()['users'] == []
    assert client.get("/api/recherche?q=%25'%3B--", headers=entete(tok)).status_code == 200
    # bloque : n'apparait plus
    client.post(f'/api/utilisateurs/{id_b}/bloquer', headers=entete(tok))
    r = client.get('/api/recherche?q=thermo', headers=entete(tok)).get_json()
    assert not r['posts'] and not r['questions'] and not r['annonces']


def test_decouverte_et_suivre(client):
    tok, id_a = compte(client, 'dec.a@test.ci', 'Yao', 'INP-HB', 'Mines')
    tok_b, id_b = compte(client, 'dec.b@test.ci', 'Ama', 'INP-HB', 'Mines')
    client.post('/api/posts', json={'contenu': 'Revision ce soir #examens #INP'}, headers=entete(tok_b))
    d = client.get('/api/decouverte', headers=entete(tok)).get_json()
    assert d['etudiants'][0]['id'] == id_b and d['etudiants'][0]['raison'] == 'Ta filiere'
    assert {'tag': 'examens', 'nb': 1} in d['tendances']
    assert client.post(f'/api/utilisateurs/{id_b}/suivre', headers=entete(tok)).get_json()['suivi'] is True
    assert client.get(f'/api/profil/{id_b}', headers=entete(tok)).get_json()['suivi'] is True
    assert not any(u['id'] == id_b for u in client.get('/api/decouverte', headers=entete(tok)).get_json()['etudiants'])
    assert sql("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'suivi'", (id_b,))
    assert client.delete(f'/api/utilisateurs/{id_b}/suivre', headers=entete(tok)).get_json()['suivi'] is False
