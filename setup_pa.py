import requests

import os
from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = 'qasade'
BASE = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/files/path/home/' + USER + '/linkci'

# Upload setup script
script = '#!/bin/bash\npip3 install --user flask-socketio flask-cors\n'
url = BASE + '/setup_pa.sh'
r = requests.post(url, headers={'Authorization': 'Token ' + TOKEN}, files={'content': ('setup_pa.sh', script)})
print('Setup script:', r.status_code)

# Update requirements.txt
req_text = 'flask\nbcrypt\nflask-socketio\nflask-cors\n'
url2 = BASE + '/requirements.txt'
r2 = requests.post(url2, headers={'Authorization': 'Token ' + TOKEN}, files={'content': ('requirements.txt', req_text)})
print('Requirements:', r2.status_code)

print('\nMaintenant va sur PythonAnywhere > Consoles > Bash')
print('Et tape: cd ~/linkci && bash setup_pa.sh')
print('Puis: Web app > Reload (ou clique sur le bouton vert)')
