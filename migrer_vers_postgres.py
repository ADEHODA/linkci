"""Copie une base SQLite LinkCI (et les fichiers envoyes) vers PostgreSQL.

Usage :
    set DATABASE_URL=postgresql://...        (PowerShell : $env:DATABASE_URL="postgresql://...")
    python migrer_vers_postgres.py [chemin/vers/linkci.db] [--force]

- Cree le schema dans PostgreSQL (via init_db de app.py).
- Copie toutes les lignes en conservant les id, puis recale les sequences.
- Importe les fichiers de static/uploads, static/avatars et uploads/ dans la
  table `fichiers` (ils survivent ainsi aux redeploiements Render).
- Refuse de tourner si la base cible contient deja des utilisateurs (sauf --force).
"""
import os
import sqlite3
import sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
FORCE = '--force' in sys.argv
ICI = os.path.dirname(os.path.abspath(__file__))
SOURCE = args[0] if args else os.path.join(ICI, 'linkci.db')

from dotenv import load_dotenv
load_dotenv()
if not os.environ.get('DATABASE_URL', '').startswith(('postgres://', 'postgresql://')):
    sys.exit('DATABASE_URL doit pointer vers PostgreSQL.')
if not os.path.exists(SOURCE):
    sys.exit(f'Base source introuvable : {SOURCE}')

import psycopg
import app  # noqa: E402  (cree le schema PostgreSQL a l'import)

# Parents avant enfants : PostgreSQL applique les cles etrangeres, SQLite non.
ORDRE = ['users', 'badges', 'formations', 'bourses', 'sondages', 'groupes', 'posts',
         'documents', 'evenements', 'fichiers']

src = sqlite3.connect(f'file:{SOURCE}?mode=ro', uri=True)
dst = psycopg.connect(os.environ['DATABASE_URL'], autocommit=True)

if not FORCE and dst.execute('SELECT COUNT(*) FROM users').fetchone()[0] > 0:
    sys.exit('La base PostgreSQL contient deja des utilisateurs. Relance avec --force pour continuer quand meme.')

tables_src = [r[0] for r in src.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%'")]
tables_dst = {r[0] for r in dst.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")}
tables = sorted((t for t in tables_src if t in tables_dst),
                key=lambda t: (ORDRE.index(t) if t in ORDRE else len(ORDRE), t))

print(f'Source : {SOURCE}')
for t in tables:
    cols_src = [r[1] for r in src.execute(f'PRAGMA table_info({t})')]
    cols_dst = {r[0] for r in dst.execute(
        'SELECT column_name FROM information_schema.columns WHERE table_name = %s', (t,))}
    cols = [c for c in cols_src if c in cols_dst]
    lignes = src.execute(f'SELECT {", ".join(cols)} FROM {t}').fetchall()
    sql = (f'INSERT INTO {t} ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))}) '
           'ON CONFLICT DO NOTHING')
    ok, rejetees = 0, 0
    for ligne in lignes:
        try:
            dst.execute(sql, ligne)
            ok += 1
        except psycopg.IntegrityError as e:
            # ligne orpheline (ex. like d'un post supprime) : SQLite l'acceptait
            rejetees += 1
            print(f'   ! {t} ignoree : {str(e).splitlines()[0]}')
    if 'id' in cols:
        dst.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {t}), 1), (SELECT MAX(id) FROM {t}) IS NOT NULL)")
    print(f'  {t:22} {ok:6} lignes' + (f'  ({rejetees} ignorees)' if rejetees else ''))

# Fichiers presents sur disque -> table fichiers
nb = 0
for dossier in ('static/uploads', 'static/avatars', 'uploads'):
    chemin_dossier = os.path.join(ICI, *dossier.split('/'))
    if not os.path.isdir(chemin_dossier):
        continue
    for nom in os.listdir(chemin_dossier):
        chemin = os.path.join(chemin_dossier, nom)
        if os.path.isfile(chemin):
            with open(chemin, 'rb') as f:
                dst.execute('INSERT INTO fichiers (chemin, contenu) VALUES (%s, %s) ON CONFLICT (chemin) DO NOTHING',
                            (f'{dossier}/{nom}', f.read()))
            nb += 1
print(f'  fichiers importes depuis le disque : {nb}')
print('Migration terminee.')
