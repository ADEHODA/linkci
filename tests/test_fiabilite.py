"""Fiabilite : /sante, journal des erreurs, compression."""
import pytest
import app as linkci_app
from test_securite import sql, entete


def test_sante(client):
    r = client.get('/sante')
    assert r.status_code == 200 and r.get_json() == {'ok': True}


def test_erreur_journalisee_et_visible_admin(client, monkeypatch):
    # une page qui plante (on remplace temporairement /sante)
    monkeypatch.setitem(linkci_app.app.view_functions, 'sante', lambda: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        client.get('/sante')
    monkeypatch.undo()
    assert sql("SELECT 1 FROM erreurs WHERE route = 'GET /sante' AND message LIKE 'ZeroDivisionError%'")
    linkci_app.rate_limits.clear()
    tok = client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': 'err.admin@test.ci', 'mot_de_passe': 'motdepasse123'}).get_json()['token']
    sql("UPDATE users SET role = 'admin' WHERE email = 'err.admin@test.ci'")
    st = client.get('/api/admin/stats', headers=entete(tok)).get_json()
    assert st['erreurs']['nb_24h'] >= 1 and st['erreurs']['recentes'][0]['route'] == 'GET /sante'


def test_reponses_compressees(client):
    r = client.get('/conditions', headers={'Accept-Encoding': 'gzip'})
    assert r.headers.get('Content-Encoding') == 'gzip'
