"""Traduction SQLite -> PostgreSQL : pas de RETURNING id pour les tables sans colonne id."""
import re
import db


def test_tables_sans_id_toutes_connues():
    # toute table creee sans colonne id doit etre dans db.TABLES_SANS_ID (sinon ses INSERT echouent sur PostgreSQL)
    schema = open('app.py', encoding='utf-8').read()
    sans_id = {m.group(1) for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\)(?:'''|\s*;)", schema, re.S)
               if not re.search(r'\bid INTEGER PRIMARY KEY', m.group(2))}
    assert sans_id and sans_id <= db.TABLES_SANS_ID, sans_id - db.TABLES_SANS_ID


def test_traduction_insert():
    assert db.translate('INSERT INTO posts (contenu) VALUES (?)').endswith('RETURNING id')
    assert 'RETURNING' not in db.translate('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
    assert 'RETURNING' not in db.translate('INSERT OR IGNORE INTO vues_profil (profil_id, visiteur_id, date_vue) VALUES (?, ?, ?)')
    assert db.translate('INSERT OR IGNORE INTO blocages (bloqueur_id, bloque_id) VALUES (?, ?)').endswith('ON CONFLICT DO NOTHING')


def test_inscription_email_deja_pris_comme_sous_postgresql(client, monkeypatch):
    """Sous PostgreSQL, db.IntegrityError est un tuple : l'inscription en double ne doit pas planter (500)."""
    import sqlite3
    import app as linkci_app

    class ErreurPg(Exception):
        pass
    monkeypatch.setattr(linkci_app.db, 'IntegrityError', (sqlite3.IntegrityError, ErreurPg))
    linkci_app.rate_limits.clear()
    donnees = {'nom': 'K', 'prenom': 'Waide', 'email': 'doublon.pg@test.ci', 'mot_de_passe': 'motdepasse123'}
    assert client.post('/api/register', json=donnees).status_code == 201
    r = client.post('/api/register', json=donnees)
    assert r.status_code == 409 and 'deja utilise' in r.get_json()['error']
    # compte pas encore verifie + meme mot de passe : un nouveau code au lieu d'une erreur
    from test_securite import sql
    sql("UPDATE users SET email_verifie = 0 WHERE email = 'doublon.pg@test.ci'")
    r = client.post('/api/register', json=donnees)
    assert r.status_code == 200 and r.get_json()['a_verifier'] is True
    # mauvais mot de passe : toujours refuse
    assert client.post('/api/register', json={**donnees, 'mot_de_passe': 'autrechose99'}).status_code == 409
    # inscription par le site : message d'erreur, pas de plantage
    r = client.post('/inscription', data={**donnees, 'confirmation': donnees['mot_de_passe']})
    assert r.status_code in (200, 302)
