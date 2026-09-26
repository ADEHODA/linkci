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

_HASH_FACTICE = bcrypt.hashpw(b'linkci-factice', bcrypt.gensalt()).decode()

def check_password(mdp, hashed):
    if not hashed:  # compte inexistant : on calcule quand meme un bcrypt
        bcrypt.checkpw((mdp or '').encode(), _HASH_FACTICE.encode())
        return False
    if hashed.startswith('$2'):
        return bcrypt.checkpw(mdp.encode(), hashed.encode())
    return hashlib.sha256(mdp.encode()).hexdigest() == hashed

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload
try:  # reponses compressees : pages et listes 3 a 5 fois plus legeres sur les reseaux mobiles
    from flask_compress import Compress
    app.config['COMPRESS_MIMETYPES'] = ['application/json', 'text/html', 'text/css', 'application/javascript', 'text/javascript']
    app.config['COMPRESS_MIN_SIZE'] = 800
    Compress(app)
except ImportError:
    pass
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
                return redirection_sure(request.referrer, url_for('index'))
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
    # utilisateur_est_admin() : pour n'afficher les boutons d'administration qu'aux admins
    return dict(csrf_token=generate_csrf_token, utilisateur_est_admin=lambda: bool(admin_required()))

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

def trop_rapide(action, qui, max_reqs, fenetre):
    """Anti-spam : True si `qui` a depasse `max_reqs` `action` sur `fenetre` secondes."""
    return not check_rate_limit(f'{action}:{qui}', max_reqs=max_reqs, window=fenetre)

def redirection_sure(url, defaut):
    """N'accepte qu'un chemin interne ('/...') : bloque les redirections vers d'autres sites."""
    if url:
        from urllib.parse import urlparse
        u = urlparse(url)
        if (not u.netloc or u.netloc == request.host) and u.path.startswith('/') and not u.path.startswith('//'):
            return redirect(u.path + (('?' + u.query) if u.query else ''))
    return redirect(defaut)

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
        # Pas de suivi dans flask.g : les evenements Socket.IO partagent le
        # contexte de la connexion temps reel, qui dure tant que l'app est
        # ouverte, et y garder les connexions epuisait le pool. Une connexion
        # oubliee est rendue par PgConnection.__del__.
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

EXTENSIONS_DOCUMENTS = ('.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.zip', '.rar', '.png', '.jpg', '.jpeg')

def document_valide(ext, data):
    """Le contenu correspond-il vraiment a l'extension ? (un .pdf doit etre un PDF...)"""
    if not data:
        return False
    if ext == '.pdf':
        return data[:5] == b'%PDF-'
    if ext in ('.docx', '.pptx', '.zip'):
        return data[:4] in (b'PK\x03\x04', b'PK\x05\x06')
    if ext in ('.doc', '.ppt'):
        return data[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'  # ancien format Office
    if ext == '.rar':
        return data[:4] == b'Rar!'
    if ext in ('.png', '.jpg', '.jpeg'):
        return extension_image(data) in ('.png', '.jpg')
    if ext == '.txt':
        try:
            data.decode('utf-8')
            return b'\x00' not in data
        except UnicodeDecodeError:
            return False
    return False

def enregistrer_document(user_id, titre, description, matiere, universite, nom_origine, data):
    """Verifie et enregistre un document. Renvoie (id, None) ou (None, message d'erreur)."""
    titre = sanitize_text(titre, 200)
    if not titre or not data:
        return None, 'Titre et fichier requis'
    ext = os.path.splitext(nom_origine or '')[1].lower()
    if ext not in EXTENSIONS_DOCUMENTS:
        return None, 'Format non autorise (PDF, Word, PowerPoint, TXT, ZIP, images)'
    if not document_valide(ext, data):
        return None, "Le contenu du fichier ne correspond pas a son format"
    nom_fichier = f"{uuid.uuid4().hex}{ext}"
    stocker_fichier('uploads/' + nom_fichier, data)
    conn = get_db()
    doc_id = conn.execute('INSERT INTO documents (user_id, titre, description, fichier, matiere, universite) VALUES (?, ?, ?, ?, ?, ?)',
                          (user_id, titre, sanitize_text(description, 2000), nom_fichier,
                           sanitize_text(matiere, 100) or None, sanitize_text(universite, 100) or None)).lastrowid
    conn.commit()
    conn.close()
    notifier_tous('document', f"Un nouveau document a ete partage : {titre}", '/documents')
    return doc_id, None

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

    # Moderation : les propositions des etudiants attendent la validation d'un admin
    for table in ('bourses', 'formations'):
        try:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN valide INTEGER DEFAULT 1')
            conn.commit()
        except Exception:
            pass

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

    # Groupes 2.0 : photos et notes vocales dans les groupes, filiere du groupe
    for table, colonne in (('groupe_messages', 'image TEXT'), ('groupe_messages', 'audio TEXT'),
                           ('groupe_messages', 'duree INTEGER'), ('groupes', "filiere TEXT DEFAULT ''")):
        try:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN {colonne}')
            conn.commit()
        except Exception:
            pass

    # Photos et notes vocales dans les messages prives
    for colonne in ('image TEXT', 'audio TEXT', 'duree INTEGER'):
        try:
            conn.execute('ALTER TABLE messages ADD COLUMN ' + colonne)
            conn.commit()
        except Exception:
            pass

    # Parametres : qui peut m'ecrire ('tous' / 'abonnes'), masquer le "Vu",
    # types de notifications coupes (liste separee par des virgules)
    for colonne in ("qui_peut_ecrire TEXT DEFAULT 'tous'", 'masquer_vu INTEGER DEFAULT 0', "notifs_coupees TEXT DEFAULT ''"):
        try:
            conn.execute('ALTER TABLE users ADD COLUMN ' + colonne)
            conn.commit()
        except Exception:
            pass

    # Parrainage : qui m'a invite, et mon code d'invitation
    for colonne in ('parrain_id INTEGER', 'code_invitation TEXT'):
        try:
            conn.execute('ALTER TABLE users ADD COLUMN ' + colonne)
            conn.commit()
        except Exception:
            pass

    # Profil riche : couverture, competences et parcours (JSON), liens, visites masquees
    for colonne in ('couverture TEXT', "competences TEXT DEFAULT ''", "parcours TEXT DEFAULT ''",
                    "lien_linkedin TEXT DEFAULT ''", "lien_github TEXT DEFAULT ''", "lien_site TEXT DEFAULT ''",
                    'masquer_visites INTEGER DEFAULT 0'):
        try:
            conn.execute('ALTER TABLE users ADD COLUMN ' + colonne)
            conn.commit()
        except Exception:
            pass

    # Verification de l'e-mail : DEFAULT 1 pour que les comptes existants restent
    # actifs ; les nouvelles inscriptions sont creees avec email_verifie = 0.
    try:
        conn.execute('ALTER TABLE users ADD COLUMN email_verifie INTEGER DEFAULT 1')
        conn.commit()
    except Exception:
        pass
    for requete in (
        '''CREATE TABLE IF NOT EXISTS codes_verification (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            expire TEXT NOT NULL,
            essais INTEGER DEFAULT 0)''',
        # Signalements de publications (un par etudiant et par publication)
        '''CREATE TABLE IF NOT EXISTS signalements_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            motif TEXT,
            date_signalement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (post_id, user_id))''',
        # Stages, emplois, jobs etudiants, alternances
        '''CREATE TABLE IF NOT EXISTS opportunites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            titre TEXT NOT NULL,
            entreprise TEXT NOT NULL,
            ville TEXT DEFAULT '',
            domaine TEXT DEFAULT '',
            description TEXT DEFAULT '',
            lien TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            date_limite TEXT DEFAULT '',
            valide INTEGER DEFAULT 1,
            date_publication TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        # Petites annonces entre etudiants (prix en FCFA, 0 = gratuit)
        '''CREATE TABLE IF NOT EXISTS annonces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            categorie TEXT NOT NULL,
            titre TEXT NOT NULL,
            description TEXT DEFAULT '',
            prix INTEGER DEFAULT 0,
            ville TEXT DEFAULT '',
            image TEXT,
            vendu INTEGER DEFAULT 0,
            date_publication TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        # Reactions (en plus du coeur des likes) : une par etudiant et par publication
        '''CREATE TABLE IF NOT EXISTS reactions (
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY (post_id, user_id))''',
        # Sondage attache a une publication (2 a 4 choix) et votes (un par etudiant)
        '''CREATE TABLE IF NOT EXISTS post_sondage_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            texte TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS post_sondage_votes (
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            option_id INTEGER NOT NULL,
            PRIMARY KEY (post_id, user_id))''',
        # Stories : photo (et texte court) visibles 24 h
        '''CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            image TEXT NOT NULL,
            texte TEXT DEFAULT '',
            date_creation TEXT NOT NULL)''',
        # Entraide : questions par matiere, reponses, votes sur les reponses
        '''CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            matiere TEXT NOT NULL,
            titre TEXT NOT NULL,
            contenu TEXT DEFAULT '',
            image TEXT,
            meilleure_reponse_id INTEGER,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        '''CREATE TABLE IF NOT EXISTS reponses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            contenu TEXT NOT NULL,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        '''CREATE TABLE IF NOT EXISTS votes_reponses (
            reponse_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY (reponse_id, user_id))''',
        # "Effacer la discussion" : cache les messages anterieurs, pour moi seulement
        '''CREATE TABLE IF NOT EXISTS conversations_effacees (
            user_id INTEGER NOT NULL,
            autre_id INTEGER NOT NULL,
            date_effacement TEXT NOT NULL,
            PRIMARY KEY (user_id, autre_id))''',
        # Journal des erreurs serveur (visible dans le tableau de bord admin)
        '''CREATE TABLE IF NOT EXISTS erreurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route TEXT,
            message TEXT,
            detail TEXT,
            date_erreur TEXT NOT NULL)''',
        # Qui a vu mon profil (derniere visite par visiteur)
        '''CREATE TABLE IF NOT EXISTS vues_profil (
            profil_id INTEGER NOT NULL,
            visiteur_id INTEGER NOT NULL,
            date_vue TEXT NOT NULL,
            PRIMARY KEY (profil_id, visiteur_id))''',
        # Emploi du temps personnel (jour : 1 = lundi ... 7 = dimanche) et examens
        '''CREATE TABLE IF NOT EXISTS cours (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            jour INTEGER NOT NULL,
            debut TEXT NOT NULL,
            fin TEXT NOT NULL,
            matiere TEXT NOT NULL,
            salle TEXT DEFAULT '',
            enseignant TEXT DEFAULT '')''',
        '''CREATE TABLE IF NOT EXISTS examens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            matiere TEXT NOT NULL,
            date_examen TEXT NOT NULL,
            heure TEXT DEFAULT '',
            salle TEXT DEFAULT '',
            note TEXT DEFAULT '')''',
        # Blocages : bloqueur ne voit plus les publications de bloque, et plus
        # aucun message ne passe entre eux
        '''CREATE TABLE IF NOT EXISTS blocages (
            bloqueur_id INTEGER NOT NULL,
            bloque_id INTEGER NOT NULL,
            date_blocage TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (bloqueur_id, bloque_id))''',
    ):
        conn.execute(requete)
    conn.commit()
    # Index : recherches rapides sur les colonnes les plus consultees (fil, messages, notifications...)
    for index in ('posts(date_post)', 'posts(user_id)', 'likes(post_id)', 'likes(user_id, post_id)', 'commentaires(post_id)',
                  'messages(expediteur_id, destinataire_id)', 'messages(destinataire_id, lu)', 'notifications(user_id, lu)',
                  'follows(follower_id, followed_id)', 'follows(followed_id)', 'groupe_membres(groupe_id, user_id)',
                  'groupe_messages(groupe_id)', 'reactions(post_id)', 'post_sondage_options(post_id)', 'post_sondage_votes(option_id)',
                  'stories(date_creation)', 'reponses(question_id)', 'votes_reponses(reponse_id)', 'annonces(date_publication)',
                  'opportunites(valide, date_publication)', 'blocages(bloque_id)', 'expo_push_tokens(user_id)', 'vues_profil(profil_id, date_vue)',
                  'signalements_posts(post_id)', 'cours(user_id)', 'examens(user_id)', 'users(parrain_id)', 'users(code_invitation)'):
        nom = 'idx_' + index.replace('(', '_').replace(', ', '_').replace(')', '')
        try:
            conn.execute(f'CREATE INDEX IF NOT EXISTS {nom} ON {index}')
            conn.commit()
        except Exception:
            pass  # table absente (ancienne base) : sans consequence


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
    ('Ambassadeur', 'A invite 3 camarades sur LinkCI', '🎟️', 'filleuls', 3),
]

def seed_badges():
    conn = get_db()
    for b in BADGES:  # ajoute les badges manquants (nouveaux badges compris)
        if not conn.execute('SELECT 1 FROM badges WHERE nom = ?', (b[0],)).fetchone():
            try:
                conn.execute('INSERT INTO badges (nom, description, icone, critere_type, critere_seuil) VALUES (?, ?, ?, ?, ?)', b)
            except Exception:
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
    stats['filleuls'] = conn.execute('SELECT COUNT(*) as nb FROM users WHERE parrain_id = ? AND COALESCE(email_verifie, 1) = 1',
                                     (user_id,)).fetchone()['nb']

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
    nb_formations = conn.execute('SELECT COUNT(*) as nb FROM formations WHERE COALESCE(valide, 1) = 1').fetchone()['nb']
    conn.close()
    return render_template('index.html', nb_users=nb_users, nb_posts=nb_posts, nb_formations=nb_formations)

# ---- Parrainage
def code_invitation(user_id):
    """Code personnel (7 caracteres), cree a la premiere demande."""
    conn = get_db()
    u = conn.execute('SELECT code_invitation FROM users WHERE id = ?', (user_id,)).fetchone()
    code = u['code_invitation'] if u else None
    while not code:
        essai = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(7))
        if not conn.execute('SELECT 1 FROM users WHERE code_invitation = ?', (essai,)).fetchone():
            conn.execute('UPDATE users SET code_invitation = ? WHERE id = ?', (essai, user_id))
            conn.commit()
            code = essai
    conn.close()
    return code

def noter_parrain(user_id, code):
    """A l'inscription : retient le parrain si le code est valide."""
    code = re.sub(r'[^A-Za-z0-9]', '', str(code or ''))[:12].upper()
    if not code:
        return
    conn = get_db()
    p = conn.execute('SELECT id FROM users WHERE code_invitation = ? AND id != ?', (code, user_id)).fetchone()
    if p:
        conn.execute('UPDATE users SET parrain_id = ? WHERE id = ?', (p['id'], user_id))
        conn.commit()
    conn.close()

def accueillir_filleul(user_id):
    """Compte actif (e-mail verifie) : parrain et filleul se suivent, le parrain est prevenu."""
    conn = get_db()
    u = conn.execute('SELECT prenom, nom, parrain_id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not u or not u['parrain_id']:
        conn.close()
        return
    p = u['parrain_id']
    for a, b in ((user_id, p), (p, user_id)):
        if not conn.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (a, b)).fetchone():
            conn.execute('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)', (a, b))
    conn.commit()
    conn.close()
    creer_notification(p, 'suivi', f"{u['prenom']} {u['nom']} a rejoint LinkCI grace a toi 🎉", f'/profil/{user_id}')
    check_and_award_badges(p)

# ---- Verification de l'adresse e-mail (code a 6 chiffres)
CODE_VALIDITE_MIN = 15
CODE_ESSAIS_MAX = 5

def verification_active():
    return app.config.get('VERIFIER_EMAIL', True)  # desactivable pour les anciens tests

def envoyer_code_verification(user_id, email, prenom=''):
    """Remplace le code precedent et l'envoie par e-mail. Limite les envois."""
    if not check_rate_limit(f'code_verif:{user_id}', max_reqs=3, window=900):
        return False
    code = f'{secrets.randbelow(10 ** 6):06d}'
    expire = (datetime.now(timezone.utc) + timedelta(minutes=CODE_VALIDITE_MIN)).strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    conn.execute('DELETE FROM codes_verification WHERE user_id = ?', (user_id,))
    conn.execute('INSERT INTO codes_verification (user_id, code, expire) VALUES (?, ?, ?)',
                 (user_id, _hash_jeton(code), expire))
    conn.commit()
    conn.close()
    return envoyer_email(email, f'{code} est ton code LINK CI',
                         f"Bonjour {prenom},\n\nTon code de verification LINK CI : {code}\n\n"
                         f"Il expire dans {CODE_VALIDITE_MIN} minutes. Si tu n'as pas cree de compte, "
                         "ignore cet e-mail.\n\nL'equipe LINK CI")

def verifier_code_email(email, code):
    """Renvoie (user, None) si le code est bon (le compte devient verifie),
    sinon (None, message d'erreur)."""
    email = normaliser_email(email)
    code = re.sub(r'\D', '', str(code or ''))
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE lower(email) = ?', (email,)).fetchone()
    if not user or user['email_verifie']:
        conn.close()
        # jamais de connexion sans mot de passe pour un compte deja verifie
        return None, 'Code invalide. Si ton compte est deja verifie, connecte-toi.'
    rc = conn.execute('SELECT * FROM codes_verification WHERE user_id = ?', (user['id'],)).fetchone()
    maintenant = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    if not rc or rc['expire'] < maintenant or (rc['essais'] or 0) >= CODE_ESSAIS_MAX:
        conn.close()
        return None, 'Code expire. Demande un nouveau code.'
    if not secrets.compare_digest(rc['code'], _hash_jeton(code)):
        conn.execute('UPDATE codes_verification SET essais = COALESCE(essais, 0) + 1 WHERE id = ?', (rc['id'],))
        conn.commit()
        conn.close()
        return None, 'Code incorrect.'
    conn.execute('UPDATE users SET email_verifie = 1 WHERE id = ?', (user['id'],))
    conn.execute('DELETE FROM codes_verification WHERE user_id = ?', (user['id'],))
    conn.commit()
    conn.close()
    accueillir_filleul(user['id'])
    return user, None

def ouvrir_session(user):
    session.clear()  # nouvelle session (evite la fixation de session)
    session.permanent = True
    session['user_id'] = user['id']
    session['user_nom'] = user['prenom'] + ' ' + user['nom']
    session['user_email'] = user['email']
    session['v'] = user['jeton_version'] or 0

# ---- Qui peut ecrire a qui (blocages + reglage "seulement les personnes que je suis")
def peut_ecrire(expediteur_id, destinataire_id):
    if blocage_entre(expediteur_id, destinataire_id):
        return False
    conn = get_db()
    dest = conn.execute('SELECT qui_peut_ecrire FROM users WHERE id = ?', (destinataire_id,)).fetchone()
    ok = True
    if dest and (dest['qui_peut_ecrire'] or 'tous') == 'abonnes':
        exp = conn.execute('SELECT * FROM users WHERE id = ?', (expediteur_id,)).fetchone()
        ok = (est_admin(exp)
              or bool(conn.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (destinataire_id, expediteur_id)).fetchone())
              # il m'a deja ecrit : je peux lui repondre
              or bool(conn.execute('SELECT 1 FROM messages WHERE expediteur_id = ? AND destinataire_id = ?', (destinataire_id, expediteur_id)).fetchone()))
    conn.close()
    return ok

# ---- Blocages entre etudiants
def blocage_entre(a, b):
    conn = get_db()
    r = conn.execute('SELECT 1 FROM blocages WHERE (bloqueur_id = ? AND bloque_id = ?) OR (bloqueur_id = ? AND bloque_id = ?)',
                     (a, b, b, a)).fetchone()
    conn.close()
    return bool(r)

def changer_blocage(moi, autre, bloquer):
    conn = get_db()
    if bloquer:
        if not conn.execute('SELECT 1 FROM blocages WHERE bloqueur_id = ? AND bloque_id = ?', (moi, autre)).fetchone():
            conn.execute('INSERT INTO blocages (bloqueur_id, bloque_id) VALUES (?, ?)', (moi, autre))
        # plus d'abonnement dans un sens ni dans l'autre
        conn.execute('DELETE FROM follows WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)',
                     (moi, autre, autre, moi))
    else:
        conn.execute('DELETE FROM blocages WHERE bloqueur_id = ? AND bloque_id = ?', (moi, autre))
    conn.commit()
    conn.close()

def signaler_publication(post_id, user_id, motif):
    """Renvoie un message d'erreur, ou None si le signalement est enregistre."""
    motif = sanitize_text(motif or '', 300)
    conn = get_db()
    post = conn.execute('SELECT id, user_id, contenu FROM posts WHERE id = ?', (post_id,)).fetchone()
    if not post:
        conn.close()
        return 'Publication introuvable'
    if post['user_id'] == user_id:
        conn.close()
        return 'Tu ne peux pas signaler ta propre publication'
    if trop_rapide('signalement', user_id, 10, 3600):
        conn.close()
        return 'Trop de signalements. Reessaie plus tard.'
    if not conn.execute('SELECT 1 FROM signalements_posts WHERE post_id = ? AND user_id = ?', (post_id, user_id)).fetchone():
        conn.execute('INSERT INTO signalements_posts (post_id, user_id, motif) VALUES (?, ?, ?)', (post_id, user_id, motif))
        conn.commit()
        conn.close()
        extrait = (post['contenu'] or '')[:60]
        prevenir_admins('signalement', f'Publication signalee : {extrait}')
    else:
        conn.close()
    return None

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
            user_id = conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee, email_verifie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                   (nom, prenom, email, mot_de_passe, universite, filiere, annee, 0 if verification_active() else 1)).lastrowid
            conn.commit()
            noter_parrain(user_id, request.form.get('invitation'))
            if not verification_active():
                accueillir_filleul(user_id)
                flash('Compte cree ! Connecte-toi.', 'success')
                return redirect(url_for('connexion'))
            envoyer_code_verification(user_id, email, prenom)
            session['a_verifier'] = email
            flash(f'Compte cree ! Entre le code envoye a {email}.', 'success')
            return redirect(url_for('verifier_email'))
        except db.IntegrityError:
            flash('Cet email est deja utilise.', 'error')
            return render_template('inscription.html', invitation=request.form.get('invitation', ''))
        finally:
            conn.close()
    return render_template('inscription.html', invitation=request.args.get('invite', ''))

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
        if not user:
            check_password(request.form.get('mot_de_passe', ''), None)
        elif not check_password(request.form.get('mot_de_passe', ''), user['mot_de_passe']):
            user = None
        elif user and not user['mot_de_passe'].startswith('$2'):
            nouveau = hash_password(request.form['mot_de_passe'])
            conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
            conn.commit()
        conn.close()

        if user and user['banni']:
            flash('Votre compte a ete suspendu. Contactez l\'administration.', 'error')
            return render_template('connexion.html')
        if user and not user['email_verifie']:
            envoyer_code_verification(user['id'], user['email'], user['prenom'])
            session['a_verifier'] = user['email']
            flash(f"Verifie d'abord ton adresse : un code a ete envoye a {user['email']}.", 'info')
            return redirect(url_for('verifier_email'))
        if user:
            ouvrir_session(user)
            flash('Connecte !', 'success')
            suivant = request.form.get('suivant') or request.args.get('suivant') or ''
            # chemin interne strict : pas de '//' ni de caracteres invisibles (que les navigateurs suppriment)
            if re.fullmatch(r'/[A-Za-z0-9_\-./?=&%#]*', suivant) and '//' not in suivant:
                return redirect(suivant)
            return redirect(url_for('feed'))
        else:
            flash('Email ou mot de passe incorrect.', 'error')
            return render_template('connexion.html')
    return render_template('connexion.html')

@app.route('/verifier_email', methods=['GET', 'POST'])
def verifier_email():
    email = session.get('a_verifier', '')
    if not email:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        ip = request.remote_addr or 'unknown'
        if request.form.get('action') == 'renvoyer':
            conn = get_db()
            user = conn.execute('SELECT id, email, prenom, email_verifie FROM users WHERE lower(email) = ?', (email,)).fetchone()
            conn.close()
            if user and not user['email_verifie'] and envoyer_code_verification(user['id'], user['email'], user['prenom']):
                flash('Nouveau code envoye.', 'success')
            else:
                flash("Patiente quelques minutes avant de redemander un code.", 'error')
            return redirect(url_for('verifier_email'))
        if not check_rate_limit(f'verif_code:{ip}', max_reqs=10, window=900):
            flash('Trop de tentatives. Reessaie dans 15 minutes.', 'error')
            return redirect(url_for('verifier_email'))
        user, erreur = verifier_code_email(email, request.form.get('code', ''))
        if erreur:
            flash(erreur, 'error')
            return redirect(url_for('verifier_email'))
        ouvrir_session(user)
        flash('Adresse verifiee, bienvenue sur LINK CI !', 'success')
        return redirect(url_for('feed'))
    return render_template('verifier_email.html', email=email)

@app.route('/signaler_post/<int:post_id>', methods=['POST'])
def signaler_post_web(post_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    erreur = signaler_publication(post_id, session['user_id'], request.form.get('motif', ''))
    flash(erreur or 'Merci, un administrateur va examiner cette publication.', 'error' if erreur else 'success')
    return redirection_sure(request.referrer, url_for('feed'))

@app.route('/bloquer/<int:autre_id>', methods=['POST'])
def bloquer_web(autre_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if autre_id != session['user_id']:
        bloquer = request.form.get('action') != 'debloquer'
        changer_blocage(session['user_id'], autre_id, bloquer)
        flash('Utilisateur bloque.' if bloquer else 'Utilisateur debloque.', 'success')
    return redirect(url_for('profil', user_id=autre_id))

def page_app(gabarit, **extra):
    if 'user_id' not in session:
        return redirect(url_for('connexion', suivant=request.path))
    return render_template(gabarit, **extra)

@app.route('/fil')
def fil_moderne():
    return page_app('fil.html')

@app.route('/entraide')
def entraide_web():
    return page_app('entraide.html')

@app.route('/entraide/<int:qid>')
def question_web(qid):
    return page_app('question.html', qid=qid)

@app.route('/parametres')
def parametres_web():
    return page_app('parametres.html')

@app.route('/emploi-du-temps')
def emploi_du_temps_web():
    return page_app('emploi_du_temps.html')

@app.route('/decouvrir')
def decouvrir_web():
    return page_app('decouvrir.html', q=request.args.get('q', ''))

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
    """Envoie un e-mail. Renvoie True si le service l'a accepte.
    1. Brevo (API web) si BREVO_API_KEY est defini : fonctionne sur Render gratuit,
       qui bloque les ports SMTP. EMAIL_EXPEDITEUR = adresse validee dans Brevo.
    2. Sinon SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS...), pratique en local.
    0. Avant tout : le script Google (GMAIL_SCRIPT_URL + GMAIL_SCRIPT_SECRET), qui
       envoie depuis le Gmail de l'administrateur (outils/gmail_relais.gs)."""
    url_script = os.environ.get('GMAIL_SCRIPT_URL', '').strip()
    secret_script = os.environ.get('GMAIL_SCRIPT_SECRET', '').strip()
    if url_script and secret_script:
        try:
            import requests as http_req
            # Google repond par une redirection vers le resultat (suivie en GET)
            r = http_req.post(url_script, timeout=20, json={
                'secret': secret_script, 'to': destinataire, 'subject': sujet, 'text': texte})
            if r.status_code == 200 and r.text.strip().startswith('{') and r.json().get('ok'):
                return True
            app.logger.error("Le script Gmail a refuse l'email (%s) : %s", r.status_code, r.text[:300])
        except Exception as e:
            app.logger.error("Echec d'envoi via le script Gmail : %s", e)
        return False

    cle_brevo = os.environ.get('BREVO_API_KEY', '').strip()
    if cle_brevo:
        expediteur = os.environ.get('EMAIL_EXPEDITEUR', '').strip()
        if not expediteur:
            app.logger.error('EMAIL_EXPEDITEUR manquant : email non envoye (%s)', sujet)
            return False
        try:
            import requests as http_req
            r = http_req.post('https://api.brevo.com/v3/smtp/email', timeout=15,
                              headers={'api-key': cle_brevo, 'accept': 'application/json'},
                              json={'sender': {'name': 'LINK CI', 'email': expediteur},
                                    'to': [{'email': destinataire}], 'subject': sujet, 'textContent': texte})
            if r.status_code in (200, 201, 202):
                return True
            app.logger.error("Brevo a refuse l'email (%s) : %s", r.status_code, r.text[:300])
        except Exception as e:
            app.logger.error("Echec d'envoi via Brevo : %s", e)
        return False

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
    # l'ancien fil est remplace par le fil moderne (stories, reactions, sondages...)
    return page_app('fil.html')

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
    if contenu and trop_rapide('commentaire', session['user_id'], 20, 60):
        flash('Tu commentes trop vite. Patiente un peu.', 'error')
        return redirect(url_for('feed'))
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
    est_bloque = bool(conn.execute('SELECT 1 FROM blocages WHERE bloqueur_id = ? AND bloque_id = ?',
                                   (session['user_id'], user_id)).fetchone())
    if user:
        noter_visite(conn, user_id, session['user_id'])
    conn.close()
    return render_template('profil.html', user=user, posts=posts, nb_posts=nb_posts, nb_likes_recus=nb_likes_recus, nb_commentaires_recus=nb_commentaires_recus, nb_bourses=nb_bourses, nb_docs=nb_docs, badges=badges, est_abonne=est_abonne, nb_abonnes=nb_abonnes, nb_abonnements=nb_abonnements, est_bloque=est_bloque,
                           competences=liste_json(user['competences']) if user else [], parcours=liste_json(user['parcours']) if user else [])

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
            (SELECT CASE WHEN contenu = '' AND audio IS NOT NULL THEN 'Note vocale' WHEN contenu = '' AND image IS NOT NULL THEN 'Photo' ELSE contenu END FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
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
    if contenu and (trop_rapide('message', session['user_id'], 30, 60) or destinataire_id == session['user_id']
                    or not peut_ecrire(session['user_id'], destinataire_id)):
        flash("Message non envoye (trop de messages, ou destinataire invalide).", 'error')
        return redirect(url_for('conversation', autre_id=destinataire_id))
    if contenu:
        conn = get_db()
        if not conn.execute('SELECT 1 FROM users WHERE id = ?', (destinataire_id,)).fetchone():
            conn.close()
            flash('Destinataire introuvable', 'error')
            return redirect(url_for('messagerie'))
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
            (SELECT CASE WHEN contenu = '' AND audio IS NOT NULL THEN 'Note vocale' WHEN contenu = '' AND image IS NOT NULL THEN 'Photo' ELSE contenu END FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
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
@app.route('/api/expo_push_token', methods=['POST', 'DELETE'])
def api_expo_push_token():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('token'):
        return jsonify({'error': 'Token requis'}), 400
    jeton = str(data['token'])[:200]
    if not jeton.startswith('ExponentPushToken['):
        return jsonify({'error': 'Token invalide'}), 400
    conn = get_db()
    if request.method == 'DELETE':  # deconnexion : ce telephone ne recoit plus rien
        conn.execute('DELETE FROM expo_push_tokens WHERE token = ? AND user_id = ?', (jeton, user_id))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Token supprime'})
    # un telephone partage passe au dernier compte connecte
    conn.execute('DELETE FROM expo_push_tokens WHERE token = ? AND user_id != ?', (jeton, user_id))
    conn.execute('INSERT OR IGNORE INTO expo_push_tokens (user_id, token) VALUES (?, ?)', (user_id, jeton))
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
            # profil riche : competences (virgules), parcours (une ligne 'titre | lieu | periode'), liens, couverture
            riches, erreur = lire_profil_riche({
                'competences': [c.strip() for c in request.form.get('competences', '').split(',')],
                'parcours': [dict(zip(('titre', 'lieu', 'periode'), [x.strip() for x in l.split('|')]))
                             for l in request.form.get('parcours', '').splitlines() if l.strip()],
                'lien_linkedin': request.form.get('lien_linkedin', ''), 'lien_github': request.form.get('lien_github', ''),
                'lien_site': request.form.get('lien_site', '')})
            couv = request.files.get('couverture')
            if not erreur and couv and couv.filename:
                data_couv = couv.read()
                ext_couv = extension_image(data_couv)
                if not ext_couv:
                    erreur = 'Photo de couverture invalide'
                else:
                    ancienne = conn.execute('SELECT couverture FROM users WHERE id = ?', (session['user_id'],)).fetchone()['couverture']
                    riches['couverture'] = f'{uuid.uuid4().hex}{ext_couv}'
                    stocker_fichier('static/uploads/' + riches['couverture'], data_couv)
                    if ancienne:
                        supprimer_fichier('static/uploads/' + ancienne)
            if erreur:
                flash(erreur, 'error')
            else:
                for cle, valeur in riches.items():  # cles validees par lire_profil_riche
                    conn.execute(f'UPDATE users SET {cle} = ? WHERE id = ?', (valeur, session['user_id']))
            conn.commit()
            session['user_nom'] = prenom + ' ' + nom
            if not erreur:
                flash('Profil mis a jour', 'success')
        else:
            flash('Prenom et nom requis', 'error')
    user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
    conn.close()
    return render_template('modifier_profil.html', user=user, competences=', '.join(liste_json(user['competences'])),
                           parcours='\n'.join(' | '.join(filter(None, (e.get('titre'), e.get('lieu'), e.get('periode'))))
                                              for e in liste_json(user['parcours'])))

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
        fichier = request.files.get('fichier')
        if not fichier or fichier.filename == '':
            flash('Titre et fichier requis', 'error')
            return redirect(url_for('ajouter_document'))
        _, erreur = enregistrer_document(session['user_id'], request.form.get('titre', ''), request.form.get('description', ''),
                                         request.form.get('matiere', ''), request.form.get('universite', ''),
                                         fichier.filename, fichier.read())
        if erreur:
            flash(erreur, 'error')
            return redirect(url_for('ajouter_document'))
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
    # remplacee par la recherche globale de /decouvrir
    return redirect(url_for('decouvrir_web', q=request.args.get('q', '')))
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
                WHERE bourses.COALESCE(valide, 1) = 1 AND bourses_fts MATCH ? ORDER BY rank LIMIT 10
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['bourses'] = [dict(r) for r in conn.execute('''
                SELECT id, titre, organisme, type FROM bourses
                WHERE COALESCE(valide, 1) = 1 AND (titre LIKE ? OR description LIKE ? OR organisme LIKE ?)
                ORDER BY date_publication DESC LIMIT 10
            ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
        try:
            safe = q.replace("'", "''")
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT formations.id, nom, universite, niveau FROM formations_fts JOIN formations ON formations_fts.rowid = formations.id
                WHERE formations.COALESCE(valide, 1) = 1 AND formations_fts MATCH ? ORDER BY rank LIMIT 10
            ''', (safe,)).fetchall()]
        except Exception:
            resultats['formations'] = [dict(r) for r in conn.execute('''
                SELECT id, nom, universite, niveau FROM formations
                WHERE COALESCE(valide, 1) = 1 AND (nom LIKE ? OR description LIKE ? OR universite LIKE ?)
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
    """Recherche dans tout LinkCI (LIKE insensible a la casse, sans les comptes bloques ou bannis)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    q = request.args.get('q', '').strip().lower()[:100]
    vide = {k: [] for k in ('users', 'posts', 'questions', 'annonces', 'offres', 'bourses', 'formations', 'groupes', 'documents')}
    if len(q) < 2:
        return jsonify(vide)
    motif = '%' + q.replace('%', '').replace('_', '') + '%'
    pas_bloque = lambda col: (f'{col} NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = {int(user_id)}) '
                              f'AND {col} NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = {int(user_id)})')
    conn = get_db()
    r = lambda sql_, *a: [dict(x) for x in conn.execute(sql_, a).fetchall()]
    res = {
        'users': r(f"""SELECT id, prenom, nom, filiere, universite, avatar FROM users
                      WHERE id != ? AND COALESCE(banni, 0) = 0 AND {pas_bloque('id')}
                        AND (lower(prenom || ' ' || nom) LIKE ? OR lower(nom || ' ' || prenom) LIKE ?
                             OR lower(COALESCE(filiere, '')) LIKE ? OR lower(COALESCE(universite, '')) LIKE ?)
                      ORDER BY prenom LIMIT 8""", user_id, motif, motif, motif, motif),
        'posts': r(f"""SELECT posts.id, posts.user_id, posts.contenu, posts.image, posts.date_post, users.prenom, users.nom, users.avatar
                      FROM posts JOIN users ON users.id = posts.user_id
                      WHERE lower(posts.contenu) LIKE ? AND COALESCE(users.banni, 0) = 0 AND {pas_bloque('posts.user_id')}
                      ORDER BY posts.date_post DESC LIMIT 6""", motif),
        'questions': r(f"""SELECT q.id, q.titre, q.matiere, (q.meilleure_reponse_id IS NOT NULL) AS resolue,
                             (SELECT COUNT(*) FROM reponses WHERE question_id = q.id) AS nb_reponses
                          FROM questions q WHERE (lower(q.titre) LIKE ? OR lower(q.contenu) LIKE ? OR lower(q.matiere) LIKE ?)
                            AND {pas_bloque('q.user_id')} ORDER BY q.date_creation DESC LIMIT 6""", motif, motif, motif),
        'annonces': r(f"""SELECT a.id, a.titre, a.prix, a.vendu, a.image, a.ville FROM annonces a
                         WHERE (lower(a.titre) LIKE ? OR lower(a.description) LIKE ?) AND {pas_bloque('a.user_id')}
                         ORDER BY a.vendu ASC, a.date_publication DESC LIMIT 6""", motif, motif),
        'offres': r("""SELECT id, titre, entreprise, type, ville FROM opportunites
                       WHERE valide = 1 AND (date_limite = '' OR date_limite >= ?)
                         AND (lower(titre) LIKE ? OR lower(entreprise) LIKE ? OR lower(domaine) LIKE ?)
                       ORDER BY date_publication DESC LIMIT 6""", date.today().isoformat(), motif, motif, motif),
        'bourses': r("""SELECT id, titre, organisme, type FROM bourses WHERE COALESCE(valide, 1) = 1
                        AND (lower(titre) LIKE ? OR lower(description) LIKE ? OR lower(organisme) LIKE ?) LIMIT 6""", motif, motif, motif),
        'formations': r("""SELECT id, nom, universite, niveau FROM formations WHERE COALESCE(valide, 1) = 1
                           AND (lower(nom) LIKE ? OR lower(universite) LIKE ? OR lower(description) LIKE ?) LIMIT 6""", motif, motif, motif),
        'groupes': r("""SELECT g.id, g.nom, g.description, (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id) AS nb_membres,
                          EXISTS(SELECT 1 FROM groupe_membres WHERE groupe_id = g.id AND user_id = ?) AS membre
                        FROM groupes g WHERE lower(g.nom) LIKE ? OR lower(g.description) LIKE ? LIMIT 6""", user_id, motif, motif),
        'documents': r("""SELECT id, titre, matiere FROM documents WHERE lower(titre) LIKE ? OR lower(COALESCE(matiere, '')) LIKE ?
                          ORDER BY date_upload DESC LIMIT 6""", motif, motif),
    }
    conn.close()
    return jsonify(res)

@app.route('/api/decouverte')
def api_decouverte():
    """Etudiants a suivre (meme filiere / universite), tendances (#hashtags, publications populaires)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    moi = conn.execute('SELECT universite, filiere FROM users WHERE id = ?', (user_id,)).fetchone()
    uni = (moi['universite'] or '').strip().lower() if moi else ''
    fil = (moi['filiere'] or '').strip().lower() if moi else ''
    candidats = conn.execute(f"""
        SELECT id, prenom, nom, filiere, universite, avatar,
               (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) AS activite
        FROM users WHERE id != ? AND COALESCE(banni, 0) = 0 AND COALESCE(email_verifie, 1) = 1
          AND id NOT IN (SELECT followed_id FROM follows WHERE follower_id = ?)
          AND id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
          AND id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)
        LIMIT 300""", (user_id, user_id, user_id, user_id)).fetchall()

    def proximite(u):
        return (2 if fil and fil == (u['filiere'] or '').strip().lower() else 0) + (1 if uni and uni == (u['universite'] or '').strip().lower() else 0)
    suggeres = sorted((dict(u) for u in candidats), key=lambda u: (-proximite(u), -u['activite'], u['prenom']))[:12]
    for u in suggeres:
        u['raison'] = ('Ta filiere' if proximite(u) >= 2 else 'Ton universite' if proximite(u) == 1 else 'Actif sur LinkCI')

    il_y_a_7j = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
    recents = conn.execute("""SELECT contenu FROM posts WHERE date_post >= ? ORDER BY date_post DESC LIMIT 300""", (il_y_a_7j,)).fetchall()
    populaires = conn.execute("""
        SELECT posts.id, posts.user_id, posts.contenu, posts.image, posts.date_post, users.prenom, users.nom, users.avatar,
               (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) + (SELECT COUNT(*) FROM reactions WHERE post_id = posts.id)
               + 2 * (SELECT COUNT(*) FROM commentaires WHERE post_id = posts.id) AS score
        FROM posts JOIN users ON users.id = posts.user_id
        WHERE posts.date_post >= ? AND COALESCE(users.banni, 0) = 0
          AND posts.user_id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
          AND posts.user_id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)
        ORDER BY score DESC, posts.date_post DESC LIMIT 5""", (il_y_a_7j, user_id, user_id)).fetchall()
    conn.close()
    compte = {}
    for p_ in recents:
        for tag in set(t.lower() for t in re.findall(r'#([\w-]{2,30})', p_['contenu'] or '', re.UNICODE)):
            compte[tag] = compte.get(tag, 0) + 1
    tendances = [{'tag': t, 'nb': n} for t, n in sorted(compte.items(), key=lambda x: (-x[1], x[0]))[:10]]
    return jsonify({'etudiants': suggeres, 'tendances': tendances,
                    'populaires': [dict(p_) for p_ in populaires if p_['score'] > 0]})

@app.route('/api/utilisateurs/<int:autre_id>/suivre', methods=['POST', 'DELETE'])
def api_suivre(autre_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if autre_id == user_id or blocage_entre(user_id, autre_id):
        return jsonify({'error': 'Impossible'}), 400
    conn = get_db()
    autre = conn.execute('SELECT prenom FROM users WHERE id = ?', (autre_id,)).fetchone()
    if not autre:
        conn.close()
        return jsonify({'error': 'Introuvable'}), 404
    deja = conn.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (user_id, autre_id)).fetchone()
    if request.method == 'POST' and not deja and trop_rapide('suivi', user_id, 60, 3600):  # pas de rafale de notifications
        conn.close()
        return jsonify({'error': "Tu suis trop de personnes d'un coup. Reessaie plus tard."}), 429
    if request.method == 'POST' and not deja:
        conn.execute('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)', (user_id, autre_id))
        moi = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
        conn.commit()
        conn.close()
        creer_notification(autre_id, 'suivi', f"{moi['prenom']} {moi['nom']} te suit", f'/profil/{user_id}')
        return jsonify({'suivi': True})
    if request.method == 'DELETE':
        conn.execute('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', (user_id, autre_id))
        conn.commit()
    conn.close()
    return jsonify({'suivi': request.method == 'POST'})

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

    toutes = conn.execute('SELECT * FROM bourses WHERE COALESCE(valide, 1) = 1 ORDER BY expiree ASC, date_publication DESC').fetchall()
    types = conn.execute('SELECT DISTINCT type FROM bourses WHERE COALESCE(valide, 1) = 1').fetchall()
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
        admin = admin_required()
        if not admin and trop_rapide('proposition', session['user_id'], 5, 3600):
            flash('Trop de propositions. Reessaie plus tard.', 'error')
            return redirect(url_for('bourses'))
        conn = get_db()
        conn.execute('INSERT INTO bourses (titre, organisme, description, montant, type, cible, deadline, lien, pays, valide) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (titre, organisme, description, montant, type_, cible, deadline, lien, pays, 1 if admin else 0))
        conn.commit()
        conn.close()
        if admin:
            notifier_tous('bourse', f"Nouvelle bourse : {titre}", "/bourses")
        else:
            prevenir_admins('bourse', f"Bourse proposee a valider : {titre}")
            flash('Merci ! Ta proposition sera publiee apres verification par un administrateur.', 'success')
        return redirect(url_for('bourses'))
    return render_template('ajouter_bourse.html')

@app.route('/bourses/supprimer/<int:id>', methods=['POST'])
def supprimer_bourse(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if not admin_required():
        flash('Seuls les administrateurs peuvent supprimer une bourse.', 'error')
        return redirect(url_for('bourses'))
    conn = get_db()
    conn.execute('DELETE FROM bourses WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect(url_for('bourses'))

@app.route('/bourses/signaler/<int:id>', methods=['POST'])
def signaler_bourse(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    # un admin la marque expiree ; un etudiant previent les admins (pas d'effet direct)
    conn = get_db()
    bourse = conn.execute('SELECT titre FROM bourses WHERE id = ?', (id,)).fetchone()
    if bourse and admin_required():
        conn.execute('UPDATE bourses SET expiree = 1 WHERE id = ?', (id,))
        conn.commit()
    elif bourse and not trop_rapide('signalement', session['user_id'], 10, 3600):
        for a in conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchall():
            creer_notification(a['id'], 'bourse', f"Bourse signalee comme expiree : {bourse['titre']}", '/bourses')
        flash('Merci ! Un administrateur va verifier cette bourse.', 'success')
    conn.close()
    return redirect(url_for('bourses'))

def diffuser_message(expediteur_id, destinataire_id, message_id, contenu, image=None, audio=None, duree=None):
    """Temps reel (app mobile) : previent l'expediteur et le destinataire d'un nouveau message prive.
    Evenement distinct de 'new_message' (utilise par la page web de conversation) pour eviter les doublons."""
    data = {'id': message_id, 'expediteur_id': int(expediteur_id), 'destinataire_id': int(destinataire_id),
            'contenu': contenu, 'image': image, 'audio': audio, 'duree': duree, 'date_envoi': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}
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

TITRES_PUSH = {
    'message': 'Nouveau message', 'like': "J'aime", 'commentaire': 'Nouveau commentaire',
    'mention': 'Tu es mentionne', 'suivi': 'Nouvel abonne', 'bourse': 'Nouvelle bourse',
    'document': 'Nouveau document', 'formation': 'Nouvelle formation', 'annonce': 'LinkCI',
    'opportunite': 'Nouvelle offre', 'entraide': 'Entraide', 'signalement': 'Signalement',
}

def _envoyer_push_expo(messages):
    """Envoie les notifications a l'API Expo (par lots de 100) et oublie les
    telephones qui ont desinstalle l'app. Appele dans un thread."""
    import requests as http_req
    for i in range(0, len(messages), 100):
        lot = messages[i:i + 100]
        try:
            r = http_req.post('https://exp.host/--/api/v2/push/send', json=lot, timeout=15,
                              headers={'Accept': 'application/json', 'Content-Type': 'application/json'})
            tickets = r.json().get('data', []) if r.ok else []
        except Exception as e:
            app.logger.error('Echec des notifications push : %s', e)
            continue
        morts = [m['to'] for m, t in zip(lot, tickets)
                 if isinstance(t, dict) and t.get('details', {}).get('error') == 'DeviceNotRegistered']
        if morts:
            conn = get_db()
            for jeton in morts:
                conn.execute('DELETE FROM expo_push_tokens WHERE token = ?', (jeton,))
            conn.commit()
            conn.close()

# Types de notification regroupes comme dans les Parametres de l'app
CATEGORIE_NOTIF = {'message': 'messages', 'like': 'reactions', 'commentaire': 'commentaires', 'mention': 'commentaires',
                   'suivi': 'abonnes', 'bourse': 'nouveautes', 'formation': 'nouveautes', 'document': 'nouveautes',
                   'opportunite': 'offres', 'entraide': 'entraide', 'annonce': 'annonces'}
CATEGORIES_NOTIF = ('messages', 'reactions', 'commentaires', 'abonnes', 'nouveautes', 'offres', 'entraide', 'annonces')

def envoyer_push(user_ids, type, message, lien=''):
    """Notification sur le telephone (meme app fermee) pour ces utilisateurs."""
    if app.config.get('TESTING') or not user_ids:
        return
    conn = get_db()
    marques = ','.join('?' * len(user_ids))
    jetons = conn.execute(f'SELECT user_id, token FROM expo_push_tokens WHERE user_id IN ({marques})',
                          tuple(user_ids)).fetchall()
    # types coupes par chaque etudiant dans ses parametres
    coupes = {u['id']: set(filter(None, (u['notifs_coupees'] or '').split(','))) for u in conn.execute(
        f'SELECT id, notifs_coupees FROM users WHERE id IN ({marques})', tuple(user_ids)).fetchall()}
    conn.close()
    categorie = CATEGORIE_NOTIF.get(type, type)
    jetons = [j for j in jetons if categorie not in coupes.get(j['user_id'], set())]
    messages = [{'to': j['token'], 'title': TITRES_PUSH.get(type, 'LINK CI'), 'body': message[:180],
                 'sound': 'default', 'channelId': 'default', 'data': {'type': type, 'lien': lien}}
                for j in jetons if str(j['token']).startswith('ExponentPushToken[')]
    if messages:
        threading.Thread(target=_envoyer_push_expo, args=(messages,), daemon=True).start()

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
    envoyer_push([user_id], type, message, lien)

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
    envoyer_push([u['id'] for u in users], type, message, lien)

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
    n = conn.execute('SELECT lien FROM notifications WHERE id = ? AND user_id = ?', (id, session['user_id'])).fetchone()
    conn.close()
    return redirection_sure(n['lien'] if n else None, url_for('notifications'))

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
    uvs = conn.execute('SELECT DISTINCT universite FROM formations WHERE COALESCE(valide, 1) = 1 ORDER BY universite').fetchall()
    niveau_filter = request.args.get('niveau', '')
    uni_filter = request.args.get('universite', '')
    query = 'SELECT * FROM formations'
    params = []
    clauses = ['COALESCE(valide, 1) = 1']
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
    niveaux = conn.execute('SELECT DISTINCT niveau FROM formations WHERE COALESCE(valide, 1) = 1 ORDER BY niveau').fetchall()
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
        admin = admin_required()
        if not admin and trop_rapide('proposition', session['user_id'], 5, 3600):
            flash('Trop de propositions. Reessaie plus tard.', 'error')
            return redirect(url_for('formations'))
        conn = get_db()
        conn.execute('INSERT INTO formations (nom, universite, niveau, description, duree, debouches, frais, site_web, valide) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (nom, universite, niveau, description, duree, debouches, frais, site_web, 1 if admin else 0))
        conn.commit()
        conn.close()
        if admin:
            notifier_tous('formation', 'Nouvelle formation disponible : ' + nom, '/formations')
        else:
            prevenir_admins('formation', f"Formation proposee a valider : {nom}")
            flash('Merci ! Ta proposition sera publiee apres verification par un administrateur.', 'success')
        return redirect(url_for('formations'))
    return render_template('ajouter_formation.html')

@app.route('/formations/<int:id>')
def detail_formation(id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    f = conn.execute('SELECT * FROM formations WHERE id = ? AND COALESCE(valide, 1) = 1', (id,)).fetchone()
    conn.close()
    if not f:
        return redirect(url_for('formations'))
    return render_template('detail_formation.html', formation=f)

@app.route('/formations/_seed')
def seed_formations():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if not admin_required():
        flash('Acces reserve', 'error')
        return redirect(url_for('formations'))
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
    ev = conn.execute('SELECT user_id FROM evenements WHERE id = ?', (id,)).fetchone()
    if ev and (ev['user_id'] == session['user_id'] or admin_required()):
        conn.execute('DELETE FROM evenements WHERE id = ?', (id,))
        conn.commit()
    else:
        flash("Tu ne peux supprimer que tes propres evenements.", 'error')
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
    if nom and trop_rapide('groupe', session['user_id'], 5, 3600):
        flash('Trop de groupes crees. Reessaie plus tard.', 'error')
        return redirect(url_for('groupes'))
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
    if contenu and trop_rapide('message', session['user_id'], 30, 60):
        flash("Tu envoies trop de messages. Patiente un peu.", 'error')
        return redirect(url_for('discussion_groupe', id=id))
    if contenu:
        conn = get_db()
        if not conn.execute('SELECT 1 FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, session['user_id'])).fetchone():
            conn.close()
            flash('Tu dois rejoindre ce groupe', 'error')
            return redirect(url_for('groupes'))
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
    derniers_inscrits = conn.execute('SELECT id, prenom, nom, email, universite, date_inscription, banni, role FROM users ORDER BY date_inscription DESC LIMIT 10').fetchall()
    derniers_posts = conn.execute('SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom FROM posts JOIN users ON posts.user_id = users.id ORDER BY posts.date_post DESC LIMIT 10').fetchall()
    bourses_attente = conn.execute('SELECT * FROM bourses WHERE valide = 0 ORDER BY date_publication DESC').fetchall()
    formations_attente = conn.execute('SELECT * FROM formations WHERE valide = 0 ORDER BY date_ajout DESC').fetchall()
    opportunites_attente = conn.execute('SELECT * FROM opportunites WHERE valide = 0 ORDER BY date_publication DESC').fetchall()
    posts_signales = conn.execute('''
        SELECT posts.id, posts.contenu, users.prenom, users.nom, COUNT(s.id) AS nb,
               MAX(s.motif) AS motif
        FROM signalements_posts s JOIN posts ON posts.id = s.post_id JOIN users ON users.id = posts.user_id
        GROUP BY posts.id, posts.contenu, users.prenom, users.nom ORDER BY nb DESC''').fetchall()
    conn.close()
    stats_jours = statistiques_admin()
    stats_jours['erreurs'] = erreurs_recentes(10)
    return render_template('admin.html', stats=stats, stats_jours=stats_jours, derniers_inscrits=derniers_inscrits, derniers_posts=derniers_posts,
                           bourses_attente=bourses_attente, formations_attente=formations_attente, posts_signales=posts_signales,
                           opportunites_attente=opportunites_attente)

@app.route('/admin/ignorer_signalement/<int:post_id>', methods=['POST'])
def admin_ignorer_signalement(post_id):
    if not admin_required():
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    conn = get_db()
    conn.execute('DELETE FROM signalements_posts WHERE post_id = ?', (post_id,))
    conn.commit()
    conn.close()
    flash('Signalement ignore', 'success')
    return redirect(url_for('admin_dashboard'))

def prevenir_admins(type, message):
    conn = get_db()
    admins = conn.execute("SELECT id FROM users WHERE role = 'admin'").fetchall()
    conn.close()
    for a in admins:
        creer_notification(a['id'], type, message, '/admin')

TABLES_MODERATION = {'bourse': 'bourses', 'formation': 'formations', 'opportunite': 'opportunites'}

def moderer(genre, id, decision):
    """Publie ou refuse une proposition. Renvoie le message a afficher, ou None si introuvable."""
    table = TABLES_MODERATION.get(genre)
    if not table or decision not in ('valider', 'refuser'):
        return None
    conn = get_db()
    ligne = conn.execute(f'SELECT * FROM {table} WHERE id = ? AND valide = 0', (id,)).fetchone()
    message = None
    if ligne and decision == 'valider':
        conn.execute(f'UPDATE {table} SET valide = 1 WHERE id = ?', (id,))
        conn.commit()
        if genre == 'opportunite':
            annoncer_opportunite(dict(ligne))
            message = 'Offre publiee et annoncee aux etudiants abonnes.'
        else:
            nom = ligne['titre'] if genre == 'bourse' else ligne['nom']
            notifier_tous(genre, ('Nouvelle bourse : ' if genre == 'bourse' else 'Nouvelle formation disponible : ') + nom, '/' + table)
            message = 'Publie et annonce a tous les etudiants.'
    elif ligne:
        conn.execute(f'DELETE FROM {table} WHERE id = ?', (id,))
        conn.commit()
        message = 'Proposition refusee.'
    conn.close()
    return message

@app.route('/admin/moderation/<genre>/<int:id>/<decision>', methods=['POST'])
def admin_moderation(genre, id, decision):
    if not admin_required():
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    message = moderer(genre, id, decision)
    if message:
        flash(message, 'success')
    return redirect(url_for('admin_dashboard'))

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
    utilisateurs = conn.execute('SELECT id, prenom, nom, email, universite, banni, role, date_inscription FROM users ORDER BY date_inscription DESC').fetchall()
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
    conn.execute('DELETE FROM signalements_posts WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    # Delete post image if any
    if post['image']:
        supprimer_fichier('static/uploads/' + post['image'])
    conn.commit()
    conn.close()
    flash('Publication supprimee', 'success')
    return redirection_sure(request.referrer, url_for('admin_dashboard'))

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
    if auth.startswith('Bearer '):
        return verifier_jeton_api(auth[7:])
    # Site web : la session du navigateur, seulement pour les appels fetch du
    # site lui-meme. Un autre site ne peut ni envoyer cet en-tete sans CORS
    # (non active), ni joindre le cookie SameSite=Lax a une requete POST.
    if request.headers.get('X-LinkCI') == 'web' and session.get('user_id'):
        return session['user_id']
    return None

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

CHAMPS_PUBLICS_USER = ('id, nom, prenom, universite, filiere, annee, bio, avatar, date_inscription, couverture, '
                       'competences, parcours, lien_linkedin, lien_github, lien_site')

def liste_json(texte):
    import json
    try:
        v = json.loads(texte or '[]')
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []

def profil_public(ligne):
    """Ligne users -> dict pour l'API (competences et parcours en listes)."""
    d = dict(ligne)
    for k in ('competences', 'parcours'):
        if k in d:
            d[k] = liste_json(d[k])
    return d

LIENS_PROFIL = {'lien_linkedin': r'^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/', 'lien_github': r'^https://(www\.)?github\.com/',
                'lien_site': r'^https://'}

def lire_profil_riche(data):
    """Valide competences, parcours et liens envoyes par l'app. Renvoie (champs, erreur)."""
    import json
    champs = {}
    if 'competences' in data:
        comp = data.get('competences') or []
        if not isinstance(comp, list):
            return None, 'Competences invalides'
        comp = list(dict.fromkeys(sanitize_text(str(c), 30) for c in comp if str(c).strip()))[:15]  # sans doublons, 15 max
        champs['competences'] = json.dumps(comp, ensure_ascii=False)
    if 'parcours' in data:
        par = data.get('parcours') or []
        if not isinstance(par, list):
            return None, 'Parcours invalide'
        propre = []
        for e in par[:10]:
            if isinstance(e, dict) and str(e.get('titre') or '').strip():
                propre.append({'titre': sanitize_text(str(e.get('titre')), 80), 'lieu': sanitize_text(str(e.get('lieu') or ''), 80),
                               'periode': sanitize_text(str(e.get('periode') or ''), 40)})
        champs['parcours'] = json.dumps(propre, ensure_ascii=False)
    for cle, motif in LIENS_PROFIL.items():
        if cle in data:
            lien = lien_sur(str(data.get(cle) or '').strip()[:200])
            if lien and not re.match(motif, lien, re.I):
                return None, {'lien_linkedin': 'Lien LinkedIn invalide (https://linkedin.com/...)',
                              'lien_github': 'Lien GitHub invalide (https://github.com/...)',
                              'lien_site': 'Le site doit commencer par https://'}[cle]
            champs[cle] = lien
    return champs, None

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
        user_id = conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee, email_verifie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                               (nom, prenom, email, hash_password(mot_de_passe),
                                sanitize_text(str(data.get('universite') or ''), 100), sanitize_text(str(data.get('filiere') or ''), 100),
                                sanitize_text(str(data.get('annee') or ''), 20), 0 if verification_active() else 1)).lastrowid
        conn.commit()
        noter_parrain(user_id, data.get('invitation'))
        if not verification_active():
            accueillir_filleul(user_id)
            user = conn.execute('SELECT id, nom, prenom, email, universite, filiere FROM users WHERE id = ?', (user_id,)).fetchone()
            conn.close()
            return jsonify({'token': api_token(user['id']), 'user': dict(user)}), 201
        conn.close()
        envoyer_code_verification(user_id, email, prenom)
        # pas de jeton tant que l'adresse n'est pas verifiee (POST /api/verifier_email)
        return jsonify({'a_verifier': True, 'email': email,
                        'message': f'Un code a 6 chiffres a ete envoye a {email}.'}), 201
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
    if not check_password(data.get('mot_de_passe', ''), user['mot_de_passe'] if user else None):
        conn.close()
        return jsonify({'error': 'Email ou mot de passe incorrect'}), 401
    if user['banni']:
        conn.close()
        return jsonify({'error': "Compte suspendu. Contacte l'administration."}), 403
    if not user['email_verifie']:
        conn.close()
        envoyer_code_verification(user['id'], user['email'], user['prenom'])
        return jsonify({'error': "Verifie d'abord ton adresse e-mail : un code vient de t'etre envoye.",
                        'a_verifier': True, 'email': user['email']}), 403
    if not user['mot_de_passe'].startswith('$2'):
        nouveau = hash_password(data.get('mot_de_passe', ''))
        conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
        conn.commit()
    conn.close()
    # jamais le hash du mot de passe ni les champs internes
    profil = {k: user[k] for k in ('id', 'nom', 'prenom', 'email', 'universite', 'filiere', 'annee', 'bio', 'avatar')}
    return jsonify({'token': api_token(user['id']), 'user': profil})

@app.route('/api/verifier_email', methods=['POST'])
def api_verifier_email():
    ip = request.remote_addr or 'unknown'
    if not check_rate_limit(f'verif_code:{ip}', max_reqs=10, window=900):
        return jsonify({'error': 'Trop de tentatives. Reessaie dans 15 minutes.'}), 429
    data = request.get_json(silent=True) or {}
    user, erreur = verifier_code_email(data.get('email', ''), data.get('code', ''))
    if erreur:
        return jsonify({'error': erreur}), 400
    profil = {k: user[k] for k in ('id', 'nom', 'prenom', 'email', 'universite', 'filiere', 'annee', 'bio', 'avatar')}
    return jsonify({'token': api_token(user['id']), 'user': profil})

@app.route('/api/renvoyer_code', methods=['POST'])
def api_renvoyer_code():
    ip = request.remote_addr or 'unknown'
    if not check_rate_limit(f'renvoi_code:{ip}', max_reqs=5, window=900):
        return jsonify({'error': 'Trop de demandes. Reessaie dans 15 minutes.'}), 429
    data = request.get_json(silent=True) or {}
    email = normaliser_email(data.get('email', ''))
    conn = get_db()
    user = conn.execute('SELECT id, email, prenom, email_verifie FROM users WHERE lower(email) = ?', (email,)).fetchone()
    conn.close()
    if user and not user['email_verifie']:
        envoyer_code_verification(user['id'], user['email'], user['prenom'])
    # meme reponse dans tous les cas : ne revele pas quels comptes existent
    return jsonify({'message': "Si un compte attend une verification, un nouveau code a ete envoye."})

@app.route('/api/posts/<int:post_id>/signaler', methods=['POST'])
def api_signaler_post(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.get_json(silent=True) or {}
    erreur = signaler_publication(post_id, user_id, data.get('motif', ''))
    if erreur:
        return jsonify({'error': erreur}), 404 if 'introuvable' in erreur else 400
    return jsonify({'message': 'Merci, un administrateur va examiner cette publication.'})

@app.route('/api/utilisateurs/<int:autre_id>/bloquer', methods=['POST', 'DELETE'])
def api_bloquer(autre_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if autre_id == user_id:
        return jsonify({'error': 'Impossible de te bloquer toi-meme'}), 400
    conn = get_db()
    existe = conn.execute('SELECT 1 FROM users WHERE id = ?', (autre_id,)).fetchone()
    conn.close()
    if not existe:
        return jsonify({'error': 'Introuvable'}), 404
    bloquer = request.method == 'POST'
    changer_blocage(user_id, autre_id, bloquer)
    return jsonify({'bloque': bloquer})

@app.route('/api/bloques')
def api_bloques():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    lignes = conn.execute('''SELECT users.id, users.prenom, users.nom, users.avatar FROM blocages
                             JOIN users ON users.id = blocages.bloque_id
                             WHERE blocages.bloqueur_id = ? ORDER BY blocages.date_blocage DESC''', (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(l) for l in lignes])

@app.route('/api/me')
def api_me():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    user = conn.execute(f'SELECT {CHAMPS_PUBLICS_USER}, email FROM users WHERE id = ?', (user_id,)).fetchone()
    badges = conn.execute('''
        SELECT b.* FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = ? ORDER BY ub.date_obtention DESC
    ''', (user_id,)).fetchall()
    conn.close()
    if not user:
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    result = profil_public(user)
    result['badges'] = [dict(b) for b in badges]
    result['est_admin'] = api_est_admin(user_id)
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
    # "Ma fac" : seulement les etudiants de la meme universite
    filtre_fac, params_fac = '', ()
    if request.args.get('fac') == '1':
        moi = conn.execute('SELECT universite FROM users WHERE id = ?', (user_id,)).fetchone()
        if moi and (moi['universite'] or '').strip():
            filtre_fac, params_fac = ' AND lower(users.universite) = ?', (moi['universite'].strip().lower(),)
    posts = conn.execute('''
        SELECT posts.id, posts.user_id, posts.contenu, posts.image, posts.date_post,
               users.prenom, users.nom, users.universite, users.avatar,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires,
               EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) as a_like,
               (posts.user_id = ?) as est_auteur
        FROM posts JOIN users ON posts.user_id = users.id
        WHERE posts.user_id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?) AND posts.user_id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)
        ''' + filtre_fac + '''
        ORDER BY posts.date_post DESC LIMIT ? OFFSET ?
    ''', (user_id, user_id, user_id, user_id) + params_fac + (per_page, offset)).fetchall()
    conn.close()
    return jsonify(enrichir_posts([dict(p) for p in posts], user_id))

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
    # Sondage facultatif : 2 a 4 choix non vides
    choix = data.get('sondage') or []
    if choix:
        if not isinstance(choix, list):
            return jsonify({'error': 'Sondage invalide'}), 400
        choix = [sanitize_text(str(c or ''), 80) for c in choix]
        choix = [c for c in choix if c]
        if not 2 <= len(choix) <= 4:
            return jsonify({'error': 'Un sondage a entre 2 et 4 choix'}), 400
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
    for c in choix:
        conn.execute('INSERT INTO post_sondage_options (post_id, texte) VALUES (?, ?)', (post_id, c))
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

# ===================== REACTIONS, SONDAGES, STORIES =====================
EMOJIS_REACTION = ('🔥', '😂', '👏', '😮', '😢')

def enrichir_posts(posts, user_id):
    """Ajoute a chaque publication : reactions {emoji: nombre}, ma_reaction, et le sondage."""
    if not posts:
        return posts
    ids = [p['id'] for p in posts]
    marques = ','.join('?' * len(ids))
    conn = get_db()
    reactions = conn.execute(f'SELECT post_id, emoji, COUNT(*) AS nb FROM reactions WHERE post_id IN ({marques}) GROUP BY post_id, emoji', ids).fetchall()
    miennes = conn.execute(f'SELECT post_id, emoji FROM reactions WHERE user_id = ? AND post_id IN ({marques})', [user_id] + ids).fetchall()
    options = conn.execute(f'''SELECT o.id, o.post_id, o.texte, (SELECT COUNT(*) FROM post_sondage_votes v WHERE v.option_id = o.id) AS votes
                               FROM post_sondage_options o WHERE o.post_id IN ({marques}) ORDER BY o.id''', ids).fetchall()
    votes = conn.execute(f'SELECT post_id, option_id FROM post_sondage_votes WHERE user_id = ? AND post_id IN ({marques})', [user_id] + ids).fetchall()
    conn.close()
    par_post = {p['id']: p for p in posts}
    for p in posts:
        p['reactions'], p['ma_reaction'], p['sondage'], p['mon_vote'] = {}, None, [], None
    for r in reactions:
        par_post[r['post_id']]['reactions'][r['emoji']] = r['nb']
    for r in miennes:
        par_post[r['post_id']]['ma_reaction'] = r['emoji']
    for o in options:
        par_post[o['post_id']]['sondage'].append({'id': o['id'], 'texte': o['texte'], 'votes': o['votes']})
    for v in votes:
        par_post[v['post_id']]['mon_vote'] = v['option_id']
    return posts

@app.route('/api/posts/<int:post_id>/reaction', methods=['POST'])
def api_reaction(post_id):
    """{"emoji": "🔥"} : ajoute ou remplace ma reaction ; la meme une 2e fois l'enleve."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    emoji = (request.get_json(silent=True) or {}).get('emoji')
    if emoji not in EMOJIS_REACTION:
        return jsonify({'error': 'Reaction invalide'}), 400
    conn = get_db()
    if not conn.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Publication introuvable'}), 404
    actuelle = conn.execute('SELECT emoji FROM reactions WHERE post_id = ? AND user_id = ?', (post_id, user_id)).fetchone()
    conn.execute('DELETE FROM reactions WHERE post_id = ? AND user_id = ?', (post_id, user_id))
    if not actuelle or actuelle['emoji'] != emoji:
        conn.execute('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)', (post_id, user_id, emoji))
    conn.commit()
    conn.close()
    return jsonify(enrichir_posts([{'id': post_id}], user_id)[0])

@app.route('/api/posts/<int:post_id>/vote', methods=['POST'])
def api_vote(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    try:
        option_id = int((request.get_json(silent=True) or {}).get('option_id'))
    except (TypeError, ValueError):
        return jsonify({'error': 'option_id requis'}), 400
    conn = get_db()
    if not conn.execute('SELECT 1 FROM post_sondage_options WHERE id = ? AND post_id = ?', (option_id, post_id)).fetchone():
        conn.close()
        return jsonify({'error': 'Choix invalide'}), 400
    conn.execute('DELETE FROM post_sondage_votes WHERE post_id = ? AND user_id = ?', (post_id, user_id))  # changer d'avis
    conn.execute('INSERT INTO post_sondage_votes (post_id, user_id, option_id) VALUES (?, ?, ?)', (post_id, user_id, option_id))
    conn.commit()
    conn.close()
    return jsonify(enrichir_posts([{'id': post_id}], user_id)[0])

STORY_DUREE_H = 24

def nettoyer_stories():
    """Supprime les stories de plus de 24 h (et leurs photos)."""
    limite = (datetime.now(timezone.utc) - timedelta(hours=STORY_DUREE_H)).strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    vieilles = conn.execute('SELECT id, image FROM stories WHERE date_creation < ?', (limite,)).fetchall()
    if vieilles:
        conn.execute('DELETE FROM stories WHERE date_creation < ?', (limite,))
        conn.commit()
    conn.close()
    for v in vieilles:
        supprimer_fichier('static/uploads/' + v['image'])

@app.route('/api/stories')
def api_stories():
    """Stories des dernieres 24 h, regroupees par etudiant (les miennes d'abord)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    nettoyer_stories()
    conn = get_db()
    lignes = conn.execute('''
        SELECT s.id, s.user_id, s.image, s.texte, s.date_creation, users.prenom, users.nom, users.avatar
        FROM stories s JOIN users ON users.id = s.user_id
        WHERE COALESCE(users.banni, 0) = 0
          AND s.user_id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
          AND s.user_id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)
        ORDER BY s.date_creation ASC''', (user_id, user_id)).fetchall()
    conn.close()
    groupes = {}
    for l in lignes:
        g = groupes.setdefault(l['user_id'], {'user_id': l['user_id'], 'prenom': l['prenom'], 'nom': l['nom'],
                                              'avatar': l['avatar'], 'est_moi': l['user_id'] == user_id, 'stories': []})
        g['stories'].append({'id': l['id'], 'image': l['image'], 'texte': l['texte'], 'date_creation': l['date_creation']})
    # les miennes d'abord, puis les plus recentes
    autres = sorted((g for g in groupes.values() if not g['est_moi']),
                    key=lambda g: g['stories'][-1]['date_creation'], reverse=True)
    return jsonify([g for g in groupes.values() if g['est_moi']] + autres)

@app.route('/api/stories', methods=['POST'])
def api_creer_story():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('story', user_id, 10, 3600):
        return jsonify({'error': 'Trop de stories. Reessaie plus tard.'}), 429
    data = request.get_json(silent=True) or {}
    if not data.get('image'):
        return jsonify({'error': 'Photo requise'}), 400
    image, erreur = image_depuis_base64(data.get('image'))
    if erreur:
        return jsonify({'error': erreur}), 400
    texte = sanitize_text(str(data.get('texte') or ''), 150)
    conn = get_db()
    sid = conn.execute('INSERT INTO stories (user_id, image, texte, date_creation) VALUES (?, ?, ?, ?)',
                       (user_id, image, texte, datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'))).lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': sid, 'message': 'Story publiee pour 24 h'}), 201

@app.route('/api/stories/<int:sid>', methods=['DELETE'])
def api_supprimer_story(sid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    st = conn.execute('SELECT user_id, image FROM stories WHERE id = ?', (sid,)).fetchone()
    if not st or st['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Introuvable'}), 404
    conn.execute('DELETE FROM stories WHERE id = ?', (sid,))
    conn.commit()
    conn.close()
    supprimer_fichier('static/uploads/' + st['image'])
    return jsonify({'message': 'Story supprimee'})

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
    if trop_rapide('commentaire', user_id, 20, 60):
        return jsonify({'error': 'Tu vas trop vite. Patiente une minute.'}), 429
    contenu = sanitize_text(data['contenu'].strip(), 2000)
    conn = get_db()
    if not conn.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Publication introuvable'}), 404
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
    bourses = conn.execute('SELECT * FROM bourses WHERE COALESCE(valide, 1) = 1 ORDER BY expiree ASC, date_publication DESC').fetchall()
    conn.close()
    return jsonify([dict(b) for b in bourses])

# ===================== OPPORTUNITES (stages, emplois) =====================
TYPES_OPPORTUNITE = {'stage': 'Stage', 'emploi': 'Emploi', 'job': 'Job etudiant', 'alternance': 'Alternance'}

def lire_opportunite(data):
    """Valide un formulaire d'offre. Renvoie (champs, None) ou (None, erreur)."""
    champ = lambda k, n: sanitize_text(str(data.get(k) or ''), n)
    o = {'type': champ('type', 20).lower(), 'titre': champ('titre', 150), 'entreprise': champ('entreprise', 120),
         'ville': champ('ville', 80), 'domaine': champ('domaine', 100), 'description': champ('description', 3000),
         'lien': lien_sur(champ('lien', 500)), 'contact': champ('contact', 150), 'date_limite': champ('date_limite', 10)}
    if o['type'] not in TYPES_OPPORTUNITE:
        return None, 'Type invalide (stage, emploi, job ou alternance)'
    if not o['titre'] or not o['entreprise']:
        return None, "Titre et entreprise requis"
    if not (o['lien'] or o['contact']):
        return None, 'Indique un lien pour postuler ou un contact'
    if o['date_limite'] and not re.match(r'^\d{4}-\d{2}-\d{2}$', o['date_limite']):
        return None, 'Date limite au format AAAA-MM-JJ'
    return o, None

def annoncer_opportunite(o):
    """Previent les etudiants abonnes a ce type d'offre."""
    conn = get_db()
    abonnes = [r['user_id'] for r in conn.execute(
        'SELECT user_id FROM abonnements_alertes WHERE type = ? AND COALESCE(actif, 1) = 1 AND user_id != ?',
        ('opportunite_' + o['type'], o['user_id'])).fetchall()]
    conn.close()
    message = f"{TYPES_OPPORTUNITE[o['type']]} : {o['titre']} chez {o['entreprise']}"
    for uid in abonnes:
        creer_notification(uid, 'opportunite', message, '/opportunites')
    if abonnes:
        envoyer_push(abonnes, 'opportunite', message, '/opportunites')

def creer_opportunite(user, o):
    """Publie (admin) ou soumet a validation (etudiant). Renvoie True si publiee."""
    publie = est_admin(user)
    conn = get_db()
    oid = conn.execute('''INSERT INTO opportunites (user_id, type, titre, entreprise, ville, domaine, description,
                          lien, contact, date_limite, valide) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                       (user['id'], o['type'], o['titre'], o['entreprise'], o['ville'], o['domaine'], o['description'],
                        o['lien'], o['contact'], o['date_limite'], 1 if publie else 0)).lastrowid
    conn.commit()
    conn.close()
    if publie:
        annoncer_opportunite({**o, 'user_id': user['id']})
    else:
        prevenir_admins('opportunite', f"Offre a valider : {o['titre']} ({o['entreprise']})")
    return oid, publie

def liste_opportunites(type_offre='', ville='', q=''):
    aujourdhui = date.today().isoformat()
    sql_ = '''SELECT o.*, users.prenom, users.nom FROM opportunites o JOIN users ON users.id = o.user_id
              WHERE o.valide = 1 AND (o.date_limite = '' OR o.date_limite >= ?)'''
    params = [aujourdhui]
    if type_offre in TYPES_OPPORTUNITE:
        sql_ += ' AND o.type = ?'
        params.append(type_offre)
    if ville:
        sql_ += ' AND lower(o.ville) LIKE ?'
        params.append('%' + ville.lower()[:80] + '%')
    if q:
        sql_ += ' AND (lower(o.titre) LIKE ? OR lower(o.entreprise) LIKE ? OR lower(o.domaine) LIKE ? OR lower(o.description) LIKE ?)'
        params += ['%' + q.lower()[:100] + '%'] * 4
    sql_ += ' ORDER BY o.date_publication DESC LIMIT 200'
    conn = get_db()
    lignes = conn.execute(sql_, params).fetchall()
    conn.close()
    return [dict(l) for l in lignes]

@app.route('/api/opportunites')
def api_opportunites():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    return jsonify(liste_opportunites(request.args.get('type', ''), request.args.get('ville', '').strip(),
                                      request.args.get('q', '').strip()))

@app.route('/api/opportunites', methods=['POST'])
def api_creer_opportunite():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('proposition', user_id, 5, 3600):
        return jsonify({'error': 'Trop de propositions. Reessaie plus tard.'}), 429
    o, erreur = lire_opportunite(request.get_json(silent=True) or {})
    if erreur:
        return jsonify({'error': erreur}), 400
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    oid, publie = creer_opportunite(user, o)
    return jsonify({'id': oid, 'publie': publie,
                    'message': 'Offre publiee.' if publie else "Merci ! Ton offre sera visible apres verification par un administrateur."}), 201

@app.route('/api/opportunites/<int:oid>', methods=['DELETE'])
def api_supprimer_opportunite(oid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    o = conn.execute('SELECT user_id FROM opportunites WHERE id = ?', (oid,)).fetchone()
    moi = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    if not o:
        conn.close()
        return jsonify({'error': 'Introuvable'}), 404
    if o['user_id'] != user_id and not est_admin(moi):
        conn.close()
        return jsonify({'error': 'Non autorise'}), 403
    conn.execute('DELETE FROM opportunites WHERE id = ?', (oid,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Offre supprimee'})

@app.route('/api/opportunites/alertes', methods=['GET', 'PUT'])
def api_alertes_opportunites():
    """GET : types suivis. PUT {"types": ["stage", ...]} : remplace la liste."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    if request.method == 'PUT':
        types = [t for t in ((request.get_json(silent=True) or {}).get('types') or []) if t in TYPES_OPPORTUNITE]
        conn.execute("DELETE FROM abonnements_alertes WHERE user_id = ? AND type LIKE 'opportunite_%'", (user_id,))
        for t in types:
            conn.execute('INSERT INTO abonnements_alertes (user_id, type, actif) VALUES (?, ?, 1)', (user_id, 'opportunite_' + t))
        conn.commit()
    lignes = conn.execute("SELECT type FROM abonnements_alertes WHERE user_id = ? AND type LIKE 'opportunite_%' AND COALESCE(actif, 1) = 1",
                          (user_id,)).fetchall()
    conn.close()
    return jsonify({'types': [l['type'][len('opportunite_'):] for l in lignes]})

@app.route('/opportunites', methods=['GET', 'POST'])
def opportunites_web():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        if trop_rapide('proposition', session['user_id'], 5, 3600):
            flash('Trop de propositions. Reessaie plus tard.', 'error')
            return redirect(url_for('opportunites_web'))
        o, erreur = lire_opportunite(request.form)
        if erreur:
            flash(erreur, 'error')
            return redirect(url_for('opportunites_web'))
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.close()
        _, publie = creer_opportunite(user, o)
        flash('Offre publiee.' if publie else 'Merci ! Ton offre sera visible apres verification.', 'success')
        return redirect(url_for('opportunites_web'))
    type_offre = request.args.get('type', '')
    return render_template('opportunites.html', offres=liste_opportunites(type_offre, request.args.get('ville', '').strip(),
                                                                         request.args.get('q', '').strip()),
                           types=TYPES_OPPORTUNITE, type_actif=type_offre)

# ===================== PETITES ANNONCES =====================
CATEGORIES_ANNONCE = {'livres': 'Livres et cours', 'electronique': 'Electronique', 'logement': 'Logement / colocation',
                      'fournitures': 'Fournitures', 'services': 'Services / cours particuliers', 'autre': 'Autre'}

def lire_annonce(data):
    """Valide une annonce. Renvoie (champs, None) ou (None, erreur)."""
    champ = lambda k, n: sanitize_text(str(data.get(k) or ''), n)
    a = {'categorie': champ('categorie', 20).lower(), 'titre': champ('titre', 120),
         'description': champ('description', 2000), 'ville': champ('ville', 80)}
    if a['categorie'] not in CATEGORIES_ANNONCE:
        return None, 'Categorie invalide'
    if not a['titre']:
        return None, 'Titre requis'
    try:
        a['prix'] = int(str(data.get('prix') or 0).replace(' ', '').replace('.', ''))
    except ValueError:
        return None, 'Prix invalide (en FCFA, chiffres uniquement)'
    if not 0 <= a['prix'] <= 50_000_000:
        return None, 'Prix invalide'
    return a, None

def image_depuis_base64(image_b64):
    """Enregistre une image envoyee par l'app. Renvoie (nom, None) ou (None, erreur)."""
    if not image_b64:
        return None, None
    import base64, binascii
    try:
        img = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError):
        img = b''
    ext = extension_image(img)
    if not ext:
        return None, 'Image invalide (JPEG, PNG, GIF ou WebP)'
    nom = f"{uuid.uuid4().hex}{ext}"
    stocker_fichier('static/uploads/' + nom, img)
    return nom, None

def liste_annonces(moi, categorie='', q=''):
    sql_ = '''SELECT a.*, users.prenom, users.nom, users.avatar, (a.user_id = ?) AS est_auteur
              FROM annonces a JOIN users ON users.id = a.user_id
              WHERE COALESCE(users.banni, 0) = 0
                AND a.user_id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
                AND a.user_id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)'''
    params = [moi, moi, moi]
    if categorie in CATEGORIES_ANNONCE:
        sql_ += ' AND a.categorie = ?'
        params.append(categorie)
    if q:
        sql_ += ' AND (lower(a.titre) LIKE ? OR lower(a.description) LIKE ? OR lower(a.ville) LIKE ?)'
        params += ['%' + q.lower()[:100] + '%'] * 3
    sql_ += ' ORDER BY a.vendu ASC, a.date_publication DESC LIMIT 200'
    conn = get_db()
    lignes = conn.execute(sql_, params).fetchall()
    conn.close()
    return [dict(l) for l in lignes]

def annonce_modifiable(annonce_id, user_id):
    """Renvoie (annonce, None) si user_id est l'auteur ou un admin, sinon (None, (erreur, code))."""
    conn = get_db()
    a = conn.execute('SELECT * FROM annonces WHERE id = ?', (annonce_id,)).fetchone()
    moi = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if not a:
        return None, ('Introuvable', 404)
    if a['user_id'] != user_id and not est_admin(moi):
        return None, ('Non autorise', 403)
    return a, None

@app.route('/api/annonces')
def api_annonces():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    return jsonify(liste_annonces(user_id, request.args.get('categorie', ''), request.args.get('q', '').strip()))

@app.route('/api/annonces', methods=['POST'])
def api_creer_annonce():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('annonce', user_id, 5, 3600):
        return jsonify({'error': "Trop d'annonces. Reessaie dans une heure."}), 429
    data = request.get_json(silent=True) or {}
    a, erreur = lire_annonce(data)
    if erreur:
        return jsonify({'error': erreur}), 400
    image, erreur = image_depuis_base64(data.get('image'))
    if erreur:
        return jsonify({'error': erreur}), 400
    conn = get_db()
    aid = conn.execute('INSERT INTO annonces (user_id, categorie, titre, description, prix, ville, image) VALUES (?, ?, ?, ?, ?, ?, ?)',
                       (user_id, a['categorie'], a['titre'], a['description'], a['prix'], a['ville'], image)).lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': aid, 'message': 'Annonce publiee'}), 201

@app.route('/api/annonces/<int:aid>/vendu', methods=['POST'])
def api_annonce_vendue(aid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    a, erreur = annonce_modifiable(aid, user_id)
    if erreur:
        return jsonify({'error': erreur[0]}), erreur[1]
    conn = get_db()
    conn.execute('UPDATE annonces SET vendu = ? WHERE id = ?', (0 if a['vendu'] else 1, aid))
    conn.commit()
    conn.close()
    return jsonify({'vendu': not a['vendu']})

@app.route('/api/annonces/<int:aid>', methods=['DELETE'])
def api_supprimer_annonce(aid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    a, erreur = annonce_modifiable(aid, user_id)
    if erreur:
        return jsonify({'error': erreur[0]}), erreur[1]
    conn = get_db()
    conn.execute('DELETE FROM annonces WHERE id = ?', (aid,))
    conn.commit()
    conn.close()
    if a['image']:
        supprimer_fichier('static/uploads/' + a['image'])
    return jsonify({'message': 'Annonce supprimee'})

@app.route('/api/annonces/<int:aid>/signaler', methods=['POST'])
def api_signaler_annonce(aid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('signalement', user_id, 10, 3600):
        return jsonify({'error': 'Trop de signalements. Reessaie plus tard.'}), 429
    conn = get_db()
    a = conn.execute('SELECT titre, user_id FROM annonces WHERE id = ?', (aid,)).fetchone()
    conn.close()
    if not a:
        return jsonify({'error': 'Introuvable'}), 404
    motif = sanitize_text(str((request.get_json(silent=True) or {}).get('motif') or ''), 200)
    prevenir_admins('signalement', f"Annonce signalee : {a['titre']}" + (f' ({motif})' if motif else ''))
    return jsonify({'message': 'Merci, un administrateur va verifier cette annonce.'})

@app.route('/annonces', methods=['GET', 'POST'])
def annonces_web():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    moi = session['user_id']
    if request.method == 'POST':
        action = request.form.get('action', 'creer')
        if action in ('vendu', 'supprimer'):
            try:
                aid = int(request.form.get('id', 0))
            except ValueError:
                aid = 0
            a, erreur = annonce_modifiable(aid, moi)
            if erreur:
                flash(erreur[0], 'error')
            else:
                conn = get_db()
                if action == 'vendu':
                    conn.execute('UPDATE annonces SET vendu = ? WHERE id = ?', (0 if a['vendu'] else 1, aid))
                else:
                    conn.execute('DELETE FROM annonces WHERE id = ?', (aid,))
                conn.commit()
                conn.close()
                if action == 'supprimer' and a['image']:
                    supprimer_fichier('static/uploads/' + a['image'])
            return redirect(url_for('annonces_web'))
        if trop_rapide('annonce', moi, 5, 3600):
            flash("Trop d'annonces. Reessaie dans une heure.", 'error')
            return redirect(url_for('annonces_web'))
        a, erreur = lire_annonce(request.form)
        if erreur:
            flash(erreur, 'error')
            return redirect(url_for('annonces_web'))
        image = None
        fichier = request.files.get('image')
        if fichier and fichier.filename:
            data_img = fichier.read()
            ext = extension_image(data_img)
            if not ext:
                flash('Image invalide (JPEG, PNG, GIF ou WebP)', 'error')
                return redirect(url_for('annonces_web'))
            image = f"{uuid.uuid4().hex}{ext}"
            stocker_fichier('static/uploads/' + image, data_img)
        conn = get_db()
        conn.execute('INSERT INTO annonces (user_id, categorie, titre, description, prix, ville, image) VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (moi, a['categorie'], a['titre'], a['description'], a['prix'], a['ville'], image))
        conn.commit()
        conn.close()
        flash('Annonce publiee !', 'success')
        return redirect(url_for('annonces_web'))
    categorie = request.args.get('categorie', '')
    return render_template('annonces.html', annonces=liste_annonces(moi, categorie, request.args.get('q', '').strip()),
                           categories=CATEGORIES_ANNONCE, categorie_active=categorie)

# ===================== ENTRAIDE (questions / reponses) =====================
# Reputation : 1 point par reponse, 2 par vote recu, 10 par meilleure reponse
SQL_POINTS = '''(
    (SELECT COUNT(*) FROM reponses r WHERE r.user_id = users.id)
  + 2 * (SELECT COUNT(*) FROM votes_reponses v JOIN reponses r ON r.id = v.reponse_id WHERE r.user_id = users.id)
  + 10 * (SELECT COUNT(*) FROM questions q JOIN reponses r ON r.id = q.meilleure_reponse_id WHERE r.user_id = users.id))'''
SQL_PAS_BLOQUE = '''{col} NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
    AND {col} NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)'''

def charger_question(qid):
    conn = get_db()
    q = conn.execute('SELECT * FROM questions WHERE id = ?', (qid,)).fetchone()
    conn.close()
    return q

def peut_moderer(user_id, auteur_id):
    if user_id == auteur_id:
        return True
    conn = get_db()
    moi = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return est_admin(moi)

@app.route('/api/questions')
def api_questions():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    sql_ = '''SELECT q.id, q.user_id, q.matiere, q.titre, q.contenu, q.image, q.date_creation,
                     (q.meilleure_reponse_id IS NOT NULL) AS resolue,
                     (SELECT COUNT(*) FROM reponses r WHERE r.question_id = q.id) AS nb_reponses,
                     users.prenom, users.nom, users.avatar
              FROM questions q JOIN users ON users.id = q.user_id
              WHERE COALESCE(users.banni, 0) = 0 AND ''' + SQL_PAS_BLOQUE.format(col='q.user_id')
    params = [user_id, user_id]
    matiere = request.args.get('matiere', '').strip()
    if matiere:
        sql_ += ' AND lower(q.matiere) = ?'
        params.append(matiere.lower()[:60])
    filtre = request.args.get('filtre', '')
    if filtre == 'sans_reponse':
        sql_ += ' AND NOT EXISTS (SELECT 1 FROM reponses r WHERE r.question_id = q.id)'
    elif filtre == 'miennes':
        sql_ += ' AND q.user_id = ?'
        params.append(user_id)
    recherche = request.args.get('q', '').strip().lower()[:100]
    if recherche:
        sql_ += ' AND (lower(q.titre) LIKE ? OR lower(q.contenu) LIKE ? OR lower(q.matiere) LIKE ?)'
        params += ['%' + recherche + '%'] * 3
    sql_ += ' ORDER BY q.date_creation DESC LIMIT 200'
    conn = get_db()
    lignes = conn.execute(sql_, params).fetchall()
    matieres = conn.execute('SELECT matiere, COUNT(*) AS nb FROM questions GROUP BY matiere ORDER BY nb DESC LIMIT 20').fetchall()
    conn.close()
    return jsonify({'questions': [dict(l) for l in lignes], 'matieres': [m['matiere'] for m in matieres]})

@app.route('/api/questions', methods=['POST'])
def api_poser_question():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('question', user_id, 5, 3600):
        return jsonify({'error': 'Trop de questions. Reessaie dans une heure.'}), 429
    data = request.get_json(silent=True) or {}
    matiere = sanitize_text(str(data.get('matiere') or ''), 60)
    titre = sanitize_text(str(data.get('titre') or ''), 200)
    contenu = sanitize_text(str(data.get('contenu') or ''), 3000)
    if not matiere or len(titre) < 5:
        return jsonify({'error': 'Indique la matiere et une question d\'au moins 5 caracteres'}), 400
    image, erreur = image_depuis_base64(data.get('image'))
    if erreur:
        return jsonify({'error': erreur}), 400
    conn = get_db()
    qid = conn.execute('INSERT INTO questions (user_id, matiere, titre, contenu, image) VALUES (?, ?, ?, ?, ?)',
                       (user_id, matiere, titre, contenu, image)).lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': qid, 'message': 'Question publiee'}), 201

@app.route('/api/questions/<int:qid>')
def api_question(qid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    q = conn.execute('''SELECT q.*, users.prenom, users.nom, users.avatar FROM questions q JOIN users ON users.id = q.user_id
                        WHERE q.id = ? AND ''' + SQL_PAS_BLOQUE.format(col='q.user_id'), (qid, user_id, user_id)).fetchone()
    if not q:
        conn.close()
        return jsonify({'error': 'Question introuvable'}), 404
    reponses = conn.execute('''
        SELECT r.id, r.user_id, r.contenu, r.date_creation, users.prenom, users.nom, users.avatar,
               ''' + SQL_POINTS + ''' AS points,
               (SELECT COUNT(*) FROM votes_reponses v WHERE v.reponse_id = r.id) AS votes,
               EXISTS(SELECT 1 FROM votes_reponses v WHERE v.reponse_id = r.id AND v.user_id = ?) AS a_vote
        FROM reponses r JOIN users ON users.id = r.user_id
        WHERE r.question_id = ? AND COALESCE(users.banni, 0) = 0 AND ''' + SQL_PAS_BLOQUE.format(col='r.user_id') + '''
        ORDER BY r.date_creation ASC''', (user_id, qid, user_id, user_id)).fetchall()
    conn.close()
    reponses = [dict(r) for r in reponses]
    meilleure = q['meilleure_reponse_id']
    # meilleure reponse d'abord, puis les plus votees
    reponses.sort(key=lambda r: (r['id'] != meilleure, -r['votes']))
    question = dict(q)
    question['resolue'] = meilleure is not None
    question['est_auteur'] = q['user_id'] == user_id
    return jsonify({'question': question, 'reponses': reponses})

@app.route('/api/questions/<int:qid>/reponses', methods=['POST'])
def api_repondre(qid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('reponse', user_id, 20, 3600):
        return jsonify({'error': 'Trop de reponses. Reessaie plus tard.'}), 429
    q = charger_question(qid)
    if not q:
        return jsonify({'error': 'Question introuvable'}), 404
    if blocage_entre(user_id, q['user_id']):
        return jsonify({'error': 'Tu ne peux pas repondre a cette personne.'}), 409
    contenu = sanitize_text(str((request.get_json(silent=True) or {}).get('contenu') or ''), 5000)
    if len(contenu) < 2:
        return jsonify({'error': 'Reponse trop courte'}), 400
    conn = get_db()
    rid = conn.execute('INSERT INTO reponses (question_id, user_id, contenu) VALUES (?, ?, ?)', (qid, user_id, contenu)).lastrowid
    moi = conn.execute('SELECT prenom FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.commit()
    conn.close()
    if q['user_id'] != user_id:
        creer_notification(q['user_id'], 'entraide', f"{moi['prenom']} a repondu a ta question : {q['titre'][:60]}", f'/entraide/{qid}')
    return jsonify({'id': rid, 'message': 'Reponse publiee'}), 201

@app.route('/api/reponses/<int:rid>/vote', methods=['POST'])
def api_voter_reponse(rid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    r = conn.execute('SELECT user_id FROM reponses WHERE id = ?', (rid,)).fetchone()
    if not r:
        conn.close()
        return jsonify({'error': 'Reponse introuvable'}), 404
    if r['user_id'] == user_id:
        conn.close()
        return jsonify({'error': 'Tu ne peux pas voter pour ta propre reponse'}), 400
    if conn.execute('SELECT 1 FROM votes_reponses WHERE reponse_id = ? AND user_id = ?', (rid, user_id)).fetchone():
        conn.execute('DELETE FROM votes_reponses WHERE reponse_id = ? AND user_id = ?', (rid, user_id))
        a_vote = False
    else:
        conn.execute('INSERT INTO votes_reponses (reponse_id, user_id) VALUES (?, ?)', (rid, user_id))
        a_vote = True
    conn.commit()
    votes = conn.execute('SELECT COUNT(*) AS nb FROM votes_reponses WHERE reponse_id = ?', (rid,)).fetchone()['nb']
    conn.close()
    return jsonify({'a_vote': a_vote, 'votes': votes})

@app.route('/api/questions/<int:qid>/meilleure', methods=['POST'])
def api_meilleure_reponse(qid):
    """{"reponse_id": 3} (ou null pour annuler) : reserve a l'auteur de la question."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    q = charger_question(qid)
    if not q:
        return jsonify({'error': 'Question introuvable'}), 404
    if q['user_id'] != user_id:
        return jsonify({'error': "Seul l'auteur de la question peut choisir"}), 403
    rid = (request.get_json(silent=True) or {}).get('reponse_id')
    conn = get_db()
    if rid is not None:
        r = conn.execute('SELECT id, user_id FROM reponses WHERE id = ? AND question_id = ?', (rid, qid)).fetchone()
        if not r:
            conn.close()
            return jsonify({'error': 'Reponse invalide'}), 400
    conn.execute('UPDATE questions SET meilleure_reponse_id = ? WHERE id = ?', (rid, qid))
    conn.commit()
    conn.close()
    if rid is not None and r['user_id'] != user_id:
        creer_notification(r['user_id'], 'entraide', f"Ta reponse a ete choisie comme meilleure reponse (+10 points) : {q['titre'][:60]}", f'/entraide/{qid}')
    return jsonify({'meilleure_reponse_id': rid})

@app.route('/api/questions/<int:qid>', methods=['DELETE'])
def api_supprimer_question(qid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    q = charger_question(qid)
    if not q:
        return jsonify({'error': 'Question introuvable'}), 404
    if not peut_moderer(user_id, q['user_id']):
        return jsonify({'error': 'Non autorise'}), 403
    conn = get_db()
    conn.execute('DELETE FROM votes_reponses WHERE reponse_id IN (SELECT id FROM reponses WHERE question_id = ?)', (qid,))
    conn.execute('DELETE FROM reponses WHERE question_id = ?', (qid,))
    conn.execute('DELETE FROM questions WHERE id = ?', (qid,))
    conn.commit()
    conn.close()
    if q['image']:
        supprimer_fichier('static/uploads/' + q['image'])
    return jsonify({'message': 'Question supprimee'})

@app.route('/api/reponses/<int:rid>', methods=['DELETE'])
def api_supprimer_reponse(rid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    r = conn.execute('SELECT user_id, question_id FROM reponses WHERE id = ?', (rid,)).fetchone()
    conn.close()
    if not r:
        return jsonify({'error': 'Reponse introuvable'}), 404
    if not peut_moderer(user_id, r['user_id']):
        return jsonify({'error': 'Non autorise'}), 403
    conn = get_db()
    conn.execute('DELETE FROM votes_reponses WHERE reponse_id = ?', (rid,))
    conn.execute('DELETE FROM reponses WHERE id = ?', (rid,))
    conn.execute('UPDATE questions SET meilleure_reponse_id = NULL WHERE meilleure_reponse_id = ?', (rid,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Reponse supprimee'})

@app.route('/api/entraide/classement')
def api_classement_entraide():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    lignes = conn.execute('SELECT * FROM (SELECT users.id, users.prenom, users.nom, users.avatar, users.universite, '
                          + SQL_POINTS + ''' AS points FROM users WHERE COALESCE(users.banni, 0) = 0) t
                          WHERE t.points > 0 ORDER BY t.points DESC LIMIT 10''').fetchall()
    moi = conn.execute('SELECT ' + SQL_POINTS + ' AS points FROM users WHERE users.id = ?', (user_id,)).fetchone()
    conn.close()
    return jsonify({'classement': [dict(l) for l in lignes], 'mes_points': moi['points'] if moi else 0})

# ===================== FIABILITE =====================
from flask import got_request_exception

def journaliser_erreur(sender, exception, **extra):
    """Chaque erreur 500 est gardee (sans donnees personnelles) pour le tableau de bord admin."""
    try:
        import traceback
        detail = ''.join(traceback.format_exception(type(exception), exception, exception.__traceback__))[-2000:]
        conn = get_db()
        conn.execute('INSERT INTO erreurs (route, message, detail, date_erreur) VALUES (?, ?, ?, ?)',
                     (f'{request.method} {request.path}'[:200], f'{type(exception).__name__}: {exception}'[:300], detail,
                      datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')))
        # on ne garde que les 500 dernieres
        conn.execute('DELETE FROM erreurs WHERE id NOT IN (SELECT id FROM erreurs ORDER BY id DESC LIMIT 500)')
        conn.commit()
        conn.close()
    except Exception:
        pass  # ne jamais aggraver une erreur en la journalisant

got_request_exception.connect(journaliser_erreur, app)

@app.route('/sante')
def sante():
    """Verifie que le serveur et la base repondent (appelee toutes les 10 min pour eviter la mise en veille)."""
    try:
        conn = get_db()
        conn.execute('SELECT 1').fetchone()
        conn.close()
        return jsonify({'ok': True})
    except Exception:
        return jsonify({'ok': False}), 503

def erreurs_recentes(limite=20):
    conn = get_db()
    lignes = conn.execute('SELECT id, route, message, date_erreur FROM erreurs ORDER BY id DESC LIMIT ?', (limite,)).fetchall()
    il_y_a_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
    nb_24h = conn.execute('SELECT COUNT(*) AS nb FROM erreurs WHERE date_erreur >= ?', (il_y_a_24h,)).fetchone()['nb']
    conn.close()
    return {'recentes': [dict(l) for l in lignes], 'nb_24h': nb_24h}

# ===================== ADMINISTRATION DANS L'APP =====================
def api_est_admin(user_id):
    conn = get_db()
    u = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return est_admin(u)

def api_admin_requis():
    """Renvoie (user_id, None) pour un admin, sinon (None, reponse d'erreur)."""
    user_id = api_require_auth()
    if not user_id:
        return None, (jsonify({'error': 'Non authentifie'}), 401)
    if not api_est_admin(user_id):
        return None, (jsonify({'error': 'Reserve aux administrateurs'}), 403)
    return user_id, None

def statistiques_admin(jours=14):
    conn = get_db()
    compte = lambda sql_, *a: conn.execute(sql_, a).fetchone()['nb']
    debut = (date.today() - timedelta(days=jours - 1)).isoformat()
    il_y_a_7j = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

    def par_jour(table, colonne):
        lignes = conn.execute(f'SELECT substr({colonne}, 1, 10) AS jour, COUNT(*) AS nb FROM {table} '
                              f'WHERE substr({colonne}, 1, 10) >= ? GROUP BY substr({colonne}, 1, 10)', (debut,)).fetchall()
        valeurs = {l['jour']: l['nb'] for l in lignes}
        return [{'jour': (date.today() - timedelta(days=jours - 1 - k)).isoformat(),
                 'nb': valeurs.get((date.today() - timedelta(days=jours - 1 - k)).isoformat(), 0)} for k in range(jours)]

    actifs = conn.execute('''SELECT COUNT(DISTINCT uid) AS nb FROM (
        SELECT user_id AS uid FROM posts WHERE date_post >= ?
        UNION SELECT user_id FROM commentaires WHERE date_commentaire >= ?
        UNION SELECT expediteur_id FROM messages WHERE date_envoi >= ?) t''', (il_y_a_7j,) * 3).fetchone()['nb']
    stats = {
        'totaux': {
            'utilisateurs': compte('SELECT COUNT(*) AS nb FROM users'),
            'bannis': compte('SELECT COUNT(*) AS nb FROM users WHERE COALESCE(banni, 0) = 1'),
            'non_verifies': compte('SELECT COUNT(*) AS nb FROM users WHERE COALESCE(email_verifie, 1) = 0'),
            'publications': compte('SELECT COUNT(*) AS nb FROM posts'),
            'messages': compte('SELECT COUNT(*) AS nb FROM messages'),
            'annonces': compte('SELECT COUNT(*) AS nb FROM annonces'),
            'offres': compte('SELECT COUNT(*) AS nb FROM opportunites WHERE valide = 1'),
            'questions': compte('SELECT COUNT(*) AS nb FROM questions'),
            'documents': compte('SELECT COUNT(*) AS nb FROM documents'),
            'actifs_7j': actifs,
        },
        'inscriptions': par_jour('users', 'date_inscription'),
        'publications': par_jour('posts', 'date_post'),
        'universites': [dict(l) for l in conn.execute(
            "SELECT universite, COUNT(*) AS nb FROM users WHERE COALESCE(universite, '') != '' "
            "GROUP BY universite ORDER BY nb DESC LIMIT 5").fetchall()],
    }
    conn.close()
    return stats

@app.route('/api/admin/stats')
def api_admin_stats():
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    return jsonify({**statistiques_admin(), 'erreurs': erreurs_recentes()})

@app.route('/api/admin/moderation')
def api_admin_moderation():
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    conn = get_db()
    propositions = []
    for genre, table in TABLES_MODERATION.items():
        for l in conn.execute(f'SELECT * FROM {table} WHERE valide = 0').fetchall():
            l = dict(l)
            propositions.append({'genre': genre, 'id': l['id'], 'titre': l.get('titre') or l.get('nom'),
                                 'details': ' · '.join(str(l.get(k)) for k in ('entreprise', 'organisme', 'universite', 'type', 'ville') if l.get(k)),
                                 'lien': lien_sur(l.get('lien') or l.get('site_web') or '')})
    signales = conn.execute('''
        SELECT posts.id, posts.contenu, posts.image, users.prenom, users.nom, COUNT(s.id) AS nb, MAX(s.motif) AS motif
        FROM signalements_posts s JOIN posts ON posts.id = s.post_id JOIN users ON users.id = posts.user_id
        GROUP BY posts.id, posts.contenu, posts.image, users.prenom, users.nom ORDER BY nb DESC''').fetchall()
    conn.close()
    return jsonify({'propositions': propositions, 'signalements': [dict(x) for x in signales]})

@app.route('/api/admin/moderation/<genre>/<int:id>/<decision>', methods=['POST'])
def api_admin_moderer(genre, id, decision):
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    message = moderer(genre, id, decision)
    if not message:
        return jsonify({'error': 'Proposition introuvable'}), 404
    return jsonify({'message': message})

@app.route('/api/admin/signalements/<int:post_id>', methods=['POST', 'DELETE'])
def api_admin_signalement(post_id):
    """POST : ignorer le signalement. DELETE : supprimer la publication."""
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    conn = get_db()
    post = conn.execute('SELECT image FROM posts WHERE id = ?', (post_id,)).fetchone()
    conn.execute('DELETE FROM signalements_posts WHERE post_id = ?', (post_id,))
    if request.method == 'DELETE' and post:
        for table in ('likes', 'commentaires', 'reactions', 'post_sondage_votes', 'post_sondage_options'):
            conn.execute(f'DELETE FROM {table} WHERE post_id = ?', (post_id,))
        conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    conn.commit()
    conn.close()
    if request.method == 'DELETE' and post and post['image']:
        supprimer_fichier('static/uploads/' + post['image'])
    return jsonify({'message': 'Publication supprimee' if request.method == 'DELETE' else 'Signalement ignore'})

def annoncer_a_tous(message):
    """Notification + push a tous les etudiants actifs."""
    notifier_tous('annonce', message, '/notifications')

@app.route('/api/admin/annonce', methods=['POST'])
def api_admin_annonce():
    user_id, erreur = api_admin_requis()
    if erreur:
        return erreur
    if trop_rapide('annonce_tous', user_id, 3, 3600):
        return jsonify({'error': 'Maximum 3 annonces par heure.'}), 429
    message = sanitize_text(str((request.get_json(silent=True) or {}).get('message') or ''), 300)
    if len(message) < 5:
        return jsonify({'error': 'Message trop court'}), 400
    annoncer_a_tous('📣 ' + message)
    return jsonify({'message': 'Annonce envoyee a tous les etudiants'})

@app.route('/api/admin/utilisateurs')
def api_admin_utilisateurs():
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    q = request.args.get('q', '').strip().lower()[:100]
    sql_ = '''SELECT id, prenom, nom, email, universite, date_inscription, COALESCE(banni, 0) AS banni, role,
                     COALESCE(email_verifie, 1) AS email_verifie FROM users'''
    params = []
    if q:
        sql_ += ' WHERE lower(prenom) LIKE ? OR lower(nom) LIKE ? OR lower(email) LIKE ?'
        params = ['%' + q + '%'] * 3
    sql_ += ' ORDER BY date_inscription DESC LIMIT 100'
    conn = get_db()
    lignes = conn.execute(sql_, params).fetchall()
    conn.close()
    return jsonify([dict(l) for l in lignes])

@app.route('/api/admin/utilisateurs/<int:uid>/bannir', methods=['POST'])
def api_admin_bannir(uid):
    _, erreur = api_admin_requis()
    if erreur:
        return erreur
    conn = get_db()
    cible = conn.execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()
    if not cible:
        conn.close()
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    if est_admin(cible):
        conn.close()
        return jsonify({'error': 'Impossible de bannir un administrateur'}), 400
    nouvel_etat = 0 if cible['banni'] else 1
    conn.execute('UPDATE users SET banni = ? WHERE id = ?', (nouvel_etat, uid))
    conn.commit()
    conn.close()
    return jsonify({'banni': bool(nouvel_etat)})

@app.route('/admin/annonce', methods=['POST'])
def admin_annonce_web():
    u = admin_required()
    if not u:
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
    message = sanitize_text(request.form.get('message', ''), 300)
    if trop_rapide('annonce_tous', u['id'], 3, 3600):
        flash('Maximum 3 annonces par heure.', 'error')
    elif len(message) < 5:
        flash('Message trop court.', 'error')
    else:
        annoncer_a_tous('📣 ' + message)
        flash('Annonce envoyee a tous les etudiants.', 'success')
    return redirect(url_for('admin_dashboard'))

# ===================== PARAMETRES =====================
def parametres_de(user_id):
    conn = get_db()
    u = conn.execute('SELECT qui_peut_ecrire, masquer_vu, notifs_coupees, masquer_visites FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    coupees = set(filter(None, (u['notifs_coupees'] or '').split(',')))
    return {'qui_peut_ecrire': u['qui_peut_ecrire'] or 'tous', 'masquer_vu': bool(u['masquer_vu']), 'masquer_visites': bool(u['masquer_visites']),
            'notifications': {c: c not in coupees for c in CATEGORIES_NOTIF}}

@app.route('/api/parametres', methods=['GET', 'PUT'])
def api_parametres():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if request.method == 'PUT':
        data = request.get_json(silent=True) or {}
        conn = get_db()
        if data.get('qui_peut_ecrire') in ('tous', 'abonnes'):
            conn.execute('UPDATE users SET qui_peut_ecrire = ? WHERE id = ?', (data['qui_peut_ecrire'], user_id))
        if 'masquer_vu' in data:
            conn.execute('UPDATE users SET masquer_vu = ? WHERE id = ?', (1 if data['masquer_vu'] else 0, user_id))
        if 'masquer_visites' in data:
            conn.execute('UPDATE users SET masquer_visites = ? WHERE id = ?', (1 if data['masquer_visites'] else 0, user_id))
        if isinstance(data.get('notifications'), dict):
            coupees = [c for c in CATEGORIES_NOTIF if data['notifications'].get(c) is False]
            conn.execute('UPDATE users SET notifs_coupees = ? WHERE id = ?', (','.join(coupees), user_id))
        conn.commit()
        conn.close()
    return jsonify(parametres_de(user_id))

@app.route('/api/mot_de_passe', methods=['POST'])
def api_changer_mot_de_passe():
    """Change le mot de passe (l'actuel est exige) et deconnecte les autres appareils."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not check_rate_limit(f'changer_mdp:{user_id}', max_reqs=5, window=900):
        return jsonify({'error': 'Trop de tentatives. Reessaie dans 15 minutes.'}), 429
    data = request.get_json(silent=True) or {}
    conn = get_db()
    user = conn.execute('SELECT mot_de_passe FROM users WHERE id = ?', (user_id,)).fetchone()
    if not check_password(data.get('actuel', ''), user['mot_de_passe']):
        conn.close()
        return jsonify({'error': 'Mot de passe actuel incorrect'}), 400
    if not validate_password(data.get('nouveau', '')):
        conn.close()
        return jsonify({'error': f'Nouveau mot de passe trop court (min {MDP_MIN} caracteres)'}), 400
    conn.execute('UPDATE users SET mot_de_passe = ?, jeton_version = COALESCE(jeton_version, 0) + 1 WHERE id = ?',
                 (hash_password(data['nouveau']), user_id))
    conn.commit()
    conn.close()
    # nouveau jeton pour ce telephone ; tous les autres appareils sont deconnectes
    return jsonify({'message': 'Mot de passe modifie', 'token': api_token(user_id)})

@app.route('/api/deconnecter_partout', methods=['POST'])
def api_deconnecter_partout():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('UPDATE users SET jeton_version = COALESCE(jeton_version, 0) + 1 WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Tous les autres appareils sont deconnectes', 'token': api_token(user_id)})

@app.route('/api/conversations/<int:autre_id>/effacer', methods=['POST'])
def api_effacer_conversation(autre_id):
    """Efface l'historique de la discussion pour moi seulement (l'autre garde le sien)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    maintenant = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    conn.execute('DELETE FROM conversations_effacees WHERE user_id = ? AND autre_id = ?', (user_id, autre_id))
    conn.execute('INSERT INTO conversations_effacees (user_id, autre_id, date_effacement) VALUES (?, ?, ?)', (user_id, autre_id, maintenant))
    conn.execute('UPDATE messages SET lu = 1 WHERE expediteur_id = ? AND destinataire_id = ?', (autre_id, user_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Discussion effacee'})

@app.route('/api/aide/contact')
def api_aide_contact():
    """Administrateur a contacter depuis la page Aide."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    admin = conn.execute("SELECT id, prenom, nom, avatar FROM users WHERE role = 'admin' AND id != ? ORDER BY id LIMIT 1", (user_id,)).fetchone()
    conn.close()
    return jsonify(dict(admin) if admin else {})

# ===================== SUPPRESSION DE COMPTE =====================
def supprimer_compte(user_id):
    """Efface definitivement le compte et toutes ses donnees (exige par Google Play et l'App Store)."""
    conn = get_db()
    u = conn.execute('SELECT avatar FROM users WHERE id = ?', (user_id,)).fetchone()
    fichiers = []  # chemins a effacer apres la base

    # ses publications et tout ce qui s'y rattache
    for p_ in conn.execute('SELECT id, image FROM posts WHERE user_id = ?', (user_id,)).fetchall():
        for table in ('likes', 'commentaires', 'reactions', 'post_sondage_votes', 'post_sondage_options', 'signalements_posts'):
            conn.execute(f'DELETE FROM {table} WHERE post_id = ?', (p_['id'],))
        if p_['image']:
            fichiers.append('static/uploads/' + p_['image'])
    # ses questions (et les reponses des autres dessous)
    for q in conn.execute('SELECT id, image FROM questions WHERE user_id = ?', (user_id,)).fetchall():
        conn.execute('DELETE FROM votes_reponses WHERE reponse_id IN (SELECT id FROM reponses WHERE question_id = ?)', (q['id'],))
        conn.execute('DELETE FROM reponses WHERE question_id = ?', (q['id'],))
        if q['image']:
            fichiers.append('static/uploads/' + q['image'])
    # ses reponses (la meilleure reponse d'une question redevient libre)
    conn.execute('DELETE FROM votes_reponses WHERE reponse_id IN (SELECT id FROM reponses WHERE user_id = ?)', (user_id,))
    conn.execute('UPDATE questions SET meilleure_reponse_id = NULL WHERE meilleure_reponse_id IN (SELECT id FROM reponses WHERE user_id = ?)', (user_id,))
    # groupes qu'il a crees : supprimes avec leurs messages
    for g in conn.execute('SELECT id FROM groupes WHERE createur_id = ?', (user_id,)).fetchall():
        conn.execute('DELETE FROM groupe_messages WHERE groupe_id = ?', (g['id'],))
        conn.execute('DELETE FROM groupe_membres WHERE groupe_id = ?', (g['id'],))
    # photos et fichiers de ses messages, annonces, stories, documents
    for m in conn.execute('SELECT image, audio FROM messages WHERE expediteur_id = ?', (user_id,)).fetchall():
        fichiers += ['static/uploads/' + f for f in (m['image'], m['audio']) if f]
    for table in ('annonces', 'stories'):
        fichiers += ['static/uploads/' + r['image'] for r in conn.execute(f'SELECT image FROM {table} WHERE user_id = ?', (user_id,)).fetchall() if r['image']]
    fichiers += ['uploads/' + d['fichier'] for d in conn.execute('SELECT fichier FROM documents WHERE user_id = ?', (user_id,)).fetchall() if d['fichier']]
    if u and u['avatar'] and u['avatar'] != 'default.png':
        fichiers.append('static/avatars/' + u['avatar'])
    couv = conn.execute('SELECT couverture FROM users WHERE id = ?', (user_id,)).fetchone()
    if couv and couv['couverture']:
        fichiers.append('static/uploads/' + couv['couverture'])
    conn.execute('DELETE FROM vues_profil WHERE profil_id = ? OR visiteur_id = ?', (user_id, user_id))

    for table in ('posts', 'likes', 'commentaires', 'reactions', 'post_sondage_votes', 'signalements_posts', 'questions',
                  'reponses', 'votes_reponses', 'documents', 'notifications', 'abonnements_alertes', 'reset_tokens',
                  'evenements', 'groupe_membres', 'groupe_messages', 'user_badges', 'codes_verification', 'opportunites',
                  'annonces', 'stories', 'expo_push_tokens', 'conversations_effacees', 'cours', 'examens'):
        conn.execute(f'DELETE FROM {table} WHERE user_id = ?', (user_id,))
    conn.execute('DELETE FROM groupes WHERE createur_id = ?', (user_id,))
    conn.execute('DELETE FROM messages WHERE expediteur_id = ? OR destinataire_id = ?', (user_id, user_id))
    conn.execute('DELETE FROM follows WHERE follower_id = ? OR followed_id = ?', (user_id, user_id))
    conn.execute('DELETE FROM blocages WHERE bloqueur_id = ? OR bloque_id = ?', (user_id, user_id))
    conn.execute('DELETE FROM conversations_effacees WHERE autre_id = ?', (user_id,))
    conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    for f in fichiers:
        supprimer_fichier(f)

def verifier_suppression(user_id, mot_de_passe):
    """Renvoie un message d'erreur, ou None si le compte peut etre supprime."""
    conn = get_db()
    u = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if not u or not check_password(mot_de_passe or '', u['mot_de_passe']):
        return 'Mot de passe incorrect'
    if est_admin(u):
        return "Un administrateur ne peut pas supprimer son compte depuis l'app (retire d'abord son role)."
    return None

@app.route('/api/supprimer_compte', methods=['POST'])
def api_supprimer_compte():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not check_rate_limit(f'suppression:{user_id}', max_reqs=5, window=900):
        return jsonify({'error': 'Trop de tentatives. Reessaie dans 15 minutes.'}), 429
    erreur = verifier_suppression(user_id, (request.get_json(silent=True) or {}).get('mot_de_passe'))
    if erreur:
        return jsonify({'error': erreur}), 400
    supprimer_compte(user_id)
    return jsonify({'message': 'Ton compte et toutes tes donnees ont ete supprimes.'})

@app.route('/compte/supprimer', methods=['GET', 'POST'])
def supprimer_compte_web():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        if not check_rate_limit(f"suppression:{session['user_id']}", max_reqs=5, window=900):
            flash('Trop de tentatives. Reessaie dans 15 minutes.', 'error')
            return redirect(url_for('supprimer_compte_web'))
        erreur = verifier_suppression(session['user_id'], request.form.get('mot_de_passe'))
        if erreur:
            flash(erreur, 'error')
            return redirect(url_for('supprimer_compte_web'))
        supprimer_compte(session['user_id'])
        session.clear()
        flash('Ton compte et toutes tes donnees ont ete supprimes. Au revoir !', 'success')
        return redirect(url_for('connexion'))
    return render_template('supprimer_compte.html')

# ---- Pages legales (publiques)
@app.route('/confidentialite')
def confidentialite():
    return render_template('confidentialite.html')

@app.route('/conditions')
def conditions():
    return render_template('conditions.html')

# ---- Qui a vu mon profil
def noter_visite(conn, profil_id, visiteur_id):
    """Garde la derniere visite (sauf sur soi-meme, si le visiteur masque ses visites, ou en cas de blocage)."""
    if profil_id == visiteur_id:
        return
    v = conn.execute('SELECT masquer_visites FROM users WHERE id = ?', (visiteur_id,)).fetchone()
    if not v or v['masquer_visites'] or blocage_entre(profil_id, visiteur_id):
        return
    maintenant = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute('DELETE FROM vues_profil WHERE profil_id = ? AND visiteur_id = ?', (profil_id, visiteur_id))
    conn.execute('INSERT INTO vues_profil (profil_id, visiteur_id, date_vue) VALUES (?, ?, ?)', (profil_id, visiteur_id, maintenant))
    conn.commit()

@app.route('/api/profil/vues')
def api_vues_profil():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    moi = conn.execute('SELECT masquer_visites FROM users WHERE id = ?', (user_id,)).fetchone()
    if moi['masquer_visites']:  # reciproque : qui cache ses visites ne voit pas celles des autres
        conn.close()
        return jsonify({'masque': True, 'total': 0, 'vues': []})
    il_y_a_30j = (datetime.now(timezone.utc) - timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S')
    vues = conn.execute('''SELECT users.id, users.prenom, users.nom, users.avatar, users.filiere, users.universite, v.date_vue
                           FROM vues_profil v JOIN users ON users.id = v.visiteur_id
                           WHERE v.profil_id = ? AND v.date_vue >= ? AND COALESCE(users.banni, 0) = 0
                             AND users.id NOT IN (SELECT bloque_id FROM blocages WHERE bloqueur_id = ?)
                             AND users.id NOT IN (SELECT bloqueur_id FROM blocages WHERE bloque_id = ?)
                           ORDER BY v.date_vue DESC LIMIT 50''', (user_id, il_y_a_30j, user_id, user_id)).fetchall()
    conn.close()
    return jsonify({'masque': False, 'total': len(vues), 'vues': [dict(v) for v in vues]})

@app.route('/api/invitations')
def api_invitations():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    code = code_invitation(user_id)
    conn = get_db()
    filleuls = conn.execute('''SELECT id, prenom, nom, avatar, date_inscription FROM users
                               WHERE parrain_id = ? AND COALESCE(email_verifie, 1) = 1 ORDER BY date_inscription DESC''', (user_id,)).fetchall()
    conn.close()
    lien = f'https://linkci.onrender.com/inscription?invite={code}'
    return jsonify({'code': code, 'lien': lien, 'nb_filleuls': len(filleuls), 'objectif_badge': 3,
                    'filleuls': [dict(f) for f in filleuls],
                    'message': f"Rejoins-moi sur LinkCI, le reseau des etudiants de Cote d'Ivoire : bourses, stages, entraide, groupes de promo. Inscris-toi ici : {lien}"})

# ===================== EMPLOI DU TEMPS ET EXAMENS =====================
HEURE_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')

@app.route('/api/emploi_du_temps', methods=['GET', 'POST'])
def api_emploi_du_temps():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    if request.method == 'POST':
        d = request.get_json(silent=True) or {}
        try:
            jour = int(d.get('jour'))
        except (TypeError, ValueError):
            jour = 0
        debut, fin = str(d.get('debut') or ''), str(d.get('fin') or '')
        matiere = sanitize_text(str(d.get('matiere') or ''), 80)
        if not 1 <= jour <= 7 or not HEURE_RE.match(debut) or not HEURE_RE.match(fin) or fin <= debut or not matiere:
            conn.close()
            return jsonify({'error': 'Jour, heures (HH:MM, fin apres debut) et matiere requis'}), 400
        if conn.execute('SELECT COUNT(*) AS nb FROM cours WHERE user_id = ?', (user_id,)).fetchone()['nb'] >= 80:
            conn.close()
            return jsonify({'error': 'Emploi du temps plein (80 cours max)'}), 400
        conn.execute('INSERT INTO cours (user_id, jour, debut, fin, matiere, salle, enseignant) VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (user_id, jour, debut, fin, matiere, sanitize_text(str(d.get('salle') or ''), 60), sanitize_text(str(d.get('enseignant') or ''), 60)))
        conn.commit()
    cours = conn.execute('SELECT id, jour, debut, fin, matiere, salle, enseignant FROM cours WHERE user_id = ? ORDER BY jour, debut', (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(c) for c in cours])

@app.route('/api/emploi_du_temps/<int:cid>', methods=['DELETE'])
def api_supprimer_cours(cid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('DELETE FROM cours WHERE id = ? AND user_id = ?', (cid, user_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Cours supprime'})

@app.route('/api/examens', methods=['GET', 'POST'])
def api_examens():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    if request.method == 'POST':
        d = request.get_json(silent=True) or {}
        matiere = sanitize_text(str(d.get('matiere') or ''), 80)
        date_ex = str(d.get('date_examen') or '')
        heure = str(d.get('heure') or '')
        try:
            datetime.strptime(date_ex, '%Y-%m-%d')
            valide = bool(matiere) and (not heure or HEURE_RE.match(heure))
        except ValueError:
            valide = False
        if not valide:
            conn.close()
            return jsonify({'error': 'Matiere et date (AAAA-MM-JJ) requises, heure au format HH:MM'}), 400
        if conn.execute('SELECT COUNT(*) AS nb FROM examens WHERE user_id = ?', (user_id,)).fetchone()['nb'] >= 100:
            conn.close()
            return jsonify({'error': "Trop d'examens (100 max)"}), 400
        conn.execute('INSERT INTO examens (user_id, matiere, date_examen, heure, salle, note) VALUES (?, ?, ?, ?, ?, ?)',
                     (user_id, matiere, date_ex, heure, sanitize_text(str(d.get('salle') or ''), 60), sanitize_text(str(d.get('note') or ''), 200)))
        conn.commit()
    examens = conn.execute('SELECT id, matiere, date_examen, heure, salle, note FROM examens WHERE user_id = ? ORDER BY date_examen, heure',
                           (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(e) for e in examens])

@app.route('/api/examens/<int:eid>', methods=['DELETE'])
def api_supprimer_examen(eid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('DELETE FROM examens WHERE id = ? AND user_id = ?', (eid, user_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Examen supprime'})

@app.route('/api/formations')
def api_formations():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    formations = conn.execute('SELECT * FROM formations WHERE COALESCE(valide, 1) = 1 ORDER BY universite, nom').fetchall()
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
    efface = conn.execute('SELECT date_effacement FROM conversations_effacees WHERE user_id = ? AND autre_id = ?',
                          (user_id, autre_id)).fetchone()
    messages = conn.execute('''
        SELECT messages.*, users.prenom, users.nom
        FROM messages JOIN users ON messages.expediteur_id = users.id
        WHERE ((expediteur_id = ? AND destinataire_id = ?) OR (expediteur_id = ? AND destinataire_id = ?))
          AND date_envoi > ?
        ORDER BY date_envoi ASC
    ''', (user_id, autre_id, autre_id, user_id, efface['date_effacement'] if efface else '')).fetchall()
    # "Vu" masque si l'un des deux l'a desactive (reciproque, comme WhatsApp)
    vu_masque = bool(conn.execute('SELECT 1 FROM users WHERE id IN (?, ?) AND COALESCE(masquer_vu, 0) = 1',
                                  (user_id, autre_id)).fetchone())
    non_lus = conn.execute('UPDATE messages SET lu = 1 WHERE expediteur_id = ? AND destinataire_id = ? AND lu = 0',
                           (autre_id, user_id)).rowcount
    conn.commit()
    conn.close()
    if non_lus and not vu_masque:
        try:  # "Vu" en direct chez l'expediteur
            socketio.emit('messages_lus', {'par': user_id}, room='user_' + str(autre_id))
        except Exception:
            pass
    resultat = [dict(m) for m in messages]
    if vu_masque:
        for m in resultat:
            if m['expediteur_id'] == user_id:
                m['lu'] = 0
    return jsonify(resultat)

@app.route('/api/messages', methods=['POST'])
def api_send_message():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.get_json(silent=True) or {}
    # une photo seule (sans texte) est acceptee
    if not (str(data.get('contenu') or '').strip() or data.get('image')) or not data.get('destinataire_id'):
        return jsonify({'error': 'contenu (ou image) et destinataire_id requis'}), 400
    if trop_rapide('message', user_id, 30, 60) or trop_rapide('message_heure', user_id, 300, 3600):
        return jsonify({'error': 'Tu vas trop vite. Patiente une minute.'}), 429
    contenu = sanitize_text(str(data.get('contenu') or ''), FIELD_MAXLEN['message'])
    try:
        destinataire_id = int(data['destinataire_id'])
    except (TypeError, ValueError):
        return jsonify({'error': 'destinataire_id invalide'}), 400
    if destinataire_id == user_id:
        return jsonify({'error': "Tu ne peux pas t'envoyer un message"}), 400
    if not peut_ecrire(user_id, destinataire_id):
        return jsonify({'error': "Tu ne peux pas ecrire a cette personne."}), 409  # pas 403 : l'app y voit une session expiree
    conn = get_db()
    if not conn.execute('SELECT 1 FROM users WHERE id = ?', (destinataire_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Destinataire introuvable'}), 404
    image, erreur = image_depuis_base64(data.get('image'))
    if erreur:
        conn.close()
        return jsonify({'error': erreur}), 400
    msg_id = conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu, image) VALUES (?, ?, ?, ?)',
                          (user_id, destinataire_id, contenu, image)).lastrowid
    conn.commit()
    auteur = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    diffuser_message(user_id, destinataire_id, msg_id, contenu, image)
    nom = f"{auteur['prenom']} {auteur['nom']}" if auteur else "quelqu'un"
    creer_notification(destinataire_id, 'message', f"{'Photo' if image and not contenu else 'Nouveau message'} de {nom}", f"/conversation/{user_id}")
    return jsonify({'message': 'Envoye', 'id': msg_id}), 201

# ---- Notes vocales (enregistrees par l'app en AAC / .m4a)
VOCAL_TAILLE_MAX = 3 * 1024 * 1024  # ~3 min en qualite voix
VOCAL_DUREE_MAX = 180  # secondes

def extension_audio(data):
    """Verifie le contenu reel : conteneur MP4/M4A ou 3GP ('ftyp'), AAC brut (ADTS) ou Ogg."""
    if len(data) > 12 and data[4:8] == b'ftyp':
        return '.m4a'
    if data[:2] in (b'\xff\xf1', b'\xff\xf9'):
        return '.aac'
    if data[:4] == b'OggS':
        return '.ogg'
    return None

@app.route('/api/messages/vocal', methods=['POST'])
def api_message_vocal():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('message', user_id, 30, 60) or trop_rapide('message_heure', user_id, 300, 3600):
        return jsonify({'error': 'Tu vas trop vite. Patiente une minute.'}), 429
    try:
        destinataire_id = int(request.form.get('destinataire_id', ''))
        duree = max(1, min(VOCAL_DUREE_MAX, int(float(request.form.get('duree', '1')))))
    except ValueError:
        return jsonify({'error': 'destinataire_id et duree requis'}), 400
    if destinataire_id == user_id:
        return jsonify({'error': "Tu ne peux pas t'envoyer un message"}), 400
    if not peut_ecrire(user_id, destinataire_id):
        return jsonify({'error': 'Tu ne peux pas ecrire a cette personne.'}), 409
    fichier = request.files.get('audio')
    data = fichier.read(VOCAL_TAILLE_MAX + 1) if fichier else b''
    if not data or len(data) > VOCAL_TAILLE_MAX:
        return jsonify({'error': 'Note vocale absente ou trop longue (3 min max)'}), 400
    ext = extension_audio(data)
    if not ext:
        return jsonify({'error': 'Fichier audio invalide'}), 400
    conn = get_db()
    if not conn.execute('SELECT 1 FROM users WHERE id = ?', (destinataire_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Destinataire introuvable'}), 404
    nom_fichier = f'{uuid.uuid4().hex}{ext}'
    stocker_fichier('static/uploads/' + nom_fichier, data)
    msg_id = conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu, audio, duree) VALUES (?, ?, ?, ?, ?)',
                          (user_id, destinataire_id, '', nom_fichier, duree)).lastrowid
    conn.commit()
    auteur = conn.execute('SELECT prenom, nom FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    diffuser_message(user_id, destinataire_id, msg_id, '', audio=nom_fichier, duree=duree)
    creer_notification(destinataire_id, 'message', f"Note vocale de {auteur['prenom']} {auteur['nom']}", f'/conversation/{user_id}')
    return jsonify({'id': msg_id, 'message': 'Envoye'}), 201

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
            (SELECT CASE WHEN contenu = '' AND audio IS NOT NULL THEN 'Note vocale' WHEN contenu = '' AND image IS NOT NULL THEN 'Photo' ELSE contenu END FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as dernier_message,
            (SELECT date_envoi FROM messages WHERE (expediteur_id = ? AND destinataire_id = users.id) OR (expediteur_id = users.id AND destinataire_id = ?) ORDER BY date_envoi DESC LIMIT 1) as date_dernier,
            (SELECT COUNT(*) FROM messages WHERE destinataire_id = ? AND expediteur_id = users.id AND lu = 0) as non_lu
        FROM messages JOIN users ON users.id = CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END
        WHERE expediteur_id = ? OR destinataire_id = ?
        ORDER BY date_dernier DESC
    ''', (user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id)).fetchall()
    effacees = {e['autre_id']: e['date_effacement'] for e in conn.execute(
        'SELECT autre_id, date_effacement FROM conversations_effacees WHERE user_id = ?', (user_id,)).fetchall()}
    conn.close()
    return jsonify([dict(c) for c in convs if (c['date_dernier'] or '') > effacees.get(c['autre_id'], '')])

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
    bloque = bool(conn.execute('SELECT 1 FROM blocages WHERE bloqueur_id = ? AND bloque_id = ?', (user_id, autre_id)).fetchone())
    noter_visite(conn, autre_id, user_id)
    suivi = bool(conn.execute('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (user_id, autre_id)).fetchone())
    conn.close()
    return jsonify({'user': profil_public(user), 'posts': [dict(p) for p in posts], 'badges': [dict(b) for b in badges], 'bloque': bloque, 'suivi': suivi})

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

@app.route('/api/documents', methods=['POST'])
def api_envoyer_document():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not check_rate_limit(f'document:{user_id}', max_reqs=5, window=600):
        return jsonify({'error': 'Trop de documents envoyes. Reessaie dans quelques minutes.'}), 429
    fichier = request.files.get('fichier')
    if not fichier or not fichier.filename:
        return jsonify({'error': 'Fichier requis'}), 400
    doc_id, erreur = enregistrer_document(user_id, request.form.get('titre', ''), request.form.get('description', ''),
                                          request.form.get('matiere', ''), request.form.get('universite', ''),
                                          fichier.filename, fichier.read())
    if erreur:
        return jsonify({'error': erreur}), 400
    return jsonify({'id': doc_id, 'message': 'Document partage'}), 201

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
    riches, erreur = lire_profil_riche(data)
    if erreur:
        conn.close()
        return jsonify({'error': erreur}), 400
    # photo de couverture (ou suppression avec "couverture": "")
    ancienne_couv = conn.execute('SELECT couverture FROM users WHERE id = ?', (user_id,)).fetchone()['couverture']
    if data.get('couverture'):
        nom_couv, err = image_depuis_base64(data['couverture'])
        if err:
            conn.close()
            return jsonify({'error': err}), 400
        riches['couverture'] = nom_couv
    elif data.get('couverture') == '' and ancienne_couv:
        riches['couverture'] = None
    if 'couverture' in riches and ancienne_couv:
        supprimer_fichier('static/uploads/' + ancienne_couv)
    conn.execute('UPDATE users SET prenom=?, nom=?, universite=?, filiere=?, annee=?, bio=?, avatar=? WHERE id=?',
                 (champs['prenom'], champs['nom'], champs['universite'], champs['filiere'],
                  champs['annee'], champs['bio'], avatar, user_id))
    for cle, valeur in riches.items():  # cles validees par lire_profil_riche
        conn.execute(f'UPDATE users SET {cle} = ? WHERE id = ?', (valeur, user_id))
    conn.commit()
    user = conn.execute(f'SELECT {CHAMPS_PUBLICS_USER}, email FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return jsonify(profil_public(user))

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
    ev = conn.execute('SELECT user_id FROM evenements WHERE id = ?', (id,)).fetchone()
    moi = conn.execute('SELECT role FROM users WHERE id = ?', (user_id,)).fetchone()
    if not ev:
        conn.close()
        return jsonify({'error': 'Evenement introuvable'}), 404
    if ev['user_id'] != user_id and not est_admin(moi):
        conn.close()
        return jsonify({'error': 'Tu ne peux supprimer que tes propres evenements'}), 403
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
    moi = conn.execute('SELECT universite, filiere FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    uni = (moi['universite'] or '').strip().lower() if moi else ''
    fil = (moi['filiere'] or '').strip().lower() if moi else ''

    def score(g):  # meme universite et/ou meme filiere
        texte = f"{g['nom']} {g['description']} {g['filiere'] or ''}".lower()
        return (2 if uni and uni in (f"{g['universite'] or ''} {texte}".lower()) else 0) + (1 if fil and fil in texte else 0)
    tous = sorted((dict(g) for g in tous_groupes), key=lambda g: (-score(g), -g['nb_membres'], g['nom']))
    for g in tous:
        g['suggere'] = score(g) > 0
    # groupe de promo a creer en un geste s'il n'existe pas encore
    a_creer = None
    if uni and fil and not any(score(g) == 3 for g in tous) and not any(
            uni in f"{g['universite'] or ''} {g['nom']}".lower() and fil in f"{g['nom']} {g['filiere'] or ''}".lower() for g in mes_groupes):
        a_creer = {'nom': f"{moi['filiere'].strip()} · {moi['universite'].strip()}", 'universite': moi['universite'].strip(), 'filiere': moi['filiere'].strip()}
    return jsonify({'mes_groupes': [dict(g) for g in mes_groupes], 'tous_groupes': tous, 'a_creer': a_creer})

@app.route('/api/groupes', methods=['POST'])
def api_creer_groupe():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('nom', '').strip():
        return jsonify({'error': 'Nom du groupe requis'}), 400
    if trop_rapide('groupe', user_id, 5, 3600):
        return jsonify({'error': 'Trop de groupes crees. Reessaie plus tard.'}), 429
    conn = get_db()
    c = conn.execute('INSERT INTO groupes (nom, description, universite, filiere, createur_id) VALUES (?, ?, ?, ?, ?)',
                     (sanitize_text(data['nom'], 100), sanitize_text(data.get('description', ''), 500),
                      sanitize_text(data.get('universite', ''), 100), sanitize_text(data.get('filiere', ''), 100), user_id))
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
    data = request.get_json(silent=True) or {}
    if not (str(data.get('contenu') or '').strip() or data.get('image')):
        return jsonify({'error': 'Contenu requis'}), 400
    if trop_rapide('message', user_id, 30, 60):
        return jsonify({'error': 'Tu vas trop vite. Patiente une minute.'}), 429
    if not est_membre_groupe(id, user_id):
        return jsonify({'error': 'Tu n\'es pas membre'}), 403
    image, erreur = image_depuis_base64(data.get('image'))
    if erreur:
        return jsonify({'error': erreur}), 400
    contenu = sanitize_text(str(data.get('contenu') or ''), FIELD_MAXLEN['message'])
    conn = get_db()
    mid = conn.execute('INSERT INTO groupe_messages (groupe_id, user_id, contenu, image) VALUES (?, ?, ?, ?)',
                       (id, user_id, contenu, image)).lastrowid
    conn.commit()
    conn.close()
    apres_message_groupe(id, user_id, contenu or 'Photo')
    return jsonify({'message': 'Envoye', 'id': mid}), 201

@app.route('/api/groupes/<int:id>/vocal', methods=['POST'])
def api_vocal_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if trop_rapide('message', user_id, 30, 60):
        return jsonify({'error': 'Tu vas trop vite. Patiente une minute.'}), 429
    if not est_membre_groupe(id, user_id):
        return jsonify({'error': 'Tu n\'es pas membre'}), 403
    try:
        duree = max(1, min(VOCAL_DUREE_MAX, int(float(request.form.get('duree', '1')))))
    except ValueError:
        return jsonify({'error': 'duree invalide'}), 400
    fichier = request.files.get('audio')
    data = fichier.read(VOCAL_TAILLE_MAX + 1) if fichier else b''
    if not data or len(data) > VOCAL_TAILLE_MAX:
        return jsonify({'error': 'Note vocale absente ou trop longue (3 min max)'}), 400
    ext = extension_audio(data)
    if not ext:
        return jsonify({'error': 'Fichier audio invalide'}), 400
    nom_fichier = f'{uuid.uuid4().hex}{ext}'
    stocker_fichier('static/uploads/' + nom_fichier, data)
    conn = get_db()
    mid = conn.execute('INSERT INTO groupe_messages (groupe_id, user_id, contenu, audio, duree) VALUES (?, ?, ?, ?, ?)',
                       (id, user_id, '', nom_fichier, duree)).lastrowid
    conn.commit()
    conn.close()
    apres_message_groupe(id, user_id, 'Note vocale')
    return jsonify({'message': 'Envoye', 'id': mid}), 201

# ---- Administration d'un groupe
def est_membre_groupe(groupe_id, user_id):
    conn = get_db()
    m = conn.execute('SELECT role FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (groupe_id, user_id)).fetchone()
    conn.close()
    return m

def est_admin_groupe(groupe_id, user_id):
    m = est_membre_groupe(groupe_id, user_id)
    return bool(m) and m['role'] == 'admin'

def apres_message_groupe(groupe_id, auteur_id, apercu):
    """Temps reel + notification push aux membres + @mentions."""
    diffuser_message_groupe(groupe_id, auteur_id)
    conn = get_db()
    g = conn.execute('SELECT nom FROM groupes WHERE id = ?', (groupe_id,)).fetchone()
    auteur = conn.execute('SELECT prenom FROM users WHERE id = ?', (auteur_id,)).fetchone()
    membres = conn.execute('''SELECT users.id, users.prenom FROM groupe_membres gm JOIN users ON users.id = gm.user_id
                              WHERE gm.groupe_id = ? AND users.id != ?''', (groupe_id, auteur_id)).fetchall()
    conn.close()
    if not g or not membres:
        return
    lien = f'/groupes/{groupe_id}'
    # @Prenom : notification dediee aux membres mentionnes
    mots = {m.lower() for m in re.findall(r'@([\w\-]{2,40})', apercu, re.UNICODE)}
    mentionnes = [m['id'] for m in membres if (m['prenom'] or '').lower() in mots]
    for uid in mentionnes:
        creer_notification(uid, 'mention', f"{auteur['prenom']} t'a mentionne dans {g['nom']}", lien)
    autres = [m['id'] for m in membres if m['id'] not in mentionnes]
    envoyer_push(autres, 'message', f"{g['nom']} · {auteur['prenom']} : {apercu[:120]}", lien)

@app.route('/api/groupes/<int:id>/membres')
def api_membres_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not est_membre_groupe(id, user_id):
        return jsonify({'error': 'Tu n\'es pas membre'}), 403
    conn = get_db()
    membres = conn.execute('''SELECT users.id, users.prenom, users.nom, users.avatar, gm.role FROM groupe_membres gm
                              JOIN users ON users.id = gm.user_id WHERE gm.groupe_id = ?
                              ORDER BY gm.role = 'admin' DESC, users.prenom''', (id,)).fetchall()
    g = conn.execute('SELECT id, nom, description FROM groupes WHERE id = ?', (id,)).fetchone()
    conn.close()
    return jsonify({'groupe': dict(g) if g else None, 'membres': [dict(m) for m in membres],
                    'je_suis_admin': est_admin_groupe(id, user_id)})

@app.route('/api/groupes/<int:id>', methods=['PUT'])
def api_modifier_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not est_admin_groupe(id, user_id):
        return jsonify({'error': 'Reserve aux admins du groupe'}), 403
    data = request.get_json(silent=True) or {}
    nom = sanitize_text(str(data.get('nom') or ''), 100)
    if not nom:
        return jsonify({'error': 'Nom du groupe requis'}), 400
    conn = get_db()
    conn.execute('UPDATE groupes SET nom = ?, description = ? WHERE id = ?', (nom, sanitize_text(str(data.get('description') or ''), 500), id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Groupe modifie'})

@app.route('/api/groupes/<int:id>/membres/<int:uid>/<action>', methods=['POST'])
def api_gerer_membre(id, uid, action):
    """action : retirer | admin (nommer admin) | membre (retirer le role admin)."""
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    if not est_admin_groupe(id, user_id):
        return jsonify({'error': 'Reserve aux admins du groupe'}), 403
    if uid == user_id or action not in ('retirer', 'admin', 'membre') or not est_membre_groupe(id, uid):
        return jsonify({'error': 'Action impossible'}), 400
    conn = get_db()
    if action == 'retirer':
        conn.execute('DELETE FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, uid))
    else:
        conn.execute('UPDATE groupe_membres SET role = ? WHERE groupe_id = ? AND user_id = ?', (action, id, uid))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Fait'})

@app.route('/api/groupes/<int:id>/messages/<int:mid>', methods=['DELETE'])
def api_supprimer_message_groupe(id, mid):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    m = conn.execute('SELECT user_id, image, audio FROM groupe_messages WHERE id = ? AND groupe_id = ?', (mid, id)).fetchone()
    conn.close()
    if not m:
        return jsonify({'error': 'Message introuvable'}), 404
    if m['user_id'] != user_id and not est_admin_groupe(id, user_id):
        return jsonify({'error': 'Non autorise'}), 403
    conn = get_db()
    conn.execute('DELETE FROM groupe_messages WHERE id = ?', (mid,))
    conn.commit()
    conn.close()
    for f in (m['image'], m['audio']):
        if f:
            supprimer_fichier('static/uploads/' + f)
    diffuser_message_groupe(id, user_id)
    return jsonify({'message': 'Message supprime'})

@app.route('/api/groupes/<int:id>/quitter', methods=['POST'])
def api_quitter_groupe(id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    conn.execute('DELETE FROM groupe_membres WHERE groupe_id = ? AND user_id = ?', (id, user_id))
    # plus aucun admin : le plus ancien membre le devient
    if not conn.execute("SELECT 1 FROM groupe_membres WHERE groupe_id = ? AND role = 'admin'", (id,)).fetchone():
        suivant = conn.execute('SELECT user_id FROM groupe_membres WHERE groupe_id = ? ORDER BY id LIMIT 1', (id,)).fetchone()
        if suivant:
            conn.execute("UPDATE groupe_membres SET role = 'admin' WHERE groupe_id = ? AND user_id = ?", (id, suivant['user_id']))
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
    if not isinstance(data, dict):
        return
    try:
        destinataire_id = int(data.get('destinataire_id'))
    except (TypeError, ValueError):
        return
    contenu = sanitize_text(str(data.get('contenu') or ''), FIELD_MAXLEN['message'])
    if not contenu or destinataire_id == session['user_id'] or trop_rapide('message', session['user_id'], 30, 60):
        return
    if not peut_ecrire(session['user_id'], destinataire_id):
        return

    conn = get_db()
    if not conn.execute('SELECT 1 FROM users WHERE id = ?', (destinataire_id,)).fetchone():
        conn.close()
        return
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
    try:
        destinataire_id = int((data or {}).get('destinataire_id'))
    except (TypeError, ValueError, AttributeError):
        return
    if destinataire_id != session['user_id'] and not blocage_entre(session['user_id'], destinataire_id):
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
