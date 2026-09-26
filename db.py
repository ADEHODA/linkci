"""Acces PostgreSQL avec la meme interface que sqlite3.

En local (et pour les tests) LinkCI utilise SQLite. Si la variable
d'environnement DATABASE_URL pointe vers PostgreSQL (Neon, Render...),
get_db() renvoie a la place une PgConnection qui imite sqlite3 :
placeholders '?', row['col'] / row[0] / dict(row), cur.lastrowid,
conn.executescript(), conn.total_changes et IntegrityError.

Hypotheses (vraies pour le schema de LinkCI) :
- lastrowid s'appuie sur `RETURNING id`, ajoute aux INSERT, sauf pour les
  tables sans colonne `id` (cle primaire composee : TABLES_SANS_ID ; une
  table oubliee y est ajoutee automatiquement a la premiere erreur) ;
- les dates sont stockees en TEXT 'YYYY-MM-DD HH:MM:SS' comme dans SQLite,
  pour que les comparaisons et les [:10] du code restent valables.
"""
import os
import threading
import re
import sqlite3

DATABASE_URL = os.environ.get('DATABASE_URL', '')
# Render/Heroku fournissent parfois postgres:// que libpq accepte aussi
IS_PG = DATABASE_URL.startswith(('postgres://', 'postgresql://'))

if IS_PG:
    import psycopg
    IntegrityError = (sqlite3.IntegrityError, psycopg.IntegrityError)
else:
    IntegrityError = sqlite3.IntegrityError


class Row:
    """Equivalent de sqlite3.Row : acces par index, par nom, et dict(row)."""
    __slots__ = ('_keys', '_values', '_index')

    def __init__(self, keys, index, values):
        self._keys = keys
        self._index = index
        self._values = values

    def __getitem__(self, key):
        if isinstance(key, str):
            return self._values[self._index[key]]
        return self._values[key]

    def keys(self):
        return list(self._keys)

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def __repr__(self):
        return f'Row({dict(zip(self._keys, self._values))!r})'


def _row_factory(cursor):
    keys = [d.name for d in cursor.description] if cursor.description else []
    index = {}
    for i, k in enumerate(keys):
        index.setdefault(k, i)  # comme sqlite3.Row : la premiere colonne gagne
    return lambda values: Row(keys, index, values)


# ---------------------------------------------------------------- traduction

_DDL_RULES = [
    (re.compile(r'\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b', re.I), 'SERIAL PRIMARY KEY'),
    (re.compile(r'\bTIMESTAMP\s+DEFAULT\s+CURRENT_TIMESTAMP\b', re.I),
     "TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))"),
    (re.compile(r'\bTIMESTAMP\b', re.I), 'TEXT'),
    (re.compile(r'\bBLOB\b', re.I), 'BYTEA'),
    (re.compile(r'\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)', re.I), 'ADD COLUMN IF NOT EXISTS '),
]
_INSERT_OR_IGNORE = re.compile(r'^\s*INSERT\s+OR\s+IGNORE\s+INTO\b', re.I)
_INSERT = re.compile(r'^\s*INSERT\b', re.I)
_LIKE = re.compile(r'\bLIKE\b', re.I)
_TABLE_INSERT = re.compile(r'^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)', re.I)
# Tables sans colonne `id` (cle primaire composee) : jamais de RETURNING id
TABLES_SANS_ID = {'reactions', 'post_sondage_votes', 'votes_reponses', 'conversations_effacees', 'vues_profil',
                  'posts_enregistres', 'message_reactions', 'defis_reussis', 'evenement_participants',
                  'jours_actifs', 'blocages'}


def table_insert(sql):
    m = _TABLE_INSERT.match(sql)
    return m.group(1).lower() if m else None


def translate(sql):
    """Convertit une requete ecrite pour SQLite en requete PostgreSQL."""
    for pattern, repl in _DDL_RULES:
        sql = pattern.sub(repl, sql)
    # psycopg utilise %s : les % litteraux doivent etre doubles
    sql = sql.replace('%', '%%').replace('?', '%s')
    # LIKE est insensible a la casse sous SQLite, pas sous PostgreSQL
    sql = _LIKE.sub('ILIKE', sql)
    sql = sql.rstrip().rstrip(';')
    if _INSERT_OR_IGNORE.match(sql):
        sql = _INSERT_OR_IGNORE.sub('INSERT INTO', sql) + ' ON CONFLICT DO NOTHING'
    if _INSERT.match(sql) and not re.search(r'\bRETURNING\b', sql, re.I) and table_insert(sql) not in TABLES_SANS_ID:
        sql += ' RETURNING id'
    return sql


def split_script(script):
    """Decoupe un script SQL simple (sans ';' dans les chaines) en requetes."""
    return [s.strip() for s in script.split(';') if s.strip()]


# ---------------------------------------------------------------- connexion

# Une connexion par fil d'execution (thread), reutilisee d'une requete a
# l'autre : ouvrir une connexion TLS vers Neon coute ~0,5 s. Rien n'est
# partage entre fils (pas de verrou commun : l'ancien pool psycopg_pool se
# bloquait en production). Neon a son propre gestionnaire de connexions.
_local = threading.local()


def _connexion_du_fil(neuve=False):
    c = getattr(_local, 'conn', None)
    if neuve or c is None or c.closed or c.broken:
        if c is not None and not c.closed:
            try:
                c.close()
            except Exception:
                pass
        c = _ouvrir()
        _local.conn = c
    return c


def _ouvrir():
    return psycopg.connect(
        DATABASE_URL,
        # autocommit : une erreur (ex. IntegrityError attrapee par le code)
        # n'invalide pas la suite, comme avec SQLite.
        autocommit=True,
        row_factory=_row_factory,
        prepare_threshold=None,  # compatible avec les poolers PgBouncer (Neon)
        connect_timeout=10,
    )


class PgCursor:
    def __init__(self, cur, is_insert):
        self._cur = cur
        self.lastrowid = None
        if is_insert and cur.description:
            row = cur.fetchone()
            self.lastrowid = row[0] if row else None

    @property
    def rowcount(self):
        return self._cur.rowcount

    def fetchone(self):
        return self._cur.fetchone() if self._cur.description else None

    def fetchall(self):
        return self._cur.fetchall() if self._cur.description else []

    def __iter__(self):
        return iter(self.fetchall())


class PgConnection:
    """Acces a la connexion PostgreSQL du fil courant ; close() la rend au fil."""

    def __init__(self):
        self._conn = _connexion_du_fil()
        self.total_changes = 0

    def execute(self, sql, params=()):
        pg_sql = translate(sql)
        is_insert = bool(_INSERT.match(pg_sql))
        try:
            cur = self._conn.execute(pg_sql, tuple(params))
        except psycopg.errors.UndefinedColumn:
            # table sans colonne `id` pas encore connue : on la retient et on reessaie sans RETURNING
            table = table_insert(sql)
            if not is_insert or not table or table in TABLES_SANS_ID or re.search(r'\bRETURNING\b', sql, re.I):
                raise
            TABLES_SANS_ID.add(table)
            pg_sql = translate(sql)
            cur = self._conn.execute(pg_sql, tuple(params))
        except psycopg.OperationalError:
            # connexion coupee (Neon endormi, reseau) : une nouvelle, un seul essai
            self._conn = _connexion_du_fil(neuve=True)
            cur = self._conn.execute(pg_sql, tuple(params))
        if is_insert or cur.description is None:
            self.total_changes += max(cur.rowcount, 0)
        return PgCursor(cur, is_insert)

    def executescript(self, script):
        for stmt in split_script(script):
            self.execute(stmt)

    def commit(self):
        pass  # autocommit

    def rollback(self):
        pass

    def close(self):
        # la connexion reste ouverte pour la prochaine requete de ce fil
        self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def connect():
    return PgConnection()
