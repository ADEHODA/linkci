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
