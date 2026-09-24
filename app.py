import os, uuid, io
import sqlite3
import hashlib
import bcrypt
from dotenv import load_dotenv
from datetime import datetime, date, timedelta, timezone

load_dotenv()
import db  # apres load_dotenv : lit DATABASE_URL
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash, send_file
try:
    from flask_socketio import SocketIO, emit, join_room, leave_room
    SOCKETIO_AVAILABLE = True
except ImportError:
    SOCKETIO_AVAILABLE = False
    # Dummy classes/functions when socketio not installed
    class SocketIO:
        def __init__(self, *a, **kw): self.emit = lambda *a,**kw: None
        def run(self, *a, **kw): pass
        def on(self, *a, **kw): return lambda f: f
    def emit(*a, **kw): pass
    def join_room(*a, **kw): pass
    def leave_room(*a, **kw): pass

def hash_password(mdp):
    return bcrypt.hashpw(mdp.encode(), bcrypt.gensalt()).decode()

def check_password(mdp, hashed):
    if hashed.startswith('$2'):
        return bcrypt.checkpw(mdp.encode(), hashed.encode())
    return hashlib.sha256(mdp.encode()).hexdigest() == hashed

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload
# Securite des cookies de session : inaccessibles au JavaScript, pas envoyes par les
# autres sites (Lax), et uniquement en HTTPS en production.
EN_PRODUCTION = bool(os.environ.get('RENDER'))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=EN_PRODUCTION,
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
)
if EN_PRODUCTION:
    # Render place un proxy devant l'app : on recupere la vraie IP du visiteur
    # (sinon tous les visiteurs partagent la meme limite de tentatives)
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Temps reel : seul le site LinkCI peut ouvrir une connexion avec les cookies du
# visiteur (l'app mobile n'envoie pas d'en-tete Origin, elle reste acceptee).
ORIGINES_AUTORISEES = [o.strip() for o in os.environ.get(
    'SITE_ORIGINS', 'https://linkci.onrender.com,http://localhost:5000,http://127.0.0.1:5000').split(',') if o.strip()]
# threading (+ simple-websocket) : eventlet est deprecie
socketio = SocketIO(app, cors_allowed_origins=ORIGINES_AUTORISEES, async_mode='threading')

# Administrateurs : role en base (colonne users.role). Les comptes listes ici
# (deja inscrits) recoivent le role au demarrage. Ne jamais reconnaitre un admin
# a sa seule adresse e-mail : n'importe qui pourrait s'inscrire avec.
ADMIN_EMAILS = [e.strip().lower() for e in os.environ.get('ADMIN_EMAILS', 'fakeyeade225@gmail.com').split(',') if e.strip()]

def est_admin(user):
    return bool(user) and 'role' in user.keys() and user['role'] == 'admin'

# Rate limiting (in-memory with periodic cleanup)
from collections import defaultdict
import time
import threading
rate_limits = defaultdict(list)
RATE_WINDOW = 60
RATE_MAX = 10

RATE_LIMITS = {
    'inscription': {'max': 3, 'window': 300},
    'connexion': {'max': 5, 'window': 60},
    'publication': {'max': 10, 'window': 60},
    'commentaire': {'max': 20, 'window': 60},
    'message': {'max': 30, 'window': 60},
    'api_login': {'max': 10, 'window': 60},
    'api_register': {'max': 3, 'window': 300},
    'default': {'max': 30, 'window': 60},
}

def get_rate_limit(key):
    for k, v in RATE_LIMITS.items():
        if k in key:
            return v
    return RATE_LIMITS['default']

def check_rate_limit(key, max_reqs=None, window=None):
    if app.config.get('TESTING'):
        return True
    if max_reqs is None or window is None:
        cfg = get_rate_limit(key)
        max_reqs = cfg['max']
        window = cfg['window']
    now = time.time()
    timestamps = rate_limits[key]
    rate_limits[key] = [t for t in timestamps if now - t < window]
    if len(rate_limits[key]) >= max_reqs:
        return False
    rate_limits[key].append(now)
    return True

def cleanup_rate_limits():
    now = time.time()
    for key in list(rate_limits.keys()):
        rate_limits[key] = [t for t in rate_limits[key] if now - t < 3600]
        if not rate_limits[key]:
            del rate_limits[key]
    t = threading.Timer(300, cleanup_rate_limits)
    t.daemon = True  # ne bloque pas l'arret du processus (tests, scripts)
    t.start()

cleanup_rate_limits()

# CSRF Protection
import secrets
csrf_exempt_routes = {'/api/register', '/api/login'}

def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(32)
    return session['_csrf_token']

def validate_csrf():
    token = request.form.get('_csrf_token')
    return token and session.get('_csrf_token') and token == session['_csrf_token']

@app.before_request
def check_csrf():
    if app.config.get('TESTING'):
        return
    if request.method == 'POST' and not request.path.startswith('/api/'):
        if not request.path.startswith('/api') and request.path not in csrf_exempt_routes:
            if not validate_csrf():
                flash('Formulaire invalide (CSRF). Reessaie.', 'error')
                return redirect(request.referrer or url_for('index'))
    # Ban check for authenticated users (pas pour les fichiers statiques : evite une requete SQL par image)
    if 'user_id' in session and request.endpoint != 'static':
        try:
            conn = get_db()
            banni = conn.execute('SELECT banni, jeton_version FROM users WHERE id = ?', (session['user_id'],)).fetchone()
            conn.close()
            # mot de passe reinitialise depuis : cette session est revoquee
            if banni and 'v' in session and (banni['jeton_version'] or 0) != session['v']:
                session.clear()
                flash('Ton mot de passe a change : reconnecte-toi.', 'info')
                return redirect(url_for('connexion'))
            if banni and banni['banni']:
                session.clear()
                flash('Votre compte a ete suspendu. Contactez l\'administration.', 'error')
                return redirect(url_for('connexion'))
        except Exception:
            pass

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf_token)

# Input validation helpers
import re
def validate_email(email):
    return re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email.strip()) is not None

def sanitize_text(text, maxlen=500):
    return text.strip()[:maxlen] if text else ''

MDP_MIN = 8

def validate_password(password):
    return len(password or '') >= MDP_MIN

def normaliser_email(email):
    return (email or '').strip().lower()

def lien_sur(url):
    """N'accepte que les liens http(s) : bloque javascript:, data:, intent:..."""
    url = (url or '').strip()
    return url if re.match(r'^https?://[^\s<>"]+$', url, re.I) else ''

FIELD_MAXLEN = {
    'nom': 50, 'prenom': 50, 'email': 120, 'universite': 100,
    'filiere': 100, 'bio': 500, 'titre': 200, 'description': 2000,
    'contenu': 5000, 'organisme': 200, 'message': 5000,
}

DB_PATH = os.path.join(os.path.dirname(__file__), 'linkci.db')

def get_db():
    if db.IS_PG:
        return db.connect()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ===================== FICHIERS (images, avatars, documents) =====================
# Les fichiers sont ecrits sur disque ET dans la table `fichiers`. Le disque
# n'est qu'un cache : sur Render il est efface a chaque redeploiement, et les
# fichiers manquants sont restaures depuis la base a la premiere demande.
# `chemin` est relatif a app.root_path, avec des '/' (ex. 'static/uploads/x.png').

def _chemin_disque(chemin):
    return os.path.join(app.root_path, *chemin.split('/'))

def stocker_fichier(chemin, data):
    disque = _chemin_disque(chemin)
    os.makedirs(os.path.dirname(disque), exist_ok=True)
    with open(disque, 'wb') as f:
        f.write(data)
    conn = get_db()
    conn.execute('DELETE FROM fichiers WHERE chemin = ?', (chemin,))
    conn.execute('INSERT INTO fichiers (chemin, contenu) VALUES (?, ?)', (chemin, data))
    conn.commit()
    conn.close()

def extension_image(data):
    """Extension d'apres le contenu reel du fichier, ou None si ce n'est pas une image acceptee."""
    if data[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return '.gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return '.webp'
    return None

def restaurer_fichier(chemin):
    """Garantit que le fichier est sur disque. Renvoie False s'il n'existe nulle part."""
    disque = _chemin_disque(chemin)
    if os.path.exists(disque):
        return True
    conn = get_db()
    row = conn.execute('SELECT contenu FROM fichiers WHERE chemin = ?', (chemin,)).fetchone()
    conn.close()
    if not row:
        return False
    os.makedirs(os.path.dirname(disque), exist_ok=True)
    with open(disque, 'wb') as f:
        f.write(bytes(row['contenu']))
    return True

def supprimer_fichier(chemin):
    try:
        disque = _chemin_disque(chemin)
        if os.path.exists(disque):
            os.remove(disque)
    except OSError:
        pass
    conn = get_db()
    conn.execute('DELETE FROM fichiers WHERE chemin = ?', (chemin,))
    conn.commit()
    conn.close()

@app.before_request
def restaurer_fichier_statique():
    if request.method != 'GET':
        return
    p = request.path
    if (p.startswith('/static/uploads/') or p.startswith('/static/avatars/')) and '..' not in p:
        restaurer_fichier(p.lstrip('/'))

def init_db():
    conn = get_db()
    # Migration: ajouter colonne expiree si elle n'existe pas
    try:
        conn.execute('ALTER TABLE bourses ADD COLUMN expiree INTEGER DEFAULT 0')
    except:
        pass  # La colonne existe deja

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            prenom TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            mot_de_passe TEXT NOT NULL,
            universite TEXT,
            filiere TEXT,
            annee TEXT,
            bio TEXT DEFAULT '',
            avatar TEXT DEFAULT 'default.png',
            banni INTEGER DEFAULT 0,
            date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            image TEXT,
            date_post TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            post_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (post_id) REFERENCES posts(id),
            UNIQUE(user_id, post_id)
        );

        CREATE TABLE IF NOT EXISTS commentaires (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            post_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            date_commentaire TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (post_id) REFERENCES posts(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expediteur_id INTEGER NOT NULL,
            destinataire_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            lu INTEGER DEFAULT 0,
            date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (expediteur_id) REFERENCES users(id),
            FOREIGN KEY (destinataire_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            titre TEXT NOT NULL,
            description TEXT,
            fichier TEXT NOT NULL,
            matiere TEXT,
            universite TEXT,
            telechargements INTEGER DEFAULT 0,
            date_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS sondages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            interesse TEXT NOT NULL,
            fonction_preferee TEXT NOT NULL,
            universite TEXT NOT NULL,
            probleme TEXT NOT NULL,
            suggestion TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            date_reponse TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bourses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titre TEXT NOT NULL,
            organisme TEXT NOT NULL,
            description TEXT NOT NULL,
            montant TEXT DEFAULT '',
            type TEXT NOT NULL,
            cible TEXT DEFAULT '',
            deadline TEXT DEFAULT '',
            lien TEXT DEFAULT '',
            pays TEXT DEFAULT '',
            expiree INTEGER DEFAULT 0,
            date_publication TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            lien TEXT DEFAULT '',
            lu INTEGER DEFAULT 0,
            date_notification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS formations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            universite TEXT NOT NULL,
            niveau TEXT NOT NULL,
            description TEXT DEFAULT '',
            duree TEXT DEFAULT '',
            debouches TEXT DEFAULT '',
            frais TEXT DEFAULT '',
            site_web TEXT DEFAULT '',
            date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS abonnements_alertes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            actif INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, type)
        );

        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expire TIMESTAMP NOT NULL,
            utilise INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS evenements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            titre TEXT NOT NULL,
            description TEXT DEFAULT '',
            date_event TEXT NOT NULL,
            lieu TEXT DEFAULT '',
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS groupes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            description TEXT DEFAULT '',
            universite TEXT DEFAULT '',
            createur_id INTEGER NOT NULL,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (createur_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS groupe_membres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupe_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT DEFAULT 'membre',
            date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (groupe_id) REFERENCES groupes(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(groupe_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS groupe_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupe_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            date_envoi TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (groupe_id) REFERENCES groupes(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS badges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            icone TEXT DEFAULT '⭐',
            critere_type TEXT NOT NULL,
            critere_seuil INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_badges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            badge_id INTEGER NOT NULL,
            date_obtention TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (badge_id) REFERENCES badges(id),
            UNIQUE(user_id, badge_id)
        );

        CREATE TABLE IF NOT EXISTS fichiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chemin TEXT UNIQUE NOT NULL,
            contenu BLOB NOT NULL,
            date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')

    # Securite : role (admin) et version des jetons (revocation des sessions de l'app)
    for colonne in ("role TEXT DEFAULT 'etudiant'", 'jeton_version INTEGER DEFAULT 0'):
        try:
            conn.execute('ALTER TABLE users ADD COLUMN ' + colonne)
            conn.commit()
        except Exception:
            pass  # colonne deja presente
    for email in ADMIN_EMAILS:
        conn.execute("UPDATE users SET role = 'admin' WHERE lower(email) = ?", (email,))
    conn.commit()

    # FTS5 full-text search tables (SQLite uniquement ; sous PostgreSQL la
    # recherche utilise le repli ILIKE)
    if not db.IS_PG:
        try:
            conn.executescript('''
                CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(contenu, content=posts, content_rowid=id);
                CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(prenom, nom, email, universite, filiere, content=users, content_rowid=id);
                CREATE VIRTUAL TABLE IF NOT EXISTS bourses_fts USING fts5(titre, description, organisme, content=bourses, content_rowid=id);
                CREATE VIRTUAL TABLE IF NOT EXISTS formations_fts USING fts5(nom, description, universite, content=formations, content_rowid=id);
            ''')
        except Exception:
            pass  # FTS5 may not be available

        # FTS triggers to keep indexes in sync
        try:
            conn.executescript('''
                DROP TRIGGER IF EXISTS posts_ai; CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN INSERT INTO posts_fts(rowid, contenu) VALUES (new.id, new.contenu); END;
                DROP TRIGGER IF EXISTS posts_ad; CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN INSERT INTO posts_fts(posts_fts, rowid, contenu) VALUES('delete', old.id, old.contenu); END;
                DROP TRIGGER IF EXISTS posts_au; CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN INSERT INTO posts_fts(posts_fts, rowid, contenu) VALUES('delete', old.id, old.contenu); INSERT INTO posts_fts(rowid, contenu) VALUES (new.id, new.contenu); END;
                DROP TRIGGER IF EXISTS users_ai; CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN INSERT INTO users_fts(rowid, prenom, nom, email, universite, filiere) VALUES (new.id, new.prenom, new.nom, new.email, new.universite, new.filiere); END;
                DROP TRIGGER IF EXISTS users_ad; CREATE TRIGGER users_ad AFTER DELETE ON users BEGIN INSERT INTO users_fts(users_fts, rowid, prenom, nom, email, universite, filiere) VALUES('delete', old.id, old.prenom, old.nom, old.email, old.universite, old.filiere); END;
                DROP TRIGGER IF EXISTS users_au; CREATE TRIGGER users_au AFTER UPDATE ON users BEGIN INSERT INTO users_fts(users_fts, rowid, prenom, nom, email, universite, filiere) VALUES('delete', old.id, old.prenom, old.nom, old.email, old.universite, old.filiere); INSERT INTO users_fts(rowid, prenom, nom, email, universite, filiere) VALUES (new.id, new.prenom, new.nom, new.email, new.universite, new.filiere); END;
                DROP TRIGGER IF EXISTS bourses_ai; CREATE TRIGGER bourses_ai AFTER INSERT ON bourses BEGIN INSERT INTO bourses_fts(rowid, titre, description, organisme) VALUES (new.id, new.titre, new.description, new.organisme); END;
                DROP TRIGGER IF EXISTS bourses_ad; CREATE TRIGGER bourses_ad AFTER DELETE ON bourses BEGIN INSERT INTO bourses_fts(bourses_fts, rowid, titre, description, organisme) VALUES('delete', old.id, old.titre, old.description, old.organisme); END;
                DROP TRIGGER IF EXISTS bourses_au; CREATE TRIGGER bourses_au AFTER UPDATE ON bourses BEGIN INSERT INTO bourses_fts(bourses_fts, rowid, titre, description, organisme) VALUES('delete', old.id, old.titre, old.description, old.organisme); INSERT INTO bourses_fts(rowid, titre, description, organisme) VALUES (new.id, new.titre, new.description, new.organisme); END;
                DROP TRIGGER IF EXISTS formations_ai; CREATE TRIGGER formations_ai AFTER INSERT ON formations BEGIN INSERT INTO formations_fts(rowid, nom, description, universite) VALUES (new.id, new.nom, new.description, new.universite); END;
                DROP TRIGGER IF EXISTS formations_ad; CREATE TRIGGER formations_ad AFTER DELETE ON formations BEGIN INSERT INTO formations_fts(formations_fts, rowid, nom, description, universite) VALUES('delete', old.id, old.nom, old.description, old.universite); END;
                DROP TRIGGER IF EXISTS formations_au; CREATE TRIGGER formations_au AFTER UPDATE ON formations BEGIN INSERT INTO formations_fts(formations_fts, rowid, nom, description, universite) VALUES('delete', old.id, old.nom, old.description, old.universite); INSERT INTO formations_fts(rowid, nom, description, universite) VALUES (new.id, new.nom, new.description, new.universite); END;
            ''')
        except Exception:
            pass

    # Follows table
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS follows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                follower_id INTEGER NOT NULL,
                followed_id INTEGER NOT NULL,
                date_follow TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (follower_id) REFERENCES users(id),
                FOREIGN KEY (followed_id) REFERENCES users(id),
                UNIQUE(follower_id, followed_id)
            );
        ''')
    except Exception:
        pass

    # Expo push tokens table
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS expo_push_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, token)
            );
        ''')
    except Exception:
        pass

    # Rebuild FTS indexes from existing data
    if not db.IS_PG:
        try:
            conn.executescript('''
                INSERT INTO posts_fts(rowid, contenu) SELECT id, contenu FROM posts WHERE id NOT IN (SELECT rowid FROM posts_fts);
                INSERT INTO users_fts(rowid, prenom, nom, email, universite, filiere) SELECT id, prenom, nom, email, universite, filiere FROM users WHERE id NOT IN (SELECT rowid FROM users_fts);
                INSERT INTO bourses_fts(rowid, titre, description, organisme) SELECT id, titre, description, organisme FROM bourses WHERE id NOT IN (SELECT rowid FROM bourses_fts);
                INSERT INTO formations_fts(rowid, nom, description, universite) SELECT id, nom, description, universite FROM formations WHERE id NOT IN (SELECT rowid FROM formations_fts);
            ''')
        except Exception:
            pass

    conn.commit()

    # Les anciens mots de passe SHA256 sont convertis en bcrypt a la connexion
    # (voir connexion()) : on ne peut pas le faire ici sans le mot de passe en clair.

    conn.close()
    seed_badges()  # apres la creation des tables (base neuve)

# Badge definitions (auto-seeded)
BADGES = [
    ('Premier pas', 'Inscrit depuis 30 jours', '🌟', 'age', 30),
    ('Habitué', 'Inscrit depuis 90 jours', '🔥', 'age', 90),
    ('Vétéran', 'Inscrit depuis 180 jours', '💎', 'age', 180),
    ('Causeur', 'A publié 10 posts', '💬', 'posts', 10),
    ('Influenceur', 'A publié 50 posts', '📢', 'posts', 50),
    ('Aimé', 'A recu 25 likes', '❤️', 'likes_recus', 25),
    ('Star', 'A recu 100 likes', '⭐', 'likes_recus', 100),
    ('Solidaire', 'A commenté 20 fois', '🤝', 'commentaires', 20),
    ('Bibliotheque', 'A partagé 5 documents', '📚', 'documents', 5),
    ('Networker', 'A envoyé 50 messages', '🌐', 'messages', 50),
]

def seed_badges():
    conn = get_db()
    existing = conn.execute('SELECT COUNT(*) FROM badges').fetchone()[0]
    if existing == 0:
        for b in BADGES:
            try:
                conn.execute('INSERT INTO badges (nom, description, icone, critere_type, critere_seuil) VALUES (?, ?, ?, ?, ?)', b)
            except:
                pass
        conn.commit()
    conn.close()

def check_and_award_badges(user_id):
    conn = get_db()
    badges = conn.execute('SELECT * FROM badges').fetchall()
    stats = {
        'age': 0,
        'posts': 0,
        'likes_recus': 0,
        'commentaires': 0,
        'documents': 0,
        'messages': 0,
    }

    # Calculate stats
    user = conn.execute('SELECT date_inscription FROM users WHERE id = ?', (user_id,)).fetchone()
    if user and user['date_inscription']:
        try:
            d = datetime.strptime(user['date_inscription'][:10], '%Y-%m-%d')
            stats['age'] = (date.today() - d.date()).days
        except:
            pass

    stats['posts'] = conn.execute('SELECT COUNT(*) as nb FROM posts WHERE user_id = ?', (user_id,)).fetchone()['nb']
    stats['likes_recus'] = conn.execute('SELECT COUNT(*) as nb FROM likes JOIN posts ON likes.post_id = posts.id WHERE posts.user_id = ?', (user_id,)).fetchone()['nb']
    stats['commentaires'] = conn.execute('SELECT COUNT(*) as nb FROM commentaires WHERE user_id = ?', (user_id,)).fetchone()['nb']
    stats['documents'] = conn.execute('SELECT COUNT(*) as nb FROM documents WHERE user_id = ?', (user_id,)).fetchone()['nb']
    stats['messages'] = conn.execute('SELECT COUNT(*) as nb FROM messages WHERE expediteur_id = ?', (user_id,)).fetchone()['nb']

    awarded = []
    for badge in badges:
        val = stats.get(badge['critere_type'], 0)
        if val >= badge['critere_seuil']:
            try:
                cur = conn.execute('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', (user_id, badge['id']))
                if cur.rowcount > 0:  # 0 si le badge etait deja obtenu
                    awarded.append(badge['nom'])
            except:
                pass
    conn.commit()
    conn.close()
    return awarded

# Mention parsing
import re
MENTION_RE = re.compile(r'@([a-zA-Z0-9._-]+)')

def parse_mentions(text):
    if not text:
        return []
    return MENTION_RE.findall(text)

def process_mentions(text, post_id=None, commentaire_id=None, expediteur_id=None, auteur_nom=None):
    mentions = parse_mentions(text)
    if not mentions:
        return
    if auteur_nom is None:
        auteur_nom = session.get('user_nom', 'Quelqu\'un')
    conn = get_db()
    for username in mentions:
        parts = username.replace('.', ' ').split()
        if len(parts) == 1:
            user = conn.execute('SELECT id, prenom, nom FROM users WHERE prenom LIKE ? LIMIT 1', (f'{parts[0]}%',)).fetchone()
        else:
            user = conn.execute('SELECT id, prenom, nom FROM users WHERE prenom LIKE ? AND nom LIKE ? LIMIT 1', (f'{parts[0]}%', f'{parts[-1]}%')).fetchone()
        if user:
            lien = f"/profil/{user['id']}"
            if post_id:
                lien = f"/feed#post-{post_id}"
            elif commentaire_id:
                lien = f"/feed#comment-{commentaire_id}"
            creer_notification(user['id'], 'mention', f"{auteur_nom} t'a mentionne dans une publication", lien)
    conn.close()

def render_mentions(text):
    """Texte d'une publication -> HTML sur : tout est echappe, puis les @mentions
    deviennent des liens. (Le template l'affiche avec |safe.)"""
    from markupsafe import Markup, escape
    if not text:
        return Markup('')
    def replace_mention(m):
        username = m.group(1)
        parts = username.replace('.', ' ').split()
        name = ' '.join(parts).title()
        return f'<a href="/recherche?q={username}" class="mention">@{name}</a>'
    return Markup(MENTION_RE.sub(replace_mention, str(escape(text))))

@app.template_filter('lien_sur')
def lien_sur_filter(url):
    return lien_sur(url)

@app.template_filter('render_mentions')
def render_mentions_filter(text):
    return render_mentions(text)


@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('feed'))
    conn = get_db()
    nb_users = conn.execute('SELECT COUNT(*) as nb FROM users').fetchone()['nb']
    nb_posts = conn.execute('SELECT COUNT(*) as nb FROM posts').fetchone()['nb']
    nb_formations = conn.execute('SELECT COUNT(*) as nb FROM formations').fetchone()['nb']
    conn.close()
    return render_template('index.html', nb_users=nb_users, nb_posts=nb_posts, nb_formations=nb_formations)

@app.route('/inscription', methods=['GET', 'POST'])
def inscription():
    if request.method == 'POST':
        ip = request.remote_addr or 'unknown'
        if not check_rate_limit(f'inscription:{ip}', max_reqs=3, window=300):
            flash('Trop de tentatives. Reessaie dans 5 minutes.', 'error')
            return render_template('inscription.html')
        nom = sanitize_text(request.form.get('nom', ''), 50)
        prenom = sanitize_text(request.form.get('prenom', ''), 50)
        email = normaliser_email(sanitize_text(request.form.get('email', ''), 120))
        mot_de_passe = request.form.get('mot_de_passe', '')
        universite = sanitize_text(request.form.get('universite', ''), 100)
        filiere = sanitize_text(request.form.get('filiere', ''), 100)
        annee = sanitize_text(request.form.get('annee', ''), 20)
        if not nom or not prenom or not email:
            flash('Nom, prenom et email requis.', 'error')
            return render_template('inscription.html')
        if not validate_email(email):
            flash('Email invalide.', 'error')
            return render_template('inscription.html')
        if not validate_password(mot_de_passe):
            flash(f'Mot de passe trop court (min {MDP_MIN} caracteres).', 'error')
            return render_template('inscription.html')
        mot_de_passe = hash_password(mot_de_passe)

        conn = get_db()
        try:
            if conn.execute('SELECT 1 FROM users WHERE lower(email) = ?', (email,)).fetchone():
                raise db.IntegrityError('email deja utilise')
            conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                         (nom, prenom, email, mot_de_passe, universite, filiere, annee))
            conn.commit()
            flash('Compte cree ! Connecte-toi.', 'success')
            return redirect(url_for('connexion'))
        except db.IntegrityError:
            flash('Cet email est deja utilise.', 'error')
            return render_template('inscription.html')
        finally:
            conn.close()
    return render_template('inscription.html')

@app.route('/connexion', methods=['GET', 'POST'])
def connexion():
    if request.method == 'POST':
        ip = request.remote_addr or 'unknown'
        if not check_rate_limit(f'connexion:{ip}', max_reqs=5, window=60):
            flash('Trop de tentatives. Reessaie dans 1 minute.', 'error')
            return render_template('connexion.html', erreur='Trop de tentatives')
        email = normaliser_email(request.form.get('email', ''))
        # limite aussi par compte : protege contre les attaques depuis plusieurs IP
        if not check_rate_limit(f'connexion_compte:{email}', max_reqs=10, window=900):
            flash('Trop de tentatives sur ce compte. Reessaie dans 15 minutes.', 'error')
            return render_template('connexion.html')
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE lower(email) = ?', (email,)).fetchone()
        if user and not check_password(request.form.get('mot_de_passe', ''), user['mot_de_passe']):
            user = None
        elif user and not user['mot_de_passe'].startswith('$2'):
            nouveau = hash_password(request.form['mot_de_passe'])
            conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
            conn.commit()
        conn.close()

        if user and user['banni']:
            flash('Votre compte a ete suspendu. Contactez l\'administration.', 'error')
            return render_template('connexion.html')
        if user:
            session.clear()  # nouvelle session (evite la fixation de session)
            session.permanent = True
            session['user_id'] = user['id']
            session['user_nom'] = user['prenom'] + ' ' + user['nom']
            session['user_email'] = user['email']
            session['v'] = user['jeton_version'] or 0
            flash('Connecte !', 'success')
            return redirect(url_for('feed'))
        else:
            flash('Email ou mot de passe incorrect.', 'error')
            return render_template('connexion.html')
    return render_template('connexion.html')

@app.route('/deconnexion')
def deconnexion():
    session.clear()
    return redirect(url_for('index'))

# ---- Reinitialisation du mot de passe
# Le lien n'est JAMAIS affiche a l'ecran : seul le proprietaire de l'adresse le recoit
# par e-mail. Le jeton est stocke hache en base. Meme reponse que le compte existe ou non.
MESSAGE_REINIT = "Si un compte existe avec cet email, un lien de reinitialisation vient d'y etre envoye."

def _hash_jeton(jeton):
    return hashlib.sha256(jeton.encode()).hexdigest()

def envoyer_email(destinataire, sujet, texte):
    smtp_host = os.environ.get('SMTP_HOST', '')
    smtp_user = os.environ.get('SMTP_USER', '')
    smtp_pass = os.environ.get('SMTP_PASS', '')
    if not (smtp_host and smtp_user and smtp_pass):
        app.logger.error('SMTP non configure : email non envoye (%s)', sujet)
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(texte, 'plain', 'utf-8')
        msg['Subject'] = sujet
        msg['From'] = os.environ.get('SMTP_FROM', smtp_user)
        msg['To'] = destinataire
        with smtplib.SMTP(smtp_host, int(os.environ.get('SMTP_PORT', '587')), timeout=15) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True
    except Exception as e:
        app.logger.error("Echec d'envoi d'email : %s", e)
        return False

def demander_reinitialisation(email):
    """Cree un jeton (1 h) et l'envoie par e-mail si le compte existe. Ne renvoie rien."""
    email = normaliser_email(email)
    ip = request.remote_addr or 'unknown'
    if not validate_email(email) or not check_rate_limit(f'reinit:{ip}', max_reqs=5, window=900) \
            or not check_rate_limit(f'reinit_compte:{email}', max_reqs=3, window=3600):
        return
    conn = get_db()
    user = conn.execute('SELECT id, email FROM users WHERE lower(email) = ?', (email,)).fetchone()
    if user:
        jeton = secrets.token_urlsafe(32)
        expire = datetime.now(timezone.utc) + timedelta(hours=1)
        conn.execute('UPDATE reset_tokens SET utilise = 1 WHERE user_id = ? AND utilise = 0', (user['id'],))
        conn.execute('INSERT INTO reset_tokens (user_id, token, expire) VALUES (?, ?, ?)',
                     (user['id'], _hash_jeton(jeton), expire.strftime('%Y-%m-%d %H:%M:%S')))
        conn.commit()
        lien = url_for('reinitialiser', token=jeton, _external=True, _scheme='https' if EN_PRODUCTION else None)
        envoyer_email(user['email'], 'Reinitialisation de mot de passe - LINK CI',
                      f"Bonjour,\n\nClique sur ce lien pour reinitialiser ton mot de passe :\n{lien}\n\n"
                      "Ce lien expire dans 1 heure. Si tu n'as rien demande, ignore cet email.\n\nL'equipe LINK CI")
    conn.close()

def appliquer_reinitialisation(jeton, mot_de_passe):
    """Renvoie None si c'est fait, sinon le message d'erreur."""
    if not validate_password(mot_de_passe):
        return f'Mot de passe trop court (min {MDP_MIN} caracteres).'
    conn = get_db()
    rt = conn.execute('SELECT * FROM reset_tokens WHERE token = ? AND utilise = 0 AND expire > ?',
                      (_hash_jeton(jeton or ''), datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'))).fetchone()
    if not rt:
        conn.close()
        return 'Lien invalide ou expire.'
    conn.execute('UPDATE users SET mot_de_passe = ?, jeton_version = COALESCE(jeton_version, 0) + 1 WHERE id = ?',
                 (hash_password(mot_de_passe), rt['user_id']))  # deconnecte l'app et le site partout
    conn.execute('UPDATE reset_tokens SET utilise = 1 WHERE user_id = ?', (rt['user_id'],))
    conn.commit()
    conn.close()
    return None

@app.route('/mot_de_passe_oublie', methods=['GET', 'POST'])
def mot_de_passe_oublie():
    if request.method == 'POST':
        demander_reinitialisation(request.form.get('email', ''))
        flash(MESSAGE_REINIT, 'success')
        return redirect(url_for('connexion'))
    return render_template('mot_de_passe_oublie.html')

@app.route('/reinitialiser/<token>', methods=['GET', 'POST'])
def reinitialiser(token):
    if request.method == 'POST':
        erreur = appliquer_reinitialisation(token, request.form.get('mot_de_passe', ''))
        if erreur:
            flash(erreur, 'error')
            if 'invalide' in erreur:
                return redirect(url_for('connexion'))
            return render_template('reinitialiser.html', token=token)
        flash('Mot de passe reinitialise ! Connecte-toi.', 'success')
        return redirect(url_for('connexion'))
    return render_template('reinitialiser.html', token=token)

@app.route('/feed')
def feed():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))

    conn = get_db()
    posts = conn.execute('''
        SELECT posts.*, users.prenom, users.nom, users.avatar,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires,
               EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) as a_like
        FROM posts
        JOIN users ON posts.user_id = users.id
        ORDER BY posts.date_post DESC
    ''', (session['user_id'],)).fetchall()
    nb_abonnements = conn.execute('SELECT COUNT(*) as nb FROM follows WHERE follower_id = ?', (session['user_id'],)).fetchone()['nb']
    conn.close()

    return render_template('feed.html', posts=posts, nb_abonnements=nb_abonnements)

@app.route('/publier', methods=['POST'])
def publier():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = sanitize_text(request.form.get('contenu', ''), 5000)
    if contenu:
        conn = get_db()
        image = request.files.get('image')
        image_nom = None
        if image and image.filename:
            ext = os.path.splitext(image.filename)[1].lower()
            if ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
                data_img = image.read()
                ext_reelle = extension_image(data_img)  # le contenu doit etre une vraie image
                if ext_reelle:
                    image_nom = f"{uuid.uuid4().hex}{ext_reelle}"
                    stocker_fichier('static/uploads/' + image_nom, data_img)
        cur = conn.execute('INSERT INTO posts (user_id, contenu, image) VALUES (?, ?, ?)',
                     (session['user_id'], contenu, image_nom))
        post_id = cur.lastrowid
        conn.commit()
        conn.close()
        process_mentions(contenu, post_id=post_id, expediteur_id=session['user_id'])
        check_and_award_badges(session['user_id'])
        flash('Publie !', 'success')
    return redirect(url_for('feed'))

@app.route('/liker/<int:post_id>', methods=['POST'])
def liker(post_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Non connecté'}), 401
    conn = get_db()
    try:
        conn.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)',
                     (session['user_id'], post_id))
        conn.commit()
    except db.IntegrityError:
        conn.execute('DELETE FROM likes WHERE user_id = ? AND post_id = ?',
                     (session['user_id'], post_id))
        conn.commit()
    conn.close()
    return redirect(url_for('feed'))

@app.route('/commenter/<int:post_id>', methods=['POST'])
def commenter(post_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = sanitize_text(request.form.get('contenu', ''), 2000)
    if contenu:
        conn = get_db()
        cur = conn.execute('INSERT INTO commentaires (user_id, post_id, contenu) VALUES (?, ?, ?)',
                     (session['user_id'], post_id, contenu))
        cmt_id = cur.lastrowid
        conn.commit()
        conn.close()
        process_mentions(contenu, commentaire_id=cmt_id, expediteur_id=session['user_id'])
        check_and_award_badges(session['user_id'])
    return redirect(url_for('feed'))

@app.route('/profil/<int:user_id>')
def profil(user_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    posts = conn.execute('''
        SELECT posts.*,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires
        FROM posts WHERE user_id = ? ORDER BY date_post DESC
    ''', (user_id,)).fetchall()
    nb_posts = len(posts)
    nb_likes_recus = conn.execute('''
        SELECT COUNT(*) as nb FROM likes
        JOIN posts ON likes.post_id = posts.id
        WHERE posts.user_id = ?
    ''', (user_id,)).fetchone()['nb']
    nb_commentaires_recus = conn.execute('''
        SELECT COUNT(*) as nb FROM commentaires
        JOIN posts ON commentaires.post_id = posts.id
        WHERE posts.user_id = ?
    ''', (user_id,)).fetchone()['nb']
    nb_bourses = conn.execute('SELECT COUNT(*) as nb FROM bourses').fetchone()['nb']
    nb_docs = conn.execute('SELECT COUNT(*) as nb FROM documents').fetchone()['nb']
    badges = conn.execute('''
        SELECT b.*, ub.date_obtention FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ? ORDER BY ub.date_obtention DESC
    ''', (user_id,)).fetchall()
    est_abonne = bool(conn.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?',
                                    (session['user_id'], user_id)).fetchone())
    nb_abonnes = conn.execute('SELECT COUNT(*) as nb FROM follows WHERE followed_id = ?', (user_id,)).fetchone()['nb']
    nb_abonnements = conn.execute('SELECT COUNT(*) as nb FROM follows WHERE follower_id = ?', (user_id,)).fetchone()['nb']
    conn.close()
    return render_template('profil.html', user=user, posts=posts, nb_posts=nb_posts, nb_likes_recus=nb_likes_recus, nb_commentaires_recus=nb_commentaires_recus, nb_bourses=nb_bourses, nb_docs=nb_docs, badges=badges, est_abonne=est_abonne, nb_abonnes=nb_abonnes, nb_abonnements=nb_abonnements)

# ===================== USER STATS =====================
@app.route('/stats')
def stats():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    user_id = session['user_id']
    # Daily post stats (last 30 days)
    today = date.today()
    daily_posts = []
    for i in range(30, -1, -1):
        d = today - timedelta(days=i)
        ds = d.strftime('%Y-%m-%d')
        cnt = conn.execute('SELECT COUNT(*) as nb FROM posts WHERE user_id = ? AND date_post LIKE ?', (user_id, ds + '%')).fetchone()['nb']
        daily_posts.append({'date': ds, 'nb': cnt})
    # Top domains
    universites = [dict(r) for r in conn.execute('SELECT universite, COUNT(*) as nb FROM users WHERE universite IS NOT NULL GROUP BY universite ORDER BY nb DESC LIMIT 10').fetchall()]
    filieres = [dict(r) for r in conn.execute('SELECT filiere, COUNT(*) as nb FROM users WHERE filiere IS NOT NULL GROUP BY filiere ORDER BY nb DESC LIMIT 10').fetchall()]
    # Top posters
    top_posters = [dict(r) for r in conn.execute('''
        SELECT users.prenom, users.nom, COUNT(posts.id) as nb
        FROM posts JOIN users ON posts.user_id = users.id
        GROUP BY posts.user_id, users.prenom, users.nom ORDER BY nb DESC LIMIT 10
    ''').fetchall()]
    # User's own stats
    nb_posts = conn.execute('SELECT COUNT(*) as nb FROM posts WHERE user_id = ?', (user_id,)).fetchone()['nb']
    nb_likes_recus = conn.execute('SELECT COUNT(*) as nb FROM likes JOIN posts ON likes.post_id = posts.id WHERE posts.user_id = ?', (user_id,)).fetchone()['nb']
    nb_commentaires = conn.execute('SELECT COUNT(*) as nb FROM commentaires WHERE user_id = ?', (user_id,)).fetchone()['nb']
    inscrit = conn.execute('SELECT date_inscription FROM users WHERE id = ?', (user_id,)).fetchone()
    try:
        nb_jours = (datetime.now(timezone.utc).replace(tzinfo=None) - datetime.strptime(inscrit['date_inscription'][:19], '%Y-%m-%d %H:%M:%S')).days
    except (TypeError, ValueError):
        nb_jours = 0
    conn.close()
    return render_template('stats.html', daily_posts=daily_posts, universites=universites, filieres=filieres, top_posters=top_posters, nb_posts=nb_posts, nb_likes_recus=nb_likes_recus, nb_commentaires=nb_commentaires, nb_jours=nb_jours)

@app.route('/messagerie')
def messagerie():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    utilisateurs = conn.execute('SELECT id, prenom, nom, filiere FROM users WHERE id != ?', (session['user_id'],)).fetchall()
    conversations = conn.execute('''
        SELECT DISTINCT 
            CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END as autre_id,
            users.prenom, users.nom,
            (SELECT contenu FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
            (SELECT date_envoi FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as date_dernier,
            (SELECT COUNT(*) FROM messages WHERE destinataire_id = ? AND expediteur_id = users.id AND lu = 0) as non_lu
        FROM messages
        JOIN users ON users.id = CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END
        WHERE expediteur_id = ? OR destinataire_id = ?
        ORDER BY date_dernier DESC
    ''', (session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'])).fetchall()
    conn.close()
    return render_template('messagerie.html', utilisateurs=utilisateurs, conversations=conversations)

@app.route('/envoyer_message/<int:destinataire_id>', methods=['POST'])
def envoyer_message(destinataire_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = sanitize_text(request.form.get('contenu', ''), 5000)
    if contenu:
        conn = get_db()
        msg_id = conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                              (session['user_id'], destinataire_id, contenu)).lastrowid
        conn.commit()
        conn.close()
        diffuser_message(session['user_id'], destinataire_id, msg_id, contenu)
        process_mentions(contenu, auteur_nom=session.get('user_nom', 'Quelqu\'un'))
        check_and_award_badges(session['user_id'])
        creer_notification(destinataire_id, 'message', f"Nouveau message de {session['user_nom']}", f"/conversation/{session['user_id']}")
    return redirect(url_for('conversation', autre_id=destinataire_id))

@app.route('/conversation/<int:autre_id>')
def conversation(autre_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    autre = conn.execute('SELECT * FROM users WHERE id = ?', (autre_id,)).fetchone()
    if not autre:
        flash('Utilisateur introuvable', 'error')
        conn.close()
        return redirect(url_for('messagerie'))
    messages = conn.execute('''
        SELECT messages.*, users.prenom, users.nom
        FROM messages
        JOIN users ON messages.expediteur_id = users.id
        WHERE (expediteur_id = ? AND destinataire_id = ?) OR (expediteur_id = ? AND destinataire_id = ?)
        ORDER BY date_envoi ASC
    ''', (session['user_id'], autre_id, autre_id, session['user_id'])).fetchall()
    # Marquer comme lu
    conn.execute('UPDATE messages SET lu = 1 WHERE expediteur_id = ? AND destinataire_id = ?',
                 (autre_id, session['user_id']))
    conn.commit()
    utilisateurs = conn.execute('SELECT id, prenom, nom, filiere FROM users WHERE id != ?', (session['user_id'],)).fetchall()
    conversations = conn.execute('''
        SELECT DISTINCT 
            CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END as autre_id,
            users.prenom, users.nom,
            (SELECT contenu FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
            (SELECT date_envoi FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as date_dernier,
            (SELECT COUNT(*) FROM messages WHERE destinataire_id = ? AND expediteur_id = users.id AND lu = 0) as non_lu
        FROM messages
        JOIN users ON users.id = CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END
        WHERE expediteur_id = ? OR destinataire_id = ?
        ORDER BY date_dernier DESC
    ''', (session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'], session['user_id'])).fetchall()
    conn.close()
    return render_template('messagerie.html', utilisateurs=utilisateurs, conversations=conversations, conversation_avec=dict(autre), messages=messages)

@app.route('/supprimer_post/<int:post_id>', methods=['POST'])
def supprimer_post(post_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    post = conn.execute('SELECT user_id FROM posts WHERE id = ?', (post_id,)).fetchone()
    if post and post['user_id'] == session['user_id']:
        conn.execute('DELETE FROM commentaires WHERE post_id = ?', (post_id,))
        conn.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
        conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
        conn.commit()
        flash('Publication supprimee', 'success')
    else:
        flash('Action non autorisee', 'error')
    conn.close()
    return redirect(url_for('feed'))

# ===================== FOLLOW / UNFOLLOW =====================
@app.route('/suivre/<int:user_id>', methods=['POST'])
def suivre(user_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if user_id == session['user_id']:
        flash('Tu ne peux pas te suivre toi-meme', 'error')
        return redirect(url_for('profil', user_id=user_id))
    conn = get_db()
    try:
        conn.execute('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)',
                     (session['user_id'], user_id))
        conn.commit()
        creer_notification(user_id, 'suivi', f"{session['user_nom']} a commence a te suivre",
                           url_for('profil', user_id=session['user_id']))
        flash('Abonne !', 'success')
    except db.IntegrityError:
        conn.execute('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?',
                     (session['user_id'], user_id))
        conn.commit()
        flash('Desabonne', 'success')
    conn.close()
    return redirect(url_for('profil', user_id=user_id))

# ===================== EXPO PUSH NOTIFICATIONS =====================
@app.route('/api/expo_push_token', methods=['POST'])
def api_expo_push_token():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('token'):
        return jsonify({'error': 'Token requis'}), 400
    conn = get_db()
    conn.execute('INSERT OR IGNORE INTO expo_push_tokens (user_id, token) VALUES (?, ?)',
                 (user_id, data['token']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Token enregistre'})

@app.route('/api/send_push', methods=['POST'])
def api_send_push():
    """Send push notification to a user via Expo Push API (administrateurs seulement)"""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    moi = conn.execute('SELECT role FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if not est_admin(moi):
        return jsonify({'error': 'Acces reserve'}), 403
    data = request.json
    if not data or not data.get('destinataire_id') or not data.get('message'):
        return jsonify({'error': 'destinataire_id et message requis'}), 400
    try:
        import requests as http_req
    except ImportError:
        return jsonify({'error': 'requests not installed'}), 500
    conn = get_db()
    tokens = conn.execute('SELECT token FROM expo_push_tokens WHERE user_id = ?',
                          (data['destinataire_id'],)).fetchall()
    conn.close()
    if not tokens:
        return jsonify({'message': 'Aucun token trouve'})
    messages = [{
        'to': t['token'],
        'sound': 'default',
        'title': 'LINK CI',
        'body': data['message'],
        'data': data.get('data', {})
    } for t in tokens]
    try:
        http_req.post('https://exp.host/--/api/v2/push/send', json=messages,
                      timeout=5, headers={'Accept': 'application/json'})
    except Exception:
        pass
    return jsonify({'message': 'Notification envoyee'})

@app.route('/profil/modifier', methods=['GET', 'POST'])
def modifier_profil():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    if request.method == 'POST':
        prenom = sanitize_text(request.form.get('prenom', ''), 50)
        nom = sanitize_text(request.form.get('nom', ''), 50)
        universite = sanitize_text(request.form.get('universite', ''), 100)
        filiere = sanitize_text(request.form.get('filiere', ''), 100)
        annee = sanitize_text(request.form.get('annee', ''), 20)
        bio = sanitize_text(request.form.get('bio', ''), 500)
        avatar = request.files.get('avatar')
        if prenom and nom:
            avatar_nom = None
            if avatar and avatar.filename:
                ext = os.path.splitext(avatar.filename)[1].lower()
                if ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
                    data_img = avatar.read()
                    ext = extension_image(data_img) or ext
                    if not extension_image(data_img):
                        flash('Image invalide', 'error')
                        conn.close()
                        return redirect(url_for('modifier_profil'))
                    avatar_nom = f"user_{session['user_id']}_{uuid.uuid4().hex[:8]}{ext}"
                    stocker_fichier('static/avatars/' + avatar_nom, data_img)
                    conn.execute('UPDATE users SET prenom=?, nom=?, universite=?, filiere=?, annee=?, bio=?, avatar=? WHERE id=?',
                                 (prenom, nom, universite, filiere, annee, bio, avatar_nom, session['user_id']))
                else:
                    flash('Format non pris en charge (PNG, JPG, GIF)', 'error')
            else:
                conn.execute('UPDATE users SET prenom=?, nom=?, universite=?, filiere=?, annee=?, bio=? WHERE id=?',
                             (prenom, nom, universite, filiere, annee, bio, session['user_id']))
            conn.commit()
            session['user_nom'] = prenom + ' ' + nom
            flash('Profil mis a jour', 'success')
        else:
            flash('Prenom et nom requis', 'error')
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()
    return render_template('modifier_profil.html', user=user)

@app.route('/api/mentions')
def api_mentions():
    if 'user_id' not in session:
        return jsonify([]), 401
    q = request.args.get('q', '').strip()
    if len(q) < 1:
        return jsonify([])
    conn = get_db()
    users = conn.execute('''
        SELECT id, prenom, nom, filiere FROM users
        WHERE (prenom || ' ' || nom) LIKE ? LIMIT 8
    ''', (f'%{q}%',)).fetchall()
    conn.close()
    return jsonify([{'id': u['id'], 'prenom': u['prenom'], 'nom': u['nom'], 'filiere': u['filiere'], 'label': f"{u['prenom']} {u['nom']}"} for u in users])

@app.route('/documents')
def documents():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    docs = conn.execute('SELECT documents.*, users.prenom, users.nom FROM documents JOIN users ON documents.user_id = users.id ORDER BY date_upload DESC').fetchall()
    matieres = conn.execute('SELECT DISTINCT matiere FROM documents WHERE matiere IS NOT NULL ORDER BY matiere').fetchall()
    conn.close()
    return render_template('documents.html', docs=docs, matieres=matieres)

@app.route('/documents/ajouter', methods=['GET', 'POST'])
def ajouter_document():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        titre = sanitize_text(request.form.get('titre', ''), 200)
        description = sanitize_text(request.form.get('description', ''), 2000)
        matiere = sanitize_text(request.form.get('matiere', ''), 100)
        universite = sanitize_text(request.form.get('universite', ''), 100)
        fichier = request.files.get('fichier')
        if not titre or not fichier or fichier.filename == '':
            flash('Titre et fichier requis', 'error')
            return redirect(url_for('ajouter_document'))
        ext = os.path.splitext(fichier.filename)[1].lower()
        if ext not in ('.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.zip', '.rar', '.png', '.jpg', '.jpeg'):
            flash('Format non autorise (PDF, Word, PowerPoint, TXT, ZIP, images)', 'error')
            return redirect(url_for('ajouter_document'))
        nom_fichier = f"{uuid.uuid4().hex}{ext}"
        stocker_fichier('uploads/' + nom_fichier, fichier.read())
        conn = get_db()
        conn.execute('INSERT INTO documents (user_id, titre, description, fichier, matiere, universite) VALUES (?, ?, ?, ?, ?, ?)',
            (session['user_id'], titre, description, nom_fichier, matiere or None, universite or None))
        conn.commit()
        notifier_tous('document', f"Un nouveau document a ete partage : {titre}", url_for('documents'))
        conn.close()
        flash('Document publie avec succes', 'success')
        return redirect(url_for('documents'))
    return render_template('ajouter_document.html')

@app.route('/documents/<int:doc_id>/telecharger')
def telecharger_document(doc_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    doc = conn.execute('SELECT * FROM documents WHERE id = ?', (doc_id,)).fetchone()
    if not doc:
        conn.close()
        flash('Document introuvable', 'error')
        return redirect(url_for('documents'))
    chemin = os.path.join(app.root_path, 'uploads', doc['fichier'])
    if not restaurer_fichier('uploads/' + doc['fichier']):
        conn.close()
        flash('Fichier introuvable', 'error')
        return redirect(url_for('documents'))
    conn.execute('UPDATE documents SET telechargements = telechargements + 1 WHERE id = ?', (doc_id,))
    conn.commit()
    conn.close()
    return send_file(chemin, as_attachment=True, download_name=doc['titre'] + os.path.splitext(doc['fichier'])[1])

@app.route('/api/rechercher_utilisateurs')
def rechercher_utilisateurs():
    if 'user_id' not in session:
        return jsonify([])
    q = request.args.get('q', '')
    conn = get_db()
    users = conn.execute('''
        SELECT id, prenom, nom, filiere, universite FROM users
        WHERE (prenom || ' ' || nom LIKE ?) AND id != ?
        LIMIT 10
    ''', ('%' + q + '%', session['user_id'])).fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])

@app.route('/recherche')
def recherche():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    q = request.args.get('q', '').strip()
    resultats = {'posts': [], 'bourses': [], 'formations': [], 'utilisateurs': [], 'documents': []}
    if q:
        conn = get_db()
        try:
            safe = q.replace("'", "''")
            resultats['posts'] = [dict(r) for r in conn.execute('''
                SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
                FROM posts_fts JOIN posts ON posts_fts.rowid = posts.id JOIN users ON posts.user_id = users.id
                WHERE posts_fts MATCH ? ORDER BY rank LIMIT 10
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['posts'] = [dict(r) for r in conn.execute('''
                SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
                FROM posts JOIN users ON posts.user_id = users.id
                WHERE posts.contenu LIKE ? ORDER BY posts.date_post DESC LIMIT 10
            ''', ('%' + q + '%',)).fetchall()]
        try:
            safe = q.replace("'", "''")
            resultats['bourses'] = [dict(r) for r in conn.execute('''
                SELECT bourses.id, titre, organisme, type FROM bourses_fts JOIN bourses ON bourses_fts.rowid = bourses.id
                WHERE bourses_fts MATCH ? ORDER BY rank LIMIT 10
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['bourses'] = [dict(r) for r in conn.execute('''
                SELECT id, titre, organisme, type FROM bourses
                WHERE titre LIKE ? OR description LIKE ? OR organisme LIKE ?
                ORDER BY date_publication DESC LIMIT 10
            ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
        try:
            safe = q.replace("'", "''")
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT formations.id, nom, universite, niveau FROM formations_fts JOIN formations ON formations_fts.rowid = formations.id
                WHERE formations_fts MATCH ? ORDER BY rank LIMIT 10
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT id, nom, universite, niveau FROM formations
                WHERE nom LIKE ? OR description LIKE ? OR universite LIKE ?
                LIMIT 10
            ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
        try:
            safe = q.replace("'", "''")
            resultats['utilisateurs'] = [dict(r) for r in conn.execute('''
                SELECT users.id, prenom, nom, filiere, universite FROM users_fts JOIN users ON users_fts.rowid = users.id
                WHERE users_fts MATCH ? AND users.id != ? ORDER BY rank LIMIT 10
            ''', (safe, session['user_id'])).fetchall()]
        except Exception:
            resultats['utilisateurs'] = [dict(r) for r in conn.execute('''
                SELECT id, prenom, nom, filiere, universite FROM users
                WHERE (prenom || ' ' || nom LIKE ?) AND id != ?
                LIMIT 10
            ''', ('%' + q + '%', session['user_id'])).fetchall()]
        resultats['documents'] = [dict(r) for r in conn.execute('''
            SELECT id, titre, matiere FROM documents
            WHERE titre LIKE ? OR description LIKE ? OR matiere LIKE ?
            LIMIT 10
        ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
        conn.close()
    return render_template('recherche.html', q=q, resultats=resultats)

@app.route('/api/recherche')
def api_recherche():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    q = request.args.get('q', '').strip()
    resultats = {'posts': [], 'bourses': [], 'formations': [], 'users': []}
    if q:
        conn = get_db()
        safe = q.replace("'", "''")
        try:
            resultats['posts'] = [dict(r) for r in conn.execute('''
                SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
                FROM posts_fts JOIN posts ON posts_fts.rowid = posts.id JOIN users ON posts.user_id = users.id
                WHERE posts_fts MATCH ? ORDER BY rank LIMIT 5
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['posts'] = [dict(r) for r in conn.execute('''
                SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
                FROM posts JOIN users ON posts.user_id = users.id
                WHERE posts.contenu LIKE ? ORDER BY posts.date_post DESC LIMIT 5
            ''', ('%' + q + '%',)).fetchall()]
        try:
            resultats['bourses'] = [dict(r) for r in conn.execute('''
                SELECT bourses.id, titre, organisme, type FROM bourses_fts JOIN bourses ON bourses_fts.rowid = bourses.id
                WHERE bourses_fts MATCH ? ORDER BY rank LIMIT 5
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['bourses'] = [dict(r) for r in conn.execute('''
                SELECT id, titre, organisme, type FROM bourses
                WHERE titre LIKE ? OR description LIKE ? LIMIT 5
            ''', ('%' + q + '%', '%' + q + '%')).fetchall()]
        try:
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT formations.id, nom, universite, niveau FROM formations_fts JOIN formations ON formations_fts.rowid = formations.id
                WHERE formations_fts MATCH ? ORDER BY rank LIMIT 5
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT id, nom, universite, niveau FROM formations
                WHERE nom LIKE ? OR description LIKE ? LIMIT 5
            ''', ('%' + q + '%', '%' + q + '%')).fetchall()]
        try:
            resultats['users'] = [dict(r) for r in conn.execute('''
                SELECT users.id, prenom, nom, filiere, universite, avatar FROM users_fts JOIN users ON users_fts.rowid = users.id
                WHERE users_fts MATCH ? AND users.id != ? ORDER BY rank LIMIT 5
            ''', (safe, user_id)).fetchall()]
        except Exception:
            resultats['users'] = [dict(r) for r in conn.execute('''
                SELECT id, prenom, nom, filiere, universite, avatar FROM users
                WHERE (prenom || ' ' || nom LIKE ?) AND id != ? LIMIT 5
            ''', ('%' + q + '%', user_id)).fetchall()]
        conn.close()
    return jsonify(resultats)

@app.route('/bourses')
def bourses():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    from datetime import date
    aujourdhui = date.today().isoformat()

    conn = get_db()
    # Auto-expire les bourses dont la deadline est passee
    conn.execute("UPDATE bourses SET expiree = 1 WHERE deadline != '' AND deadline < ? AND expiree = 0", (aujourdhui,))
    conn.commit()

    toutes = conn.execute('SELECT * FROM bourses ORDER BY expiree ASC, date_publication DESC').fetchall()
    types = conn.execute('SELECT DISTINCT type FROM bourses').fetchall()
    conn.close()
    return render_template('bourses.html', bourses=toutes, types=types, aujourdhui=aujourdhui)

@app.route('/bourses/ajouter', methods=['GET', 'POST'])
def ajouter_bourse():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        titre = sanitize_text(request.form.get('titre', ''), 200)
        organisme = sanitize_text(request.form.get('organisme', ''), 200)
        description = sanitize_text(request.form.get('description', ''), 2000)
        montant = sanitize_text(request.form.get('montant', ''), 100)
        type_ = sanitize_text(request.form.get('type', ''), 50)
        cible = sanitize_text(request.form.get('cible', ''), 200)
        deadline = sanitize_text(request.form.get('deadline', ''), 20)
        lien = lien_sur(sanitize_text(request.form.get('lien', ''), 500))
        pays = sanitize_text(request.form.get('pays', "Cote d'Ivoire"), 100)
        if not titre or not organisme or not type_:
            flash('Titre, organisme et type requis.', 'error')
            return render_template('ajouter_bourse.html')
        conn = get_db()
        conn.execute('INSERT INTO bourses (titre, organisme, description, montant, type, cible, deadline, lien, pays) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (titre, organisme, description, montant, type_, cible, deadline, lien, pays))
        conn.commit()
        conn.close()
        notifier_tous('bourse', f"Nouvelle bourse : {titre}", "/bourses")
        return redirect(url_for('bourses'))
    return render_template('ajouter_bourse.html')

@app.route('/bourses/supprimer/<int:id>', methods=['POST'])
def supprimer_bourse(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('DELETE FROM bourses WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect(url_for('bourses'))

@app.route('/bourses/signaler/<int:id>', methods=['POST'])
def signaler_bourse(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('UPDATE bourses SET expiree = 1 WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect(url_for('bourses'))

def diffuser_message(expediteur_id, destinataire_id, message_id, contenu):
    """Temps reel (app mobile) : previent l'expediteur et le destinataire d'un nouveau message prive.
    Evenement distinct de 'new_message' (utilise par la page web de conversation) pour eviter les doublons."""
    data = {'id': message_id, 'expediteur_id': int(expediteur_id), 'destinataire_id': int(destinataire_id),
            'contenu': contenu, 'date_envoi': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}
    for uid in {int(expediteur_id), int(destinataire_id)}:
        try:
            socketio.emit('message_recu', data, room='user_' + str(uid))
        except Exception:
            pass

def diffuser_message_groupe(groupe_id, auteur_id):
    """Temps reel : previent les membres d'un groupe qu'un nouveau message est arrive."""
    conn = get_db()
    membres = conn.execute('SELECT user_id FROM groupe_membres WHERE groupe_id = ?', (groupe_id,)).fetchall()
    conn.close()
    for m in membres:
        try:
            socketio.emit('groupe_message', {'groupe_id': groupe_id, 'user_id': auteur_id}, room='user_' + str(m['user_id']))
        except Exception:
            pass

def creer_notification(user_id, type, message, lien=''):
    conn = get_db()
    conn.execute('INSERT INTO notifications (user_id, type, message, lien) VALUES (?, ?, ?, ?)',
                 (user_id, type, message, lien))
    conn.commit()
    conn.close()
    try:
        socketio.emit('notification_update', {'user_id': user_id}, room='user_' + str(user_id))
    except:
        pass

def notifier_tous(type, message, lien=''):
    conn = get_db()
    users = conn.execute('SELECT id FROM users').fetchall()
    for u in users:
        conn.execute('INSERT INTO notifications (user_id, type, message, lien) VALUES (?, ?, ?, ?)',
                     (u['id'], type, message, lien))
        try:
            socketio.emit('notification_update', {'user_id': u['id']}, room='user_' + str(u['id']))
        except:
            pass
    conn.commit()
    conn.close()

@app.route('/notifications')
def notifications():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    notifs = conn.execute('SELECT * FROM notifications WHERE user_id = ? ORDER BY date_notification DESC LIMIT 50',
                          (session['user_id'],)).fetchall()
    non_lu = conn.execute('SELECT COUNT(*) as nb FROM notifications WHERE user_id = ? AND lu = 0',
                          (session['user_id'],)).fetchone()['nb']
    conn.close()
    return render_template('notifications.html', notifications=notifs, non_lu=non_lu)

@app.route('/notifications/lire/<int:id>', methods=['POST'])
def lire_notification(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('UPDATE notifications SET lu = 1 WHERE id = ? AND user_id = ?', (id, session['user_id']))
    conn.commit()
    n = conn.execute('SELECT lien FROM notifications WHERE id = ?', (id,)).fetchone()
    conn.close()
    if n and n['lien']:
        return redirect(n['lien'])
    return redirect(url_for('notifications'))

@app.route('/notifications/tout_lire', methods=['POST'])
def tout_lire():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('UPDATE notifications SET lu = 1 WHERE user_id = ?', (session['user_id'],))
    conn.commit()
    conn.close()
    return redirect(url_for('notifications'))

@app.route('/api/notifications/non_lu')
def api_notifications_non_lu():
    if 'user_id' not in session:
        return jsonify({'nb': 0})
    conn = get_db()
    nb = conn.execute('SELECT COUNT(*) as nb FROM notifications WHERE user_id = ? AND lu = 0',
                      (session['user_id'],)).fetchone()['nb']
    conn.close()
    return jsonify({'nb': nb})

@app.route('/formations')
def formations():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    uvs = conn.execute('SELECT DISTINCT universite FROM formations ORDER BY universite').fetchall()
    niveau_filter = request.args.get('niveau', '')
    uni_filter = request.args.get('universite', '')
    query = 'SELECT * FROM formations'
    params = []
    clauses = []
    if niveau_filter:
        clauses.append('niveau = ?')
        params.append(niveau_filter)
    if uni_filter:
        clauses.append('universite = ?')
        params.append(uni_filter)
    if clauses:
        query += ' WHERE ' + ' AND '.join(clauses)
    query += ' ORDER BY universite, nom'
    formations = conn.execute(query, params).fetchall()
    niveaux = conn.execute('SELECT DISTINCT niveau FROM formations ORDER BY niveau').fetchall()
    conn.close()
    return render_template('formations.html', formations=formations, universites=uvs, niveaux=niveaux,
                         niveau_filter=niveau_filter, uni_filter=uni_filter)

@app.route('/formations/ajouter', methods=['GET', 'POST'])
def ajouter_formation():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        nom = sanitize_text(request.form.get('nom', ''), 200)
        universite = sanitize_text(request.form.get('universite', ''), 200)
        niveau = sanitize_text(request.form.get('niveau', ''), 50)
        description = sanitize_text(request.form.get('description', ''), 2000)
        duree = sanitize_text(request.form.get('duree', ''), 100)
        debouches = sanitize_text(request.form.get('debouches', ''), 500)
        frais = sanitize_text(request.form.get('frais', ''), 100)
        site_web = lien_sur(sanitize_text(request.form.get('site_web', ''), 500))
        if not nom or not universite or not niveau:
            flash('Nom, universite et niveau requis.', 'error')
            return render_template('ajouter_formation.html')
        conn = get_db()
        conn.execute('INSERT INTO formations (nom, universite, niveau, description, duree, debouches, frais, site_web) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (nom, universite, niveau, description, duree, debouches, frais, site_web))
        conn.commit()
        conn.close()
        notifier_tous('formation', 'Nouvelle formation disponible : ' + nom, '/formations')
        return redirect(url_for('formations'))
    return render_template('ajouter_formation.html')

@app.route('/formations/<int:id>')
def detail_formation(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    f = conn.execute('SELECT * FROM formations WHERE id = ?', (id,)).fetchone()
    conn.close()
    if not f:
        return redirect(url_for('formations'))
    return render_template('detail_formation.html', formation=f)

@app.route('/formations/_seed')
def seed_formations():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    if conn.execute('SELECT COUNT(*) as nb FROM formations').fetchone()['nb'] > 0:
        conn.close()
        return redirect(url_for('formations'))
    formations = [
        ('Licence en Informatique', 'UFHB (Universite Felix Houphouet-Boigny)', 'Licence 1', 'Formation fondamentale en informatique : algorithmique, programmation, reseaux, bases de donnees.', '3 ans', 'Developpeur, Administrateur reseau, Analyste', 'Gratuit (bourse etat)', 'https://ufhb.edu.ci'),
        ('Licence en Mathematiques', 'UFHB (Universite Felix Houphouet-Boigny)', 'Licence 1', 'Formation en mathematiques pures et appliquees.', '3 ans', 'Enseignant, Statisticien, Actuaire', 'Gratuit (bourse etat)', 'https://ufhb.edu.ci'),
        ('Cycle Ingenieur Informatique', 'INPHB (Institut National Polytechnique)', 'Cycle Ingenieur', 'Formation d\'ingenieur en informatique et technologies numeriques.', '5 ans', 'Ingenieur informaticien, Chef de projet IT', '500 000 FCFA/an', 'https://inphb.ci'),
        ('Cycle Ingenieur Genie Civil', 'INPHB (Institut National Polytechnique)', 'Cycle Ingenieur', 'Formation d\'ingenieur en genie civil et infrastructures.', '5 ans', 'Ingenieur genie civil, Conducteur de travaux', '500 000 FCFA/an', 'https://inphb.ci'),
        ('Licence en Biologie', 'Universite Nangui Abrogoua', 'Licence 1', 'Formation en biologie generale, ecologie et environnement.', '3 ans', 'Biologiste, Ecologue, Enseignant-chercheur', 'Gratuit (bourse etat)', 'https://una.edu.ci'),
        ('Licence en Droit', 'Universite Alassane Ouattara', 'Licence 1', 'Formation en droit prive et public.', '3 ans', 'Avocat, Notaire, Magistrat, Juriste', 'Gratuit (bourse etat)', 'https://uao.edu.ci'),
        ('Master en Cybersecurite', 'ESATIC (Ecole Superieure Africaine des TIC)', 'Master 1', 'Specialisation en securite des systemes d\'information et cybersecurite.', '2 ans', 'Expert en cybersecurite, Pentester, Analyste SOC', '750 000 FCFA/an', 'https://esatic.ci'),
        ('BTS Informatique', 'ESMIC (Ecole Superieure Multinationale)', 'BTS', 'Formation technique en informatique de gestion et developpement.', '2 ans', 'Developpeur web, Technicien informatique', '300 000 FCFA/an', 'https://esmic.ci'),
        ('Licence en Sciences de Gestion', 'Universite Peleforo Gon Coulibaly', 'Licence 1', 'Formation en gestion, comptabilite et management.', '3 ans', 'Comptable, Gestionnaire, Manager', 'Gratuit (bourse etat)', 'https://upgc.edu.ci'),
        ('Licence en Anglais', 'Universite Jean Lorougnon Guede', 'Licence 1', 'Formation en langue anglaise, litterature et civilisation.', '3 ans', 'Traducteur, Enseignant, Relations internationales', 'Gratuit (bourse etat)', 'https://ujlg.edu.ci'),
    ]
    for f in formations:
        conn.execute('INSERT INTO formations (nom, universite, niveau, description, duree, debouches, frais, site_web) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', f)
    conn.commit()
    conn.close()
    return redirect(url_for('formations'))

@app.route('/sondage', methods=['GET', 'POST'])
def sondage():
    if request.method == 'POST':
        interesse = request.form.get('interesse', '')
        fonction_preferee = request.form.get('fonction_preferee', '')
        universite = request.form.get('universite', '')
        probleme = request.form.get('probleme', '')
        suggestion = request.form.get('suggestion', '')
        contact = request.form.get('contact', '')

        conn = get_db()
        conn.execute('INSERT INTO sondages (interesse, fonction_preferee, universite, probleme, suggestion, contact) VALUES (?, ?, ?, ?, ?, ?)',
                     (interesse, fonction_preferee, universite, probleme, suggestion, contact))
        conn.commit()
        conn.close()
        return render_template('sondage.html', merci=True)

    return render_template('sondage.html', merci=False)

@app.route('/sondage/resultats')
def sondage_resultats():
    conn = get_db()
    total = conn.execute('SELECT COUNT(*) as nb FROM sondages').fetchone()['nb']

    interesses = conn.execute('SELECT interesse, COUNT(*) as nb FROM sondages GROUP BY interesse ORDER BY nb DESC').fetchall()
    fonctions = conn.execute('SELECT fonction_preferee, COUNT(*) as nb FROM sondages GROUP BY fonction_preferee ORDER BY nb DESC').fetchall()
    universites = conn.execute('SELECT universite, COUNT(*) as nb FROM sondages GROUP BY universite ORDER BY nb DESC').fetchall()
    problemes = conn.execute('SELECT probleme, COUNT(*) as nb FROM sondages GROUP BY probleme ORDER BY nb DESC').fetchall()
    reponses = conn.execute('SELECT * FROM sondages ORDER BY date_reponse DESC').fetchall()
    conn.close()

    return render_template('sondage_resultats.html', total=total, interesses=interesses, fonctions=fonctions, universites=universites, problemes=problemes, reponses=reponses)

# ===================== CALENDRIER CAMPUS =====================
@app.route('/calendrier')
def calendrier():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    from datetime import date
    aujourdhui = date.today().isoformat()
    conn = get_db()
    events = conn.execute('SELECT * FROM evenements ORDER BY date_event ASC').fetchall()
    conn.close()
    return render_template('calendrier.html', events=events, aujourdhui=aujourdhui)

@app.route('/calendrier/ajouter', methods=['POST'])
def ajouter_evenement():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    titre = sanitize_text(request.form.get('titre', ''), 200)
    description = sanitize_text(request.form.get('description', ''), 2000)
    date_event = sanitize_text(request.form.get('date_event', ''), 20)
    lieu = sanitize_text(request.form.get('lieu', ''), 200)
    if titre and date_event:
        conn = get_db()
        conn.execute('INSERT INTO evenements (user_id, titre, description, date_event, lieu) VALUES (?, ?, ?, ?, ?)',
                     (session['user_id'], titre, description, date_event, lieu))
        conn.commit()
        conn.close()
        notifier_tous('evenement', f"Nouvel evenement : {titre}", '/calendrier')
        flash('Evenement ajoute', 'success')
    return redirect(url_for('calendrier'))

@app.route('/calendrier/supprimer/<int:id>', methods=['POST'])
def supprimer_evenement(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('DELETE FROM evenements WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect(url_for('calendrier'))

# ===================== GROUPES DE DISCUSSION =====================
@app.route('/groupes')
def groupes():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    mes_groupes = conn.execute('''
        SELECT g.*, gm.role FROM groupes g
        JOIN groupe_membres gm ON gm.groupe_id = g.id
        WHERE gm.user_id = ?
        ORDER BY g.nom
    ''', (session['user_id'],)).fetchall()
    tous_groupes = conn.execute('''
        SELECT g.*,
            (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id) as nb_membres
        FROM groupes g WHERE g.id NOT IN (
            SELECT groupe_id FROM groupe_membres WHERE user_id = ?
        ) ORDER BY g.nom
    ''', (session['user_id'],)).fetchall()
    membres_count = {}
    for g in tous_groupes:
        membres_count[g['id']] = g['nb_membres']
    for g in mes_groupes:
        cnt = conn.execute('SELECT COUNT(*) as nb FROM groupe_membres WHERE groupe_id = ?', (g['id'],)).fetchone()['nb']
        membres_count[g['id']] = cnt
    conn.close()
    return render_template('groupes.html', mes_groupes=mes_groupes, tous_groupes=tous_groupes, membres_count=membres_count)

@app.route('/groupes/creer', methods=['POST'])
def creer_groupe():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    nom = sanitize_text(request.form.get('nom', ''), 100)
    description = sanitize_text(request.form.get('description', ''), 500)
    universite = sanitize_text(request.form.get('universite', ''), 100)
    if nom:
        conn = get_db()
        c = conn.execute('INSERT INTO groupes (nom, description, universite, createur_id) VALUES (?, ?, ?, ?)',
                         (nom, description, universite, session['user_id']))
        gid = c.lastrowid
        conn.execute('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)',
                     (gid, session['user_id'], 'admin'))
        conn.commit()
        conn.close()
        flash('Groupe cree', 'success')
    return redirect(url_for('groupes'))

@app.route('/groupes/rejoindre/<int:id>', methods=['POST'])
def rejoindre_groupe(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    exists = conn.execute('SELECT id FROM groupe_membres WHERE groupe_id = ? AND user_id = ?',
                          (id, session['user_id'])).fetchone()
    if not exists:
        conn.execute('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)',
                     (id, session['user_id'], 'membre'))
        conn.commit()
    conn.close()
    return redirect(url_for('discussion_groupe', id=id))

@app.route('/groupes/<int:id>')
def discussion_groupe(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    groupe = conn.execute('SELECT * FROM groupes WHERE id = ?', (id,)).fetchone()
    if not groupe:
        conn.close()
        return redirect(url_for('groupes'))
    membre = conn.execute('SELECT * FROM groupe_membres WHERE groupe_id = ? AND user_id = ?',
                          (id, session['user_id'])).fetchone()
    if not membre:
        conn.close()
        flash('Tu dois rejoindre ce groupe', 'error')
        return redirect(url_for('groupes'))
    messages = conn.execute('''
        SELECT gm.*, users.prenom, users.nom
        FROM groupe_messages gm
        JOIN users ON gm.user_id = users.id
        WHERE gm.groupe_id = ?
        ORDER BY gm.date_envoi ASC
    ''', (id,)).fetchall()
    membres = conn.execute('''
        SELECT users.id, users.prenom, users.nom, gm.role
        FROM groupe_membres gm
        JOIN users ON gm.user_id = users.id
        WHERE gm.groupe_id = ?
    ''', (id,)).fetchall()
    conn.close()
    return render_template('discussion_groupe.html', groupe=groupe, messages=messages, membres=membres, membre=membre)

@app.route('/groupes/<int:id>/envoyer', methods=['POST'])
def envoyer_message_groupe(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = sanitize_text(request.form.get('contenu', ''), 5000)
    if contenu:
        conn = get_db()
        conn.execute('INSERT INTO groupe_messages (groupe_id, user_id, contenu) VALUES (?, ?, ?)',
                     (id, session['user_id'], contenu))
        conn.commit()
        conn.close()
        diffuser_message_groupe(id, session['user_id'])
        process_mentions(contenu, auteur_nom=session.get('user_nom', 'Quelqu\'un'))
        check_and_award_badges(session['user_id'])
    return redirect(url_for('discussion_groupe', id=id))

@app.route('/groupes/quitter/<int:id>', methods=['POST'])
def quitter_groupe(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    conn.execute('DELETE FROM groupe_membres WHERE groupe_id = ? AND user_id = ?',
                 (id, session['user_id']))
    conn.commit()
    conn.close()
    return redirect(url_for('groupes'))

# ===================== BACKUP =====================
@app.route('/admin/backup')
def admin_backup():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()
    if not est_admin(user):
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    if db.IS_PG:
        flash('Base PostgreSQL : utilise les sauvegardes / branches de ton hebergeur (Neon).', 'info')
        return redirect(url_for('admin_dashboard'))
    import subprocess, tempfile, zipfile, shutil
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    tmp = tempfile.mkdtemp()
    try:
        db_src = os.path.join(app.root_path, 'linkci.db')
        if os.path.exists(db_src):
            shutil.copy2(db_src, os.path.join(tmp, 'linkci.db'))
        uploads_src = os.path.join(app.root_path, 'uploads')
        if os.path.exists(uploads_src):
            shutil.copytree(uploads_src, os.path.join(tmp, 'uploads'))
        avatars_src = os.path.join(app.root_path, 'static', 'avatars')
        if os.path.exists(avatars_src):
            shutil.copytree(avatars_src, os.path.join(tmp, 'avatars'))
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(tmp):
                for f in files:
                    fp = os.path.join(root, f)
                    arcname = os.path.relpath(fp, tmp)
                    zf.write(fp, arcname)
        zip_buf.seek(0)
        return send_file(zip_buf, mimetype='application/zip', as_attachment=True, download_name=f'linkci_backup_{ts}.zip')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

# ===================== ADMIN DASHBOARD =====================
@app.route('/admin')
def admin_dashboard():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    if not est_admin(user):
        conn.close()
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    stats = {}
    stats['users'] = conn.execute('SELECT COUNT(*) as nb FROM users').fetchone()['nb']
    stats['posts'] = conn.execute('SELECT COUNT(*) as nb FROM posts').fetchone()['nb']
    stats['bourses'] = conn.execute('SELECT COUNT(*) as nb FROM bourses').fetchone()['nb']
    stats['documents'] = conn.execute('SELECT COUNT(*) as nb FROM documents').fetchone()['nb']
    stats['formations'] = conn.execute('SELECT COUNT(*) as nb FROM formations').fetchone()['nb']
    stats['messages'] = conn.execute('SELECT COUNT(*) as nb FROM messages').fetchone()['nb']
    stats['sondages'] = conn.execute('SELECT COUNT(*) as nb FROM sondages').fetchone()['nb']
    stats['groupes'] = conn.execute('SELECT COUNT(*) as nb FROM groupes').fetchone()['nb']
    stats['evenements'] = conn.execute('SELECT COUNT(*) as nb FROM evenements').fetchone()['nb']
    derniers_inscrits = conn.execute('SELECT id, prenom, nom, email, universite, date_inscription FROM users ORDER BY date_inscription DESC LIMIT 10').fetchall()
    derniers_posts = conn.execute('SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom FROM posts JOIN users ON posts.user_id = users.id ORDER BY posts.date_post DESC LIMIT 10').fetchall()
    conn.close()
    return render_template('admin.html', stats=stats, derniers_inscrits=derniers_inscrits, derniers_posts=derniers_posts)

# ===================== ADMIN MODERATION =====================

def admin_required():
    if 'user_id' not in session:
        return None
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()
    if not est_admin(user):
        return None
    return user

@app.route('/admin/utilisateurs')
def admin_utilisateurs():
    u = admin_required()
    if not u:
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    conn = get_db()
    utilisateurs = conn.execute('SELECT id, prenom, nom, email, universite, banni, date_inscription FROM users ORDER BY date_inscription DESC').fetchall()
    conn.close()
    return render_template('admin_utilisateurs.html', utilisateurs=utilisateurs)

@app.route('/admin/bannir/<int:user_id>', methods=['POST'])
def admin_bannir(user_id):
    u = admin_required()
    if not u:
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    conn = get_db()
    cible = conn.execute('SELECT id, email, banni, role FROM users WHERE id = ?', (user_id,)).fetchone()
    if not cible:
        conn.close()
        flash('Utilisateur introuvable', 'error')
        return redirect(url_for('admin_utilisateurs'))
    if est_admin(cible):
        conn.close()
        flash('Impossible de bannir un administrateur', 'error')
        return redirect(url_for('admin_utilisateurs'))
    nouvel_etat = 0 if cible['banni'] else 1
    conn.execute('UPDATE users SET banni = ? WHERE id = ?', (nouvel_etat, user_id))
    conn.commit()
    conn.close()
    action = 'debanni' if nouvel_etat == 0 else 'banni'
    flash(f'Utilisateur {action} avec succes', 'success')
    return redirect(url_for('admin_utilisateurs'))

@app.route('/admin/supprimer_post/<int:post_id>', methods=['POST'])
def admin_supprimer_post(post_id):
    u = admin_required()
    if not u:
        return jsonify({'error': 'Acces reserve'}), 403
    conn = get_db()
    post = conn.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
    if not post:
        conn.close()
        return jsonify({'error': 'Post introuvable'}), 404
    conn.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM commentaires WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    # Delete post image if any
    if post['image']:
        supprimer_fichier('static/uploads/' + post['image'])
    conn.commit()
    conn.close()
    flash('Publication supprimee', 'success')
    return redirect(request.referrer or url_for('admin_dashboard'))

@app.route('/admin/supprimer_document/<int:doc_id>', methods=['POST'])
def admin_supprimer_document(doc_id):
    u = admin_required()
    if not u:
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    conn = get_db()
    doc = conn.execute('SELECT * FROM documents WHERE id = ?', (doc_id,)).fetchone()
    if not doc:
        conn.close()
        flash('Document introuvable', 'error')
        return redirect(url_for('admin_dashboard'))
    supprimer_fichier('uploads/' + doc['fichier'])
    conn.execute('DELETE FROM documents WHERE id = ?', (doc_id,))
    conn.commit()
    conn.close()
    flash('Document supprime', 'success')
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/supprimer_bourse/<int:bourse_id>', methods=['POST'])
def admin_supprimer_bourse(bourse_id):
    u = admin_required()
    if not u:
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    conn = get_db()
    conn.execute('DELETE FROM bourses WHERE id = ?', (bourse_id,))
    conn.commit()
    conn.close()
    flash('Bourse supprimee', 'success')
    return redirect(url_for('admin_dashboard'))

# ===================== EXPORT CSV =====================
@app.route('/sondage/export')
def export_sondage_csv():
    if not admin_required():
        flash('Acces reserve', 'error')
        return redirect(url_for('connexion'))
    conn = get_db()
    rows = conn.execute('SELECT * FROM sondages ORDER BY date_reponse DESC').fetchall()
    conn.close()
    import csv, io
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(['ID', 'Interet', 'Fonction preferee', 'Universite', 'Probleme', 'Suggestion', 'Contact', 'Date'])
    for r in rows:
        w.writerow([r['id'], r['interesse'], r['fonction_preferee'], r['universite'], r['probleme'], r['suggestion'], r['contact'], r['date_reponse']])
    resp = app.response_class(output.getvalue(), mimetype='text/csv', headers={'Content-Disposition': 'attachment;filename=sondages.csv'})
    return resp

@app.route('/bourses/export')
def export_bourses_csv():
    if not admin_required():
        flash('Acces reserve', 'error')
        return redirect(url_for('connexion'))
    conn = get_db()
    rows = conn.execute('SELECT * FROM bourses ORDER BY date_publication DESC').fetchall()
    conn.close()
    import csv, io
    output = io.StringIO()
    w = csv.writer(output)
    w.writerow(['ID', 'Titre', 'Organisme', 'Type', 'Montant', 'Cible', 'Deadline', 'Pays', 'Lien', 'Expiree', 'Date publication'])
    for r in rows:
        w.writerow([r['id'], r['titre'], r['organisme'], r['type'], r['montant'], r['cible'], r['deadline'], r['pays'], r['lien'], r['expiree'], r['date_publication']])
    resp = app.response_class(output.getvalue(), mimetype='text/csv', headers={'Content-Disposition': 'attachment;filename=bourses.csv'})
    return resp

# ===================== API REST (pour app mobile) =====================
API_SECRET = app.secret_key

def api_require_auth():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    return verifier_jeton_api(auth[7:])

# Jetons de l'app : signes (itsdangerous), valables 60 jours, et revocables
# (users.jeton_version est incremente au changement de mot de passe).
from itsdangerous import URLSafeTimedSerializer as _Serialiseur, BadSignature as _MauvaiseSignature
_jetons_api = _Serialiseur(API_SECRET, salt='jeton-api-linkci')
DUREE_JETON = 60 * 24 * 3600

def verifier_jeton_api(token):
    """Renvoie l'id de l'utilisateur si le jeton est valide (signature, date, version,
    compte non banni), sinon None."""
    if not token:
        return None
    try:
        data = _jetons_api.loads(token, max_age=DUREE_JETON)
        user_id, version = int(data['u']), int(data['v'])
    except (_MauvaiseSignature, KeyError, TypeError, ValueError):
        return None
    conn = get_db()
    user = conn.execute('SELECT banni, jeton_version FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if not user or user['banni'] or (user['jeton_version'] or 0) != version:
        return None
    return user_id

def api_token(user_id):
    conn = get_db()
    user = conn.execute('SELECT jeton_version FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return _jetons_api.dumps({'u': int(user_id), 'v': (user['jeton_version'] or 0) if user else 0})

CHAMPS_PUBLICS_USER = 'id, nom, prenom, universite, filiere, annee, bio, avatar, date_inscription'

@app.route('/api/register', methods=['POST'])
def api_register():
    ip = request.remote_addr or 'unknown'
    if not check_rate_limit(f'api_register:{ip}'):
        return jsonify({'error': 'Trop de tentatives. Reessaie dans 5 minutes.'}), 429
    data = request.json
    if not data:
        return jsonify({'error': 'JSON requis'}), 400
    nom = data.get('nom', '').strip()
    prenom = data.get('prenom', '').strip()
    email = normaliser_email(data.get('email', ''))
    mot_de_passe = data.get('mot_de_passe', '')
    if not all([nom, prenom, email, mot_de_passe]):
        return jsonify({'error': 'Champs requis : nom, prenom, email, mot_de_passe'}), 400
    if not validate_email(email):
        return jsonify({'error': 'Email invalide'}), 400
    if not validate_password(mot_de_passe):
        return jsonify({'error': f'Mot de passe trop court (min {MDP_MIN} caracteres)'}), 400
    conn = get_db()
    try:
        if conn.execute('SELECT 1 FROM users WHERE lower(email) = ?', (email,)).fetchone():
            raise db.IntegrityError('email deja utilise')
        conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (nom, prenom, email, hash_password(mot_de_passe),
                      data.get('universite', ''), data.get('filiere', ''), data.get('annee', '')))
        conn.commit()
        user = conn.execute('SELECT id, nom, prenom, email, universite, filiere FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        return jsonify({'token': api_token(user['id']), 'user': dict(user)}), 201
    except db.IntegrityError:
        conn.close()
        return jsonify({'error': 'Email deja utilise'}), 409

@app.route('/api/login', methods=['POST'])
def api_login():
    ip = request.remote_addr or 'unknown'
    if not check_rate_limit(f'api_login:{ip}'):
        return jsonify({'error': 'Trop de tentatives. Reessaie dans 1 minute.'}), 429
    data = request.json
    if not data:
        return jsonify({'error': 'JSON requis'}), 400
    email = normaliser_email(data.get('email', ''))
    if not check_rate_limit(f'connexion_compte:{email}', max_reqs=10, window=900):
        return jsonify({'error': 'Trop de tentatives sur ce compte. Reessaie dans 15 minutes.'}), 429
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE lower(email) = ?', (email,)).fetchone()
    if not user or not check_password(data.get('mot_de_passe', ''), user['mot_de_passe']):
        conn.close()
        return jsonify({'error': 'Email ou mot de passe incorrect'}), 401
    if user['banni']:
        conn.close()
        return jsonify({'error': "Compte suspendu. Contacte l'administration."}), 403
    if not user['mot_de_passe'].startswith('$2'):
        nouveau = hash_password(data.get('mot_de_passe', ''))
        conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
        conn.commit()
    conn.close()
    # jamais le hash du mot de passe ni les champs internes
    profil = {k: user[k] for k in ('id', 'nom', 'prenom', 'email', 'universite', 'filiere', 'annee', 'bio', 'avatar')}
    return jsonify({'token': api_token(user['id']), 'user': profil})

@app.route('/api/me')
def api_me():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    user = conn.execute('SELECT id, nom, prenom, email, universite, filiere, annee, bio, avatar, date_inscription FROM users WHERE id = ?', (user_id,)).fetchone()
    badges = conn.execute('''
        SELECT b.* FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ? ORDER BY ub.date_obtention DESC
    ''', (user_id,)).fetchall()
    conn.close()
    if not user:
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    result = dict(user)
    result['badges'] = [dict(b) for b in badges]
    return jsonify(result)

@app.route('/api/posts', methods=['GET'])
def api_posts():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    page = request.args.get('page', 1, type=int)
    per_page = 20
    offset = (page - 1) * per_page
    conn = get_db()
    posts = conn.execute('''
        SELECT posts.id, posts.user_id, posts.contenu, posts.image, posts.date_post,
               users.prenom, users.nom, users.universite, users.avatar,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires,
               EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) as a_like,
               (posts.user_id = ?) as est_auteur
        FROM posts JOIN users ON posts.user_id = users.id
        ORDER BY posts.date_post DESC LIMIT ? OFFSET ?
    ''', (user_id, user_id, per_page, offset)).fetchall()
    conn.close()
    return jsonify([dict(p) for p in posts])

@app.route('/api/posts', methods=['POST'])
def api_create_post():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    ip = request.remote_addr or 'unknown'
    if not check_rate_limit(f'publication:{user_id}', max_reqs=10, window=60):
        return jsonify({'error': 'Trop de publications. Ralentis.'}), 429
    data = request.json
    # Une photo seule (sans texte) est acceptee
    if not data or not (data.get('contenu', '').strip() or data.get('image')):
        return jsonify({'error': 'Contenu requis'}), 400
    contenu = data.get('contenu', '').strip()
    if len(contenu) > FIELD_MAXLEN['contenu']:
        return jsonify({'error': f"Maximum {FIELD_MAXLEN['contenu']} caracteres"}), 400
    contenu = sanitize_text(contenu, FIELD_MAXLEN['contenu'])
    conn = get_db()
    image_nom = None
    image_b64 = data.get('image')
    if image_b64:
        import base64, binascii
        try:
            img_data = base64.b64decode(image_b64, validate=True)
        except (binascii.Error, ValueError):
            img_data = b''
        ext = extension_image(img_data)
        if not ext:
            conn.close()
            return jsonify({'error': 'Image invalide (JPEG, PNG, GIF ou WebP)'}), 400
        image_nom = f"{uuid.uuid4().hex}{ext}"
        stocker_fichier('static/uploads/' + image_nom, img_data)
    post_id = conn.execute('INSERT INTO posts (user_id, contenu, image) VALUES (?, ?, ?)', (user_id, contenu, image_nom)).lastrowid
    conn.commit()
    auteur = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
    auteur_nom = f"{auteur['prenom']} {auteur['nom']}" if auteur else 'Quelqu\'un'
    process_mentions(contenu, post_id=post_id, auteur_nom=auteur_nom)
    check_and_award_badges(user_id)
    conn.close()
    return jsonify({'id': post_id, 'message': 'Publie'}), 201

@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
def api_like(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    try:
        conn.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', (user_id, post_id))
        conn.commit()
        liked = True
    except db.IntegrityError:
        conn.execute('DELETE FROM likes WHERE user_id = ? AND post_id = ?', (user_id, post_id))
        conn.commit()
        liked = False
    nb = conn.execute('SELECT COUNT(*) as nb FROM likes WHERE post_id = ?', (post_id,)).fetchone()['nb']
    conn.close()
    return jsonify({'liked': liked, 'nb_likes': nb})

@app.route('/api/posts/<int:post_id>/comments', methods=['GET'])
def api_comments(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    comments = conn.execute('''
        SELECT commentaires.id, commentaires.user_id, commentaires.contenu, commentaires.date_commentaire,
               users.prenom, users.nom, users.avatar
        FROM commentaires JOIN users ON commentaires.user_id = users.id
        WHERE commentaires.post_id = ? ORDER BY commentaires.date_commentaire ASC
    ''', (post_id,)).fetchall()
    conn.close()
    return jsonify([dict(c) for c in comments])

@app.route('/api/posts/<int:post_id>/comments', methods=['POST'])
def api_add_comment(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('contenu', '').strip():
        return jsonify({'error': 'Contenu requis'}), 400
    contenu = sanitize_text(data['contenu'].strip())
    if len(contenu) > FIELD_MAXLEN.get('contenu', 5000):
        return jsonify({'error': f'Maximum {FIELD_MAXLEN.get("contenu", 5000)} caracteres'}), 400
    conn = get_db()
    commentaire_id = conn.execute('INSERT INTO commentaires (user_id, post_id, contenu) VALUES (?, ?, ?)',
                 (user_id, post_id, contenu)).lastrowid
    conn.commit()
    auteur = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
    auteur_nom = f"{auteur['prenom']} {auteur['nom']}" if auteur else 'Quelqu\'un'
    process_mentions(contenu, commentaire_id=commentaire_id, auteur_nom=auteur_nom)
    check_and_award_badges(user_id)
    conn.close()
    return jsonify({'id': commentaire_id, 'message': 'Commente'}), 201

@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
def api_delete_post(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    post = conn.execute('SELECT user_id, image FROM posts WHERE id = ?', (post_id,)).fetchone()
    if not post or post['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Non autorise'}), 403
    conn.execute('DELETE FROM commentaires WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    conn.commit()
    conn.close()
    if post['image']:
        supprimer_fichier('static/uploads/' + post['image'])
    return jsonify({'message': 'Supprime'})

@app.route('/api/bourses')
def api_bourses():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    from datetime import date
    aujourdhui = date.today().isoformat()
    conn = get_db()
    conn.execute("UPDATE bourses SET expiree = 1 WHERE deadline != '' AND deadline < ? AND expiree = 0", (aujourdhui,))
    conn.commit()
    bourses = conn.execute('SELECT * FROM bourses ORDER BY expiree ASC, date_publication DESC').fetchall()
    conn.close()
    return jsonify([dict(b) for b in bourses])

@app.route('/api/formations')
def api_formations():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    formations = conn.execute('SELECT * FROM formations ORDER BY universite, nom').fetchall()
    conn.close()
    return jsonify([dict(f) for f in formations])

@app.route('/api/messages')
def api_messages():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    autre_id = request.args.get('avec', type=int)
    if not autre_id:
        return jsonify({'error': 'Parametre "avec" requis'}), 400
    conn = get_db()
    messages = conn.execute('''
        SELECT messages.*, users.prenom, users.nom
        FROM messages JOIN users ON messages.expediteur_id = users.id
        WHERE (expediteur_id = ? AND destinataire_id = ?) OR (expediteur_id = ? AND destinataire_id = ?)
        ORDER BY date_envoi ASC
    ''', (user_id, autre_id, autre_id, user_id)).fetchall()
    conn.execute('UPDATE messages SET lu = 1 WHERE expediteur_id = ? AND destinataire_id = ?', (autre_id, user_id))
    conn.commit()
    conn.close()
    return jsonify([dict(m) for m in messages])

@app.route('/api/messages', methods=['POST'])
def api_send_message():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('contenu', '').strip() or not data.get('destinataire_id'):
        return jsonify({'error': 'contenu et destinataire_id requis'}), 400
    contenu = sanitize_text(data['contenu'], FIELD_MAXLEN['message'])
    try:
        destinataire_id = int(data['destinataire_id'])
    except (TypeError, ValueError):
        return jsonify({'error': 'destinataire_id invalide'}), 400
    if destinataire_id == user_id:
        return jsonify({'error': "Tu ne peux pas t'envoyer un message"}), 400
    conn = get_db()
    if not conn.execute('SELECT 1 FROM users WHERE id = ?', (destinataire_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Destinataire introuvable'}), 404
    msg_id = conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                          (user_id, destinataire_id, contenu)).lastrowid
    conn.commit()
    auteur = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    diffuser_message(user_id, destinataire_id, msg_id, contenu)
    nom = f"{auteur['prenom']} {auteur['nom']}" if auteur else "quelqu'un"
    creer_notification(destinataire_id, 'message', f"Nouveau message de {nom}", f"/conversation/{user_id}")
    return jsonify({'message': 'Envoye', 'id': msg_id}), 201

@app.route('/api/conversations')
def api_conversations():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    convs = conn.execute('''
        SELECT DISTINCT
            CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END as autre_id,
            users.prenom, users.nom, users.universite, users.avatar,
            (SELECT contenu FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
            (SELECT date_envoi FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as date_dernier,
            (SELECT COUNT(*) FROM messages WHERE destinataire_id = ? AND expediteur_id = users.id AND lu = 0) as non_lu
        FROM messages JOIN users ON users.id = CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END
        WHERE expediteur_id = ? OR destinataire_id = ?
        ORDER BY date_dernier DESC
    ''', (user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id)).fetchall()
    conn.close()
    return jsonify([dict(c) for c in convs])

@app.route('/api/notifications')
def api_notifications():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    notifs = conn.execute('SELECT * FROM notifications WHERE user_id = ? ORDER BY date_notification DESC LIMIT 50', (user_id,)).fetchall()
    non_lu = conn.execute('SELECT COUNT(*) as nb FROM notifications WHERE user_id = ? AND lu = 0', (user_id,)).fetchone()['nb']
    conn.close()
    return jsonify({'notifications': [dict(n) for n in notifs], 'non_lu': non_lu})

@app.route('/api/profil/<int:autre_id>')
def api_profil(autre_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    user = conn.execute(f'SELECT {CHAMPS_PUBLICS_USER} FROM users WHERE id = ?', (autre_id,)).fetchone()  # pas d'email
    if not user:
        conn.close()
        return jsonify({'error': 'Introuvable'}), 404
    posts = conn.execute('''
        SELECT id, contenu, image, date_post,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires
        FROM posts WHERE user_id = ? ORDER BY date_post DESC
    ''', (autre_id,)).fetchall()
    badges = conn.execute('''
        SELECT b.* FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ? ORDER BY ub.date_obtention DESC
    ''', (autre_id,)).fetchall()
    conn.close()
    return jsonify({'user': dict(user), 'posts': [dict(p) for p in posts], 'badges': [dict(b) for b in badges]})

@app.route('/api/documents')
def api_documents():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    docs = conn.execute('''
        SELECT documents.*, users.prenom, users.nom
        FROM documents JOIN users ON documents.user_id = users.id
        ORDER BY date_upload DESC
    ''').fetchall()
    conn.close()
    return jsonify([dict(d) for d in docs])

# Lien de telechargement temporaire pour l'app mobile : le navigateur du
# telephone n'a pas de session, on lui donne une URL signee valable 5 minutes.
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
_liens_docs = URLSafeTimedSerializer(app.secret_key, salt='telechargement-document')

@app.route('/api/compteurs')
def api_compteurs():
    """Pastilles de l'app : messages prives et notifications non lus
    (les notifications de message sont deja comptees dans les messages)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    messages = conn.execute('SELECT COUNT(*) as nb FROM messages WHERE destinataire_id = ? AND lu = 0', (user_id,)).fetchone()['nb']
    notifs = conn.execute("SELECT COUNT(*) as nb FROM notifications WHERE user_id = ? AND lu = 0 AND type != 'message'", (user_id,)).fetchone()['nb']
    conn.close()
    return jsonify({'messages': messages, 'notifications': notifs})

@app.route('/api/notifications/lire', methods=['POST'])
def api_notifications_lues():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('UPDATE notifications SET lu = 1 WHERE user_id = ? AND lu = 0', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Notifications lues'})

@app.route('/api/documents/<int:doc_id>/lien')
def api_lien_document(doc_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    doc = conn.execute('SELECT id, fichier FROM documents WHERE id = ?', (doc_id,)).fetchone()
    conn.close()
    if not doc:
        return jsonify({'error': 'Document introuvable'}), 404
    if not restaurer_fichier('uploads/' + doc['fichier']):
        return jsonify({'error': "Le fichier de ce document n'est plus disponible"}), 404
    jeton = _liens_docs.dumps(doc_id)
    # chemin relatif : l'app le complete avec l'adresse du serveur (https derriere le proxy Render)
    return jsonify({'chemin': url_for('fichier_document', doc_id=doc_id, t=jeton)})

@app.route('/documents/<int:doc_id>/fichier')
def fichier_document(doc_id):
    try:
        if _liens_docs.loads(request.args.get('t', ''), max_age=300) != doc_id:
            raise BadSignature('autre document')
    except SignatureExpired:
        return "Lien expire : relance le telechargement depuis l'application.", 410
    except BadSignature:
        return 'Lien invalide.', 403
    conn = get_db()
    doc = conn.execute('SELECT * FROM documents WHERE id = ?', (doc_id,)).fetchone()
    if not doc or not restaurer_fichier('uploads/' + doc['fichier']):
        conn.close()
        return 'Fichier introuvable.', 404
    conn.execute('UPDATE documents SET telechargements = telechargements + 1 WHERE id = ?', (doc_id,))
    conn.commit()
    conn.close()
    return send_file(os.path.join(app.root_path, 'uploads', doc['fichier']), as_attachment=True,
                     download_name=doc['titre'] + os.path.splitext(doc['fichier'])[1])

@app.route('/api/profil', methods=['PUT'])
def api_modifier_profil():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json or {}
    champs = {k: sanitize_text(str(data.get(k) or ''), n) for k, n in
              (('prenom', 50), ('nom', 50), ('universite', 100), ('filiere', 100), ('annee', 20), ('bio', 500))}
    if not champs['prenom'] or not champs['nom']:
        return jsonify({'error': 'Prenom et nom requis'}), 400
    conn = get_db()
    ancien = conn.execute('SELECT avatar FROM users WHERE id = ?', (user_id,)).fetchone()
    avatar = ancien['avatar'] if ancien else None
    if data.get('avatar'):
        import base64, binascii
        try:
            img = base64.b64decode(data['avatar'], validate=True)
        except (binascii.Error, ValueError):
            img = b''
        ext = extension_image(img)
        if not ext:
            conn.close()
            return jsonify({'error': 'Image invalide (JPEG, PNG, GIF ou WebP)'}), 400
        # nom unique a chaque changement : evite que les telephones gardent l'ancienne photo en cache
        avatar = f"user_{user_id}_{uuid.uuid4().hex[:8]}{ext}"
        stocker_fichier('static/avatars/' + avatar, img)
        if ancien and ancien['avatar'] and ancien['avatar'] != 'default.png':
            supprimer_fichier('static/avatars/' + ancien['avatar'])
    conn.execute('UPDATE users SET prenom=?, nom=?, universite=?, filiere=?, annee=?, bio=?, avatar=? WHERE id=?',
                 (champs['prenom'], champs['nom'], champs['universite'], champs['filiere'],
                  champs['annee'], champs['bio'], avatar, user_id))
    conn.commit()
    user = conn.execute('SELECT id, nom, prenom, email, universite, filiere, annee, bio, avatar, date_inscription FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return jsonify(dict(user))

@app.route('/api/evenements')
def api_evenements():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    from datetime import date
    aujourdhui = date.today().isoformat()
    conn = get_db()
    events = conn.execute('SELECT * FROM evenements ORDER BY date_event ASC').fetchall()
    conn.close()
    return jsonify([dict(e) for e in events])

@app.route('/api/evenements', methods=['POST'])
def api_ajouter_evenement():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('titre') or not data.get('date_event'):
        return jsonify({'error': 'titre et date_event requis'}), 400
    conn = get_db()
    conn.execute('INSERT INTO evenements (user_id, titre, description, date_event, lieu) VALUES (?, ?, ?, ?, ?)',
                 (user_id, data['titre'], data.get('description', ''), data['date_event'], data.get('lieu', '')))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Cree'}), 201

@app.route('/api/evenements/<int:id>', methods=['DELETE'])
def api_supprimer_evenement(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('DELETE FROM evenements WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Supprime'})

@app.route('/api/groupes')
def api_groupes():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    mes_groupes = conn.execute('''
        SELECT g.*, gm.role FROM groupes g
        JOIN groupe_membres gm ON gm.groupe_id = g.id
        WHERE gm.user_id = ? ORDER BY g.nom
    ''', (user_id,)).fetchall()
    tous_groupes = conn.execute('''
        SELECT g.*,
            (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id) as nb_membres
        FROM groupes g WHERE g.id NOT IN (
            SELECT groupe_id FROM groupe_membres WHERE user_id = ?
        ) ORDER BY g.nom
    ''', (user_id,)).fetchall()
    conn.close()
    return jsonify({'mes_groupes': [dict(g) for g in mes_groupes], 'tous_groupes': [dict(g) for g in tous_groupes]})

@app.route('/api/groupes', methods=['POST'])
def api_creer_groupe():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('nom', '').strip():
        return jsonify({'error': 'Nom du groupe requis'}), 400
    conn = get_db()
    c = conn.execute('INSERT INTO groupes (nom, description, universite, createur_id) VALUES (?, ?, ?, ?)',
                     (data['nom'].strip(), data.get('description', ''), data.get('universite', ''), user_id))
    gid = c.lastrowid
    conn.execute('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)', (gid, user_id, 'admin'))
    conn.commit()
    conn.close()
    return jsonify({'id': gid, 'message': 'Groupe cree'}), 201

@app.route('/api/groupes/<int:id>/rejoindre', methods=['POST'])
def api_rejoindre_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    if not conn.execute('SELECT 1 FROM groupes WHERE id = ?', (id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Groupe introuvable'}), 404
    exists = conn.execute('SELECT id FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, user_id)).fetchone()
    if not exists:
        conn.execute('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)', (id, user_id, 'membre'))
        conn.commit()
    conn.close()
    return jsonify({'message': 'Rejoint'})

@app.route('/api/groupes/<int:id>/messages')
def api_groupe_messages(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    membre = conn.execute('SELECT id FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, user_id)).fetchone()
    if not membre:
        conn.close()
        return jsonify({'error': 'Tu n\'es pas membre'}), 403
    messages = conn.execute('''
        SELECT gm.*, users.prenom, users.nom, users.avatar
        FROM groupe_messages gm JOIN users ON gm.user_id = users.id
        WHERE gm.groupe_id = ? ORDER BY gm.date_envoi ASC
    ''', (id,)).fetchall()
    conn.close()
    return jsonify([dict(m) for m in messages])

@app.route('/api/groupes/<int:id>/messages', methods=['POST'])
def api_envoyer_message_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('contenu', '').strip():
        return jsonify({'error': 'Contenu requis'}), 400
    conn = get_db()
    membre = conn.execute('SELECT id FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, user_id)).fetchone()
    if not membre:
        conn.close()
        return jsonify({'error': 'Tu n\'es pas membre'}), 403
    conn.execute('INSERT INTO groupe_messages (groupe_id, user_id, contenu) VALUES (?, ?, ?)',
                 (id, user_id, sanitize_text(data['contenu'], FIELD_MAXLEN['message'])))
    conn.commit()
    conn.close()
    diffuser_message_groupe(id, user_id)
    return jsonify({'message': 'Envoye'}), 201

@app.route('/api/groupes/<int:id>/quitter', methods=['POST'])
def api_quitter_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('DELETE FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, user_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Quitte'})

AVATAR_COLORS = ['#FF6B35','#7C3AED','#059669','#DC2626','#2563EB','#D97706','#DB2777','#0891B2','#65A30D','#9333EA']

@app.template_filter('format_date')
def format_date_filter(dt_str, full=False):
    if not dt_str:
        return ''
    try:
        d = datetime.strptime(dt_str[:10], '%Y-%m-%d').date()
        today = date.today()
        if d == today:
            return "Aujourd'hui" if not full else "Aujourd'hui"
        if d == today - timedelta(days=1):
            return "Hier" if not full else "Hier"
        if full:
            mois = ['Jan','Fev','Mar','Avr','Mai','Juin','Juil','Aou','Sep','Oct','Nov','Dec']
            return f"{d.day} {mois[d.month-1]} {d.year}"
        return dt_str[:10]
    except:
        return ''

@app.template_filter('avatar_color')
def avatar_color_filter(user_id):
    if not user_id:
        return AVATAR_COLORS[0]
    return AVATAR_COLORS[user_id % len(AVATAR_COLORS)]

@app.template_filter('days_until')
def days_until_filter(dt_str):
    if not dt_str:
        return None
    try:
        d = datetime.strptime(dt_str[:10], '%Y-%m-%d').date()
        diff = (d - date.today()).days
        return diff
    except:
        return None

# ===================== API PASSWORD RESET =====================
@app.route('/api/forgot_password', methods=['POST'])
def api_forgot_password():
    data = request.json or {}
    if not data.get('email', '').strip():
        return jsonify({'error': 'Email requis'}), 400
    demander_reinitialisation(data['email'])
    return jsonify({'message': MESSAGE_REINIT})

@app.route('/api/reset_password', methods=['POST'])
def api_reset_password():
    data = request.json or {}
    if not data.get('token') or not data.get('mot_de_passe'):
        return jsonify({'error': 'Token et mot de passe requis'}), 400
    erreur = appliquer_reinitialisation(data['token'], data['mot_de_passe'])
    if erreur:
        return jsonify({'error': erreur}), 400
    return jsonify({'message': 'Mot de passe reinitialise'})

# ===================== SOCKETIO (chat temps reel) =====================
@socketio.on('connect')
def handle_connect(auth=None):
    # L'app mobile n'a pas de session web : elle s'identifie avec son jeton d'API.
    # La session Socket.IO est propre a cette connexion (manage_session).
    if 'user_id' not in session and isinstance(auth, dict) and auth.get('token'):
        uid = verifier_jeton_api(auth['token'])
        if uid:
            conn = get_db()
            u = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (uid,)).fetchone()
            conn.close()
            if u:
                session['user_id'] = uid
                session['user_nom'] = f"{u['prenom']} {u['nom']}"
    if 'user_id' in session:
        join_room('user_' + str(session['user_id']))
        emit('connected', {'user_id': session['user_id']})

@socketio.on('join_notifications')
def handle_join_notifications():
    if 'user_id' in session:
        join_room('user_' + str(session['user_id']))

@socketio.on('disconnect')
def handle_disconnect():
    if 'user_id' in session:
        leave_room('user_' + str(session['user_id']))

@socketio.on('join_conversation')
def handle_join_conversation(data):
    if 'user_id' not in session:
        return
    autre_id = data.get('autre_id')
    if autre_id:
        room = str(min(session['user_id'], autre_id)) + '_' + str(max(session['user_id'], autre_id))
        join_room(room)

@socketio.on('send_message')
def handle_send_message(data):
    if 'user_id' not in session:
        return
    destinataire_id = data.get('destinataire_id')
    contenu = data.get('contenu', '').strip()
    if not destinataire_id or not contenu:
        return

    conn = get_db()
    msg_id = conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                 (session['user_id'], destinataire_id, contenu)).lastrowid
    conn.commit()
    conn.close()
    diffuser_message(session['user_id'], destinataire_id, msg_id, contenu)

    room = str(min(session['user_id'], destinataire_id)) + '_' + str(max(session['user_id'], destinataire_id))
    message_data = {
        'id': msg_id,
        'expediteur_id': session['user_id'],
        'destinataire_id': destinataire_id,
        'contenu': contenu,
        'prenom': session.get('user_nom', '').split()[0],
        'nom': session.get('user_nom', '').split()[-1] if len(session.get('user_nom', '').split()) > 1 else '',
        'date_envoi': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }
    emit('new_message', message_data, room=room)

    # Notify the recipient
    creer_notification(destinataire_id, 'message', "Nouveau message de " + session.get('user_nom', 'quelqu\'un'), '/messagerie')
    emit('notification_update', {'user_id': destinataire_id}, room='user_' + str(destinataire_id))

@socketio.on('typing')
def handle_typing(data):
    if 'user_id' not in session:
        return
    destinataire_id = data.get('destinataire_id')
    if destinataire_id:
        emit('typing_indicator', {
            'user_id': session['user_id'],
            'prenom': session.get('user_nom', '').split()[0]
        }, room='user_' + str(destinataire_id))

# Security headers
@app.after_request
def add_security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['X-XSS-Protection'] = '1; mode=block'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    resp.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    # pas de <object>/<embed>, pas de <base> detourne, pas d'affichage dans un cadre
    resp.headers['Content-Security-Policy'] = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    if not app.debug:
        resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return resp

init_db()

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
