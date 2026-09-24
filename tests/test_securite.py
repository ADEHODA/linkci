"""Tests de securite : chaque test tente d'exploiter une faille et verifie qu'elle est fermee."""
import app as linkci_app


def inscrire(client, email, mdp='motdepasse123', **extra):
    client.post('/inscription', data={'nom': 'Test', 'prenom': 'Secu', 'email': email, 'mot_de_passe': mdp, **extra})


def connecter(client, email, mdp='motdepasse123'):
    return client.post('/connexion', data={'email': email, 'mot_de_passe': mdp})


def jeton(client, email, mdp='motdepasse123'):
    r = client.post('/api/register', json={'nom': 'Api', 'prenom': 'Secu', 'email': email, 'mot_de_passe': mdp})
    return r.get_json()['token']


def entete(tok):
    return {'Authorization': 'Bearer ' + tok}


def sql(requete, params=()):
    conn = linkci_app.get_db()
    r = conn.execute(requete, params)
    lignes = r.fetchall() if requete.lstrip().upper().startswith('SELECT') else None
    conn.commit()
    conn.close()
    return lignes


# ---- 1. Administration : s'inscrire avec une adresse "admin" ne donne aucun droit
def test_inscription_avec_ancienne_adresse_admin_sans_droits(client):
    inscrire(client, 'admin@linkci.ci')
    connecter(client, 'admin@linkci.ci')
    r = client.get('/admin')
    assert r.status_code == 302 and '/feed' in r.headers['Location']


def test_role_admin_donne_acces(client):
    inscrire(client, 'vrai.admin@test.ci')
    sql("UPDATE users SET role = 'admin' WHERE email = ?", ('vrai.admin@test.ci',))
    connecter(client, 'vrai.admin@test.ci')
    assert client.get('/admin').status_code == 200


def test_admin_emails_recoit_le_role_au_demarrage(client, monkeypatch):
    inscrire(client, 'Boss@Test.ci')
    monkeypatch.setattr(linkci_app, 'ADMIN_EMAILS', ['boss@test.ci'])
    linkci_app.init_db()
    assert sql('SELECT role FROM users WHERE lower(email) = ?', ('boss@test.ci',))[0]['role'] == 'admin'


# ---- 2. XSS dans les publications
def test_publication_avec_script_echappee(client):
    inscrire(client, 'xss@test.ci')
    connecter(client, 'xss@test.ci')
    client.post('/publier', data={'contenu': '<script>alert(1)</script> salut @Awa'})
    page = client.get('/feed').get_data(as_text=True)
    assert '<script>alert(1)</script>' not in page
    assert '&lt;script&gt;alert(1)&lt;/script&gt;' in page
    assert 'class="mention">@Awa</a>' in page  # les mentions marchent toujours


# ---- 3. Export du sondage
def test_export_sondage_reserve_aux_admins(client):
    assert client.get('/sondage/export').status_code == 302
    inscrire(client, 'curieux@test.ci')
    connecter(client, 'curieux@test.ci')
    assert client.get('/sondage/export').status_code == 302
    assert client.get('/bourses/export').status_code == 302


# ---- 4. Reinitialisation du mot de passe
def test_lien_de_reinitialisation_jamais_affiche(client):
    inscrire(client, 'victime@test.ci')
    r = client.post('/mot_de_passe_oublie', data={'email': 'victime@test.ci'}, follow_redirects=True)
    page = r.get_data(as_text=True)
    assert '/reinitialiser/' not in page
    assert "Si un compte existe" in page
    # meme message pour une adresse inconnue (pas d'enumeration des comptes)
    r2 = client.post('/mot_de_passe_oublie', data={'email': 'inconnu@test.ci'}, follow_redirects=True)
    assert "Si un compte existe" in r2.get_data(as_text=True)
    # le jeton est stocke hache (64 caracteres hexadecimaux), pas en clair
    uid = sql('SELECT id FROM users WHERE email = ?', ('victime@test.ci',))[0]['id']
    stocke = sql('SELECT token FROM reset_tokens WHERE user_id = ?', (uid,))[0]['token']
    assert len(stocke) == 64


def test_reinitialisation_valide_revoque_les_sessions(client, monkeypatch):
    envoyes = []
    monkeypatch.setattr(linkci_app, 'envoyer_email', lambda dest, sujet, texte: envoyes.append(texte) or True)
    tok = jeton(client, 'reset@test.ci')
    assert client.get('/api/me', headers=entete(tok)).status_code == 200
    client.post('/api/forgot_password', json={'email': 'reset@test.ci'})
    lien = [l for l in envoyes[0].split() if '/reinitialiser/' in l][0]
    jeton_reinit = lien.rsplit('/', 1)[1]
    assert client.post('/api/reset_password', json={'token': jeton_reinit, 'mot_de_passe': 'court'}).status_code == 400
    assert client.post('/api/reset_password', json={'token': jeton_reinit, 'mot_de_passe': 'nouveau-mdp-123'}).status_code == 200
    assert client.get('/api/me', headers=entete(tok)).status_code == 401  # ancien jeton revoque
    assert client.post('/api/reset_password', json={'token': jeton_reinit, 'mot_de_passe': 'encore-un-123'}).status_code == 400  # usage unique
    assert client.post('/api/login', json={'email': 'reset@test.ci', 'mot_de_passe': 'nouveau-mdp-123'}).status_code == 200


# ---- 6. Le hash du mot de passe ne sort jamais
def test_connexion_api_ne_renvoie_pas_le_hash(client):
    jeton(client, 'hash@test.ci')
    r = client.post('/api/login', json={'email': 'HASH@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert r.status_code == 200  # email insensible a la casse
    corps = r.get_data(as_text=True)
    assert 'mot_de_passe' not in corps and '$2' not in corps


# ---- 7. Jetons de l'app
def test_jeton_falsifie_ou_ancien_format_refuse(client):
    for faux in ('1:0123456789abcdef', 'eyJ1IjoxLCJ2IjowfQ.faux.faux', ''):
        assert client.get('/api/me', headers=entete(faux)).status_code == 401


def test_compte_banni_perd_l_acces_api(client):
    tok = jeton(client, 'banni@test.ci')
    assert client.get('/api/me', headers=entete(tok)).status_code == 200
    sql('UPDATE users SET banni = 1 WHERE email = ?', ('banni@test.ci',))
    assert client.get('/api/me', headers=entete(tok)).status_code == 401
    assert client.post('/api/login', json={'email': 'banni@test.ci', 'mot_de_passe': 'motdepasse123'}).status_code == 403


# ---- 9. Cookies et en-tetes
def test_cookie_de_session_protege(client):
    inscrire(client, 'cookie@test.ci')
    r = connecter(client, 'cookie@test.ci')
    cookie = r.headers.get('Set-Cookie', '')
    assert 'HttpOnly' in cookie and 'SameSite=Lax' in cookie


def test_entetes_de_securite(client):
    r = client.get('/connexion')
    for h in ('X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Content-Security-Policy'):
        assert h in r.headers


def test_socketio_refuse_les_autres_sites():
    assert '*' not in linkci_app.ORIGINES_AUTORISEES


# ---- 10. Donnees personnelles
def test_email_des_autres_non_expose(client):
    a = jeton(client, 'prive_a@test.ci')
    b = jeton(client, 'prive_b@test.ci')
    id_b = client.get('/api/me', headers=entete(b)).get_json()['id']
    profil = client.get(f'/api/profil/{id_b}', headers=entete(a)).get_json()
    assert 'email' not in profil['user']


def test_mentions_reservees_aux_connectes(client):
    assert client.get('/api/mentions?q=a').status_code == 401


# ---- 11. Notifications push
def test_push_reserve_aux_admins(client):
    tok = jeton(client, 'spam@test.ci')
    r = client.post('/api/send_push', json={'destinataire_id': 1, 'message': 'Gagne un iPhone'}, headers=entete(tok))
    assert r.status_code == 403


# ---- 12. Liens dangereux
def test_lien_javascript_refuse():
    assert linkci_app.lien_sur('javascript:alert(1)') == ''
    assert linkci_app.lien_sur('data:text/html,<script>') == ''
    assert linkci_app.lien_sur('https://campusfrance.org/bourses') == 'https://campusfrance.org/bourses'


# ---- 14. Mot de passe
def test_mot_de_passe_trop_court_refuse(client):
    r = client.post('/api/register', json={'nom': 'a', 'prenom': 'b', 'email': 'court@test.ci', 'mot_de_passe': 'abc123'})
    assert r.status_code == 400


def test_email_en_double_avec_majuscules_refuse(client):
    jeton(client, 'double@test.ci')
    r = client.post('/api/register', json={'nom': 'a', 'prenom': 'b', 'email': 'DOUBLE@test.ci', 'mot_de_passe': 'motdepasse123'})
    assert r.status_code == 409


def test_lien_javascript_deja_en_base_neutralise(client):
    sql("INSERT INTO bourses (titre, organisme, description, type, lien) VALUES ('Piege', 'X', 'd', 'Licence', 'javascript:alert(1)')")
    inscrire(client, 'lecteur@test.ci')
    connecter(client, 'lecteur@test.ci')
    page = client.get('/bourses').get_data(as_text=True)
    assert 'javascript:alert(1)' not in page


def test_envoi_email_par_brevo(monkeypatch):
    appels = []

    class Reponse:
        status_code = 201
        text = '{"messageId": "x"}'

    import requests
    monkeypatch.setattr(requests, 'post', lambda url, **kw: appels.append((url, kw)) or Reponse())
    monkeypatch.setenv('BREVO_API_KEY', 'cle-de-test')
    monkeypatch.setenv('EMAIL_EXPEDITEUR', 'expediteur@test.ci')
    assert linkci_app.envoyer_email('etudiant@test.ci', 'Sujet', 'Texte') is True
    url, kw = appels[0]
    assert url == 'https://api.brevo.com/v3/smtp/email'
    assert kw['headers']['api-key'] == 'cle-de-test'
    assert kw['json']['to'] == [{'email': 'etudiant@test.ci'}] and kw['json']['sender']['email'] == 'expediteur@test.ci'
    monkeypatch.delenv('EMAIL_EXPEDITEUR')
    assert linkci_app.envoyer_email('etudiant@test.ci', 'Sujet', 'Texte') is False  # expediteur obligatoire


def test_envoi_document_depuis_l_app(client):
    import io
    tok = jeton(client, 'doc_app@test.ci')
    h = entete(tok)
    ok = client.post('/api/documents', headers=h, content_type='multipart/form-data',
                     data={'titre': 'Cours de reseaux', 'matiere': 'Reseaux', 'fichier': (io.BytesIO(b'%PDF-1.7 cours'), 'cours.pdf')})
    assert ok.status_code == 201
    faux = client.post('/api/documents', headers=h, content_type='multipart/form-data',
                       data={'titre': 'Piege', 'fichier': (io.BytesIO(b'<html><script>alert(1)</script>'), 'cours.pdf')})
    assert faux.status_code == 400 and 'format' in faux.get_json()['error']
    exe = client.post('/api/documents', headers=h, content_type='multipart/form-data',
                      data={'titre': 'Virus', 'fichier': (io.BytesIO(b'MZ\x90\x00'), 'jeu.exe')})
    assert exe.status_code == 400
    docs = client.get('/api/documents', headers=h).get_json()
    doc = next(d for d in docs if d['id'] == ok.get_json()['id'])
    assert doc['matiere'] == 'Reseaux'
    linkci_app.supprimer_fichier('uploads/' + doc['fichier'])
