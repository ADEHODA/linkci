import os, uuid, io
import sqlite3
import hashlib
import bcrypt
from datetime import datetime, date, timedelta
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
app.secret_key = os.urandom(24).hex()
socketio = SocketIO(app, cors_allowed_origins="*")

# Rate limiting (in-memory)
from collections import defaultdict
import time
rate_limits = defaultdict(list)
RATE_WINDOW = 60  # seconds
RATE_MAX = 10     # max requests per window

def check_rate_limit(key, max_reqs=RATE_MAX, window=RATE_WINDOW):
    now = time.time()
    timestamps = rate_limits[key]
    # Clean old entries
    rate_limits[key] = [t for t in timestamps if now - t < window]
    if len(rate_limits[key]) >= max_reqs:
        return False
    rate_limits[key].append(now)
    return True

DB_PATH = os.path.join(os.path.dirname(__file__), 'linkci.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

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
    ''')
    conn.commit()
    conn.close()

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
        nom = request.form['nom']
        prenom = request.form['prenom']
        email = request.form['email']
        mot_de_passe = hash_password(request.form['mot_de_passe'])
        universite = request.form.get('universite', '')
        filiere = request.form.get('filiere', '')
        annee = request.form.get('annee', '')

        conn = get_db()
        try:
            conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                         (nom, prenom, email, mot_de_passe, universite, filiere, annee))
            conn.commit()
            flash('Compte cree ! Connecte-toi.', 'success')
            return redirect(url_for('connexion'))
        except sqlite3.IntegrityError:
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
        email = request.form['email']
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        if user and not check_password(request.form['mot_de_passe'], user['mot_de_passe']):
            user = None
        elif user and not user['mot_de_passe'].startswith('$2'):
            nouveau = hash_password(request.form['mot_de_passe'])
            conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
            conn.commit()
        conn.close()

        if user:
            session['user_id'] = user['id']
            session['user_nom'] = user['prenom'] + ' ' + user['nom']
            session['user_email'] = user['email']
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

@app.route('/mot_de_passe_oublie', methods=['GET', 'POST'])
def mot_de_passe_oublie():
    if request.method == 'POST':
        email = request.form.get('email', '').strip()
        conn = get_db()
        user = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if user:
            token = uuid.uuid4().hex
            expire = datetime.now() + timedelta(hours=1)
            conn.execute('INSERT INTO reset_tokens (user_id, token, expire) VALUES (?, ?, ?)',
                         (user['id'], token, expire.strftime('%Y-%m-%d %H:%M:%S')))
            conn.commit()
            lien = url_for('reinitialiser', token=token, _external=True)
            flash(f"Un lien de réinitialisation a ete genere. Clique ici : {lien}", 'success')
        else:
            flash('Aucun compte trouve avec cet email.', 'error')
        conn.close()
        return redirect(url_for('connexion'))
    return render_template('mot_de_passe_oublie.html')

@app.route('/reinitialiser/<token>', methods=['GET', 'POST'])
def reinitialiser(token):
    conn = get_db()
    rt = conn.execute('SELECT * FROM reset_tokens WHERE token = ? AND utilise = 0 AND expire > ?',
                      (token, datetime.now().strftime('%Y-%m-%d %H:%M:%S'))).fetchone()
    if not rt:
        conn.close()
        flash('Lien invalide ou expire.', 'error')
        return redirect(url_for('connexion'))
    if request.method == 'POST':
        mdp = request.form.get('mot_de_passe', '')
        if len(mdp) < 6:
            flash('Mot de passe trop court (min 6 caracteres).', 'error')
            return render_template('reinitialiser.html', token=token)
        nouveau = hash_password(mdp)
        conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, rt['user_id']))
        conn.execute('UPDATE reset_tokens SET utilise = 1 WHERE id = ?', (rt['id'],))
        conn.commit()
        conn.close()
        flash('Mot de passe reinitialise ! Connecte-toi.', 'success')
        return redirect(url_for('connexion'))
    conn.close()
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
    conn.close()

    return render_template('feed.html', posts=posts)

@app.route('/publier', methods=['POST'])
def publier():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = request.form['contenu']
    if contenu.strip():
        conn = get_db()
        conn.execute('INSERT INTO posts (user_id, contenu) VALUES (?, ?)',
                     (session['user_id'], contenu))
        conn.commit()
        conn.close()
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
    except sqlite3.IntegrityError:
        conn.execute('DELETE FROM likes WHERE user_id = ? AND post_id = ?',
                     (session['user_id'], post_id))
        conn.commit()
    conn.close()
    return redirect(url_for('feed'))

@app.route('/commenter/<int:post_id>', methods=['POST'])
def commenter(post_id):
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    contenu = request.form['contenu']
    if contenu.strip():
        conn = get_db()
        conn.execute('INSERT INTO commentaires (user_id, post_id, contenu) VALUES (?, ?, ?)',
                     (session['user_id'], post_id, contenu))
        conn.commit()
        conn.close()
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
    conn.close()
    return render_template('profil.html', user=user, posts=posts, nb_posts=nb_posts, nb_likes_recus=nb_likes_recus, nb_commentaires_recus=nb_commentaires_recus, nb_bourses=nb_bourses, nb_docs=nb_docs)

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
    contenu = request.form.get('contenu', '').strip()
    if contenu:
        conn = get_db()
        conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                     (session['user_id'], destinataire_id, contenu))
        conn.commit()
        conn.close()
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

@app.route('/profil/modifier', methods=['GET', 'POST'])
def modifier_profil():
    if 'user_id' not in session:
        return redirect(url_for('connexion'))
    conn = get_db()
    if request.method == 'POST':
        prenom = request.form.get('prenom', '').strip()
        nom = request.form.get('nom', '').strip()
        universite = request.form.get('universite', '')
        filiere = request.form.get('filiere', '')
        annee = request.form.get('annee', '')
        bio = request.form.get('bio', '')
        avatar = request.files.get('avatar')
        if prenom and nom:
            avatar_nom = None
            if avatar and avatar.filename:
                ext = os.path.splitext(avatar.filename)[1].lower()
                if ext in ('.png', '.jpg', '.jpeg', '.gif'):
                    uploads = os.path.join(app.root_path, 'static', 'avatars')
                    os.makedirs(uploads, exist_ok=True)
                    avatar_nom = f"user_{session['user_id']}{ext}"
                    avatar.save(os.path.join(uploads, avatar_nom))
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
        titre = request.form.get('titre', '').strip()
        description = request.form.get('description', '').strip()
        matiere = request.form.get('matiere', '').strip()
        universite = request.form.get('universite', '').strip()
        fichier = request.files.get('fichier')
        if not titre or not fichier or fichier.filename == '':
            flash('Titre et fichier requis', 'error')
            return redirect(url_for('ajouter_document'))
        ext = os.path.splitext(fichier.filename)[1].lower()
        if ext not in ('.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.zip', '.rar', '.png', '.jpg', '.jpeg'):
            flash('Format non autorise (PDF, Word, PowerPoint, TXT, ZIP, images)', 'error')
            return redirect(url_for('ajouter_document'))
        uploads = os.path.join(app.root_path, 'uploads')
        os.makedirs(uploads, exist_ok=True)
        nom_fichier = f"{uuid.uuid4().hex}{ext}"
        fichier.save(os.path.join(uploads, nom_fichier))
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
    if not os.path.exists(chemin):
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
        WHERE (prenom || ' ' || nom LIKE ? OR email LIKE ?) AND id != ?
        LIMIT 10
    ''', ('%' + q + '%', '%' + q + '%', session['user_id'])).fetchall()
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
        resultats['posts'] = [dict(r) for r in conn.execute('''
            SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
            FROM posts JOIN users ON posts.user_id = users.id
            WHERE posts.contenu LIKE ? ORDER BY posts.date_post DESC LIMIT 10
        ''', ('%' + q + '%',)).fetchall()]
        resultats['bourses'] = [dict(r) for r in conn.execute('''
            SELECT id, titre, organisme, type FROM bourses
            WHERE titre LIKE ? OR description LIKE ? OR organisme LIKE ?
            ORDER BY date_publication DESC LIMIT 10
        ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
        resultats['formations'] = [dict(r) for r in conn.execute('''
            SELECT id, nom, universite, niveau FROM formations
            WHERE nom LIKE ? OR description LIKE ? OR universite LIKE ?
            LIMIT 10
        ''', ('%' + q + '%', '%' + q + '%', '%' + q + '%')).fetchall()]
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
        resultats['posts'] = [dict(r) for r in conn.execute('''
            SELECT posts.id, posts.contenu, posts.date_post, users.prenom, users.nom
            FROM posts JOIN users ON posts.user_id = users.id
            WHERE posts.contenu LIKE ? ORDER BY posts.date_post DESC LIMIT 5
        ''', ('%' + q + '%',)).fetchall()]
        resultats['bourses'] = [dict(r) for r in conn.execute('''
            SELECT id, titre, organisme, type FROM bourses
            WHERE titre LIKE ? OR description LIKE ? LIMIT 5
        ''', ('%' + q + '%', '%' + q + '%')).fetchall()]
        resultats['formations'] = [dict(r) for r in conn.execute('''
            SELECT id, nom, universite, niveau FROM formations
            WHERE nom LIKE ? OR description LIKE ? LIMIT 5
        ''', ('%' + q + '%', '%' + q + '%')).fetchall()]
        resultats['users'] = [dict(r) for r in conn.execute('''
            SELECT id, prenom, nom, filiere FROM users
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
    conn.execute('UPDATE bourses SET expiree = 1 WHERE deadline != "" AND deadline < ? AND expiree = 0', (aujourdhui,))
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
        conn = get_db()
        conn.execute('INSERT INTO bourses (titre, organisme, description, montant, type, cible, deadline, lien, pays) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (request.form['titre'], request.form['organisme'], request.form['description'],
             request.form.get('montant', ''), request.form['type'],
             request.form.get('cible', ''), request.form.get('deadline', ''),
             request.form.get('lien', ''), request.form.get('pays', "Cote d'Ivoire")))
        conn.commit()
        conn.close()
        notifier_tous('bourse', f"Nouvelle bourse : {request.form['titre']}", "/bourses")
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
        conn = get_db()
        conn.execute('INSERT INTO formations (nom, universite, niveau, description, duree, debouches, frais, site_web) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (request.form['nom'], request.form['universite'], request.form['niveau'],
             request.form.get('description', ''), request.form.get('duree', ''),
             request.form.get('debouches', ''), request.form.get('frais', ''),
             request.form.get('site_web', '')))
        conn.commit()
        conn.close()
        notifier_tous('formation', 'Nouvelle formation disponible : ' + request.form['nom'], '/formations')
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
    titre = request.form.get('titre', '').strip()
    description = request.form.get('description', '').strip()
    date_event = request.form.get('date_event', '').strip()
    lieu = request.form.get('lieu', '').strip()
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
    nom = request.form.get('nom', '').strip()
    description = request.form.get('description', '').strip()
    universite = request.form.get('universite', '').strip()
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
    contenu = request.form.get('contenu', '').strip()
    if contenu:
        conn = get_db()
        conn.execute('INSERT INTO groupe_messages (groupe_id, user_id, contenu) VALUES (?, ?, ?)',
                     (id, session['user_id'], contenu))
        conn.commit()
        conn.close()
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
    if not user or user['email'] not in ('admin@linkci.ci', 'qasade@gmail.com'):
        flash('Acces reserve', 'error')
        return redirect(url_for('feed'))
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
    if not user or user['email'] not in ('admin@linkci.ci', 'qasade@gmail.com'):
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

# ===================== EXPORT CSV =====================
@app.route('/sondage/export')
def export_sondage_csv():
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
    token = auth[7:]
    if not token:
        return None
    parts = token.split(':')
    if len(parts) != 2:
        return None
    user_id, sig = parts
    expected = hashlib.sha256(f"{user_id}:{API_SECRET}".encode()).hexdigest()[:16]
    if sig != expected:
        return None
    return int(user_id)

def api_token(user_id):
    sig = hashlib.sha256(f"{user_id}:{API_SECRET}".encode()).hexdigest()[:16]
    return f"{user_id}:{sig}"

@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.json
    if not data:
        return jsonify({'error': 'JSON requis'}), 400
    nom = data.get('nom', '').strip()
    prenom = data.get('prenom', '').strip()
    email = data.get('email', '').strip()
    mot_de_passe = data.get('mot_de_passe', '')
    if not all([nom, prenom, email, mot_de_passe]):
        return jsonify({'error': 'Champs requis : nom, prenom, email, mot_de_passe'}), 400
    conn = get_db()
    try:
        conn.execute('INSERT INTO users (nom, prenom, email, mot_de_passe, universite, filiere, annee) VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (nom, prenom, email, hash_password(mot_de_passe),
                      data.get('universite', ''), data.get('filiere', ''), data.get('annee', '')))
        conn.commit()
        user = conn.execute('SELECT id, nom, prenom, email, universite, filiere FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        return jsonify({'token': api_token(user['id']), 'user': dict(user)}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Email deja utilise'}), 409

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.json
    if not data:
        return jsonify({'error': 'JSON requis'}), 400
    email = data.get('email', '').strip()
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    if not user or not check_password(data.get('mot_de_passe', ''), user['mot_de_passe']):
        conn.close()
        return jsonify({'error': 'Email ou mot de passe incorrect'}), 401
    if not user['mot_de_passe'].startswith('$2'):
        nouveau = hash_password(data.get('mot_de_passe', ''))
        conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (nouveau, user['id']))
        conn.commit()
    conn.close()
    return jsonify({'token': api_token(user['id']), 'user': dict(user)})

@app.route('/api/me')
def api_me():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    user = conn.execute('SELECT id, nom, prenom, email, universite, filiere, annee, bio, date_inscription FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if not user:
        return jsonify({'error': 'Utilisateur introuvable'}), 404
    return jsonify(dict(user))

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
        SELECT posts.id, posts.user_id, posts.contenu, posts.date_post,
               users.prenom, users.nom, users.universite,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires,
               EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) as a_like
        FROM posts JOIN users ON posts.user_id = users.id
        ORDER BY posts.date_post DESC LIMIT ? OFFSET ?
    ''', (user_id, per_page, offset)).fetchall()
    conn.close()
    return jsonify([dict(p) for p in posts])

@app.route('/api/posts', methods=['POST'])
def api_create_post():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    data = request.json
    if not data or not data.get('contenu', '').strip():
        return jsonify({'error': 'Contenu requis'}), 400
    conn = get_db()
    conn.execute('INSERT INTO posts (user_id, contenu) VALUES (?, ?)', (user_id, data['contenu'].strip()))
    conn.commit()
    post_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
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
    except sqlite3.IntegrityError:
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
               users.prenom, users.nom
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
    conn = get_db()
    conn.execute('INSERT INTO commentaires (user_id, post_id, contenu) VALUES (?, ?, ?)',
                 (user_id, post_id, data['contenu'].strip()))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Commente'}), 201

@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
def api_delete_post(post_id):
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    post = conn.execute('SELECT user_id FROM posts WHERE id = ?', (post_id,)).fetchone()
    if not post or post['user_id'] != user_id:
        conn.close()
        return jsonify({'error': 'Non autorise'}), 403
    conn.execute('DELETE FROM commentaires WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM likes WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Supprime'})

@app.route('/api/bourses')
def api_bourses():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    from datetime import date
    aujourdhui = date.today().isoformat()
    conn = get_db()
    conn.execute('UPDATE bourses SET expiree = 1 WHERE deadline != "" AND deadline < ? AND expiree = 0', (aujourdhui,))
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
    conn = get_db()
    conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                 (user_id, data['destinataire_id'], data['contenu'].strip()))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Envoye'}), 201

@app.route('/api/conversations')
def api_conversations():
    user_id = api_require_auth()
    if not user_id:
        return jsonify({'error': 'Non authentifie'}), 401
    conn = get_db()
    convs = conn.execute('''
        SELECT DISTINCT
            CASE WHEN expediteur_id = ? THEN destinataire_id ELSE expediteur_id END as autre_id,
            users.prenom, users.nom, users.universite,
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
    user = conn.execute('SELECT id, nom, prenom, email, universite, filiere, annee, bio, date_inscription FROM users WHERE id = ?', (autre_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'Introuvable'}), 404
    posts = conn.execute('''
        SELECT id, contenu, date_post,
               (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as nb_likes,
               (SELECT COUNT(*) FROM commentaires WHERE commentaires.post_id = posts.id) as nb_commentaires
        FROM posts WHERE user_id = ? ORDER BY date_post DESC
    ''', (autre_id,)).fetchall()
    conn.close()
    return jsonify({'user': dict(user), 'posts': [dict(p) for p in posts]})

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

# ===================== SOCKETIO (chat temps reel) =====================
@socketio.on('connect')
def handle_connect():
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
    conn.execute('INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES (?, ?, ?)',
                 (session['user_id'], destinataire_id, contenu))
    conn.commit()
    msg_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.close()

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
    resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return resp

init_db()

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
