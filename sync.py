"""Sync LINK CI: local -> PythonAnywhere
Usage: python sync.py
"""
import os, sys, requests

from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = "qasade"
PROJ = os.path.dirname(os.path.abspath(__file__))
BASE = f"https://www.pythonanywhere.com/api/v0/user/{USER}/files/path/home/{USER}/linkci"

FILES = [
    "app.py", "run.py", "static/css/style.css", "static/js/app.js",
    "static/js/main.js", "static/images/logo.svg", "static/images/favicon.svg",
]
TEMPLATES = [
    "index.html", "feed.html", "connexion.html", "inscription.html",
    "profil.html", "modifier_profil.html", "messagerie.html",
    "bourses.html", "ajouter_bourse.html", "formations.html",
    "ajouter_formation.html", "detail_formation.html",
    "documents.html", "notifications.html",
    "sondage.html", "sondage_resultats.html",
    "documents.html", "ajouter_document.html",
    "mot_de_passe_oublie.html", "reinitialiser.html",
    "recherche.html",
    "admin.html", "calendrier.html", "groupes.html", "discussion_groupe.html",
]

def upload(local_path, remote_url):
    with open(local_path, 'r', encoding='utf-8') as f:
        r = requests.post(remote_url,
            headers={'Authorization': f'Token {TOKEN}'},
            files={'content': ('file', f.read())})
    ok = "OK" if r.status_code in (200, 201) else "ERR"
    rel = os.path.relpath(local_path, PROJ)
    print(f"  {ok}  {rel} ({r.status_code})")

print("=== Synchronisation LINK CI ===")

for f in FILES:
    local = os.path.join(PROJ, *f.split('/'))
    if os.path.exists(local):
        upload(local, f"{BASE}/{f}")

for t in TEMPLATES:
    local = os.path.join(PROJ, "templates", t)
    if os.path.exists(local):
        upload(local, f"{BASE}/templates/{t}")

print("\nRechargement...")
r = requests.post(
    f"https://www.pythonanywhere.com/api/v0/user/{USER}/webapps/{USER}.pythonanywhere.com/reload/",
    headers={'Authorization': f'Token {TOKEN}'})
print(f"  {'OK' if r.status_code == 200 else 'ERR'} ({r.status_code})")

print(f"\nTermine ! https://{USER}.pythonanywhere.com")
