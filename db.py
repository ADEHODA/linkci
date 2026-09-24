"""Acces PostgreSQL avec la meme interface que sqlite3.

En local (et pour les tests) LinkCI utilise SQLite. Si la variable
d'environnement DATABASE_URL pointe vers PostgreSQL (Neon, Render...),
get_db() renvoie a la place une PgConnection qui imite sqlite3 :
placeholders '?', row['col'] / row[0] / dict(row), cur.lastrowid,
conn.executescript(), conn.total_changes et IntegrityError.

Hypotheses (vraies pour le schema de LinkCI) :
- chaque table a une colonne `id` auto-incrementee (lastrowid s'appuie
  sur `RETURNING id`) ;
- les dates sont stockees en TEXT 'YYYY-MM-DD HH:MM:SS' comme dans SQLite,
  pour que les comparaisons et les [:10] du code restent valables.
"""
import atexit
import os
import re
import sqlite3

DATABASE_URL = os.environ.get('DATABASE_URL', '')
# Render/Heroku fournissent parfois postgres:// que libpq accepte aussi
IS_PG = DATABASE_URL.startswith(('postgres://', 'postgresql://'))

if IS_PG:
    import psycopg
    from psycopg_pool import ConnectionPool
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
    if _INSERT.match(sql) and not re.search(r'\bRETURNING\b', sql, re.I):
        sql += ' RETURNING id'
    return sql


def split_script(script):
    """Decoupe un script SQL simple (sans ';' dans les chaines) en requetes."""
    return [s.strip() for s in script.split(';') if s.strip()]


# ---------------------------------------------------------------- connexion

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=int(os.environ.get('DB_POOL_SIZE', '10')),
            timeout=15,  # echouer vite plutot que de bloquer 30 s
            # autocommit : une erreur (ex. IntegrityError attrapee par le code)
            # n'invalide pas la suite, comme avec SQLite.
            # prepare_threshold=None : compatible avec les poolers PgBouncer (Neon).
            kwargs={'autocommit': True, 'row_factory': _row_factory, 'prepare_threshold': None},
            check=ConnectionPool.check_connection,  # Neon coupe les connexions inactives
            open=True,
        )
        atexit.register(_pool.close)  # sinon erreur bruyante a l'arret de Python
    return _pool


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
    """Connexion empruntee au pool, rendue par close()."""

    def __init__(self):
        self._pool = _get_pool()
        self._conn = self._pool.getconn()
        self.total_changes = 0

    def execute(self, sql, params=()):
        pg_sql = translate(sql)
        is_insert = bool(_INSERT.match(pg_sql))
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
        if self._conn is not None:
            self._pool.putconn(self._conn)
            self._conn = None

    def __del__(self):
        # Filet de securite : une connexion oubliee (return avant close(),
        # exception...) est rendue au pool des qu'elle n'est plus referencee,
        # au lieu de bloquer le pool jusqu'au PoolTimeout.
        try:
            self.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def connect():
    return PgConnection()
