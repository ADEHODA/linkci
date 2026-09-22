import requests
import os
from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = 'qasade'

# Get the list of files in the linkci directory to see file metadata
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/files/path/home/' + USER + '/linkci/'
r = requests.get(url, headers={'Authorization': 'Token ' + TOKEN})
data = r.json()

# Show db file info
if 'linkci.db' in data:
    info = data['linkci.db']
    print('=== FICHIER linkci.db ===')
    print('Type:', info.get('type'))
    print('Taille:', info.get('size'), 'bytes')
    print('Mtime:', info.get('mtime'))
    print('URL:', info.get('url'))

# Also check when the templates were last modified
print('\n=== DERNIERS FICHIERS MODIFIES ===')
files = []
for name, info in data.items():
    if info.get('type') == 'file' and 'mtime' in info:
        files.append((name, info['mtime']))
files.sort(key=lambda x: x[1], reverse=True)
for name, mtime in files[:10]:
    print(name, ':', mtime)
