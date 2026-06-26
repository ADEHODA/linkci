#!/usr/bin/env python3
"""
SCRIPT DE DEPLOIEMENT LINK CI SUR PYTHONANYWHERE
"""
import requests
import sys
import os
import time
import base64

API_BASE = "https://www.pythonanywhere.com/api/v0"

def deploy(username, api_token):
    headers = {"Authorization": f"Token {api_token}"}

    # 1. Créer le répertoire linkci
    print("Creation du dossier linkci...")
    r = requests.post(
        f"{API_BASE}/users/{username}/files/tree/home/{username}/linkci/",
        headers=headers
    )

    files_to_upload = []
    base = r"C:\Users\lenovo\Documents\linkci"

    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.py') or f.endswith('.html') or f.endswith('.css') or f.endswith('.js') or f.endswith('.txt'):
                full_path = os.path.join(root, f)
                relative = os.path.relpath(full_path, base)
                pa_path = f"/home/{username}/linkci/{relative.replace(os.sep, '/')}"
                files_to_upload.append((full_path, pa_path))

    print(f"Upload de {len(files_to_upload)} fichiers...")
    for local_path, pa_path in files_to_upload:
        with open(local_path, 'r', encoding='utf-8') as f:
            content = f.read()

        r = requests.put(
            f"{API_BASE}/users/{username}/files/path{pa_path}",
            headers=headers,
            data=content
        )
        if r.status_code == 201:
            print(f"  OK: {os.path.basename(local_path)}")
        else:
            print(f"  Erreur {r.status_code}: {os.path.basename(local_path)}")

    # 2. Installer les dépendances via console
    print("\nInstallation des dependances...")
    r = requests.post(
        f"{API_BASE}/users/{username}/consoles/",
        headers=headers,
        data={
            "executable": "bash",
            "arguments": "pip install flask flask-cors bcrypt python-dotenv waitress"
        }
    )

    # 3. Configurer le WSGI
    wsgi_content = f"""
import sys
sys.path.insert(0, '/home/{username}/linkci')
from app import app as application
"""
    print("\nConfiguration WSGI...")
    r = requests.put(
        f"{API_BASE}/users/{username}/files/path/home/{username}/linkci/wsgi_config.txt",
        headers=headers,
        data=wsgi_content.strip()
    )

    # 4. Créer le web app
    print("Creation de l'application web...")
    r = requests.post(
        f"{API_BASE}/users/{username}/webapps/",
        headers=headers,
        data={
            "domain_name": f"{username}.pythonanywhere.com",
            "python_version": "3.12"
        }
    )
    if r.status_code == 201:
        print(f"  App creee sur https://{username}.pythonanywhere.com")
    elif r.status_code == 409:
        print("  L'app existe deja, mise a jour...")
    else:
        print(f"  Status: {r.status_code} - {r.text[:100]}")

    # 5. Reload
    print("Redemarrage...")
    r = requests.post(
        f"{API_BASE}/users/{username}/webapps/{username}.pythonanywhere.com/reload/",
        headers=headers
    )

    print("\n" + "=" * 50)
    print(f"LINK CI EST EN LIGNE !")
    print(f"Sondage : https://{username}.pythonanywhere.com/sondage")
    print(f"Resultats : https://{username}.pythonanywhere.com/sondage/resultats")
    print(f"Partage ces liens sur WhatsApp !")
    print("=" * 50)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python deploy.py <username> <api_token>")
        sys.exit(1)
    deploy(sys.argv[1], sys.argv[2])
