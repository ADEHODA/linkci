import requests
import os
from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = 'qasade'
url = f'https://www.pythonanywhere.com/api/v0/user/{USER}/files/path/home/{USER}/linkci/'
r = requests.get(url, headers={'Authorization': f'Token {TOKEN}'})
if r.status_code == 200:
    data = r.json()
    print('Fichiers dans linkci/')
    for name, info in data.items():
        print(f'  {name} ({info.get("type", "?")})')
    
    # Look for backup files or old databases
    for name, info in data.items():
        if 'db' in name.lower() or 'backup' in name.lower() or 'old' in name.lower() or 'sauve' in name.lower():
            print(f'  >>> TROUVE: {name}')
    
    # Check home directory for backup files
    print('\nVerification du home directory...')
    url2 = f'https://www.pythonanywhere.com/api/v0/user/{USER}/files/path/home/{USER}/'
    r2 = requests.get(url2, headers={'Authorization': f'Token {TOKEN}'})
    if r2.status_code == 200:
        data2 = r2.json()
        for name, info in data2.items():
            if 'db' in name.lower() or 'backup' in name.lower() or 'old' in name.lower() or 'sauve' in name.lower():
                print(f'  >>> TROUVE: {name}')
        print(f'Dossiers et fichiers dans home/: {list(data2.keys())[:20]}')
    else:
        print(f'Erreur home: {r2.status_code}')
else:
    print(f'Erreur code={r.status_code}')
    print(r.text[:1000])
