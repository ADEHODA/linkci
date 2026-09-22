import requests
import os
from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = 'qasade'

# Create a console and install flask-socketio
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/consoles/'
r = requests.post(url, headers={'Authorization': 'Token ' + TOKEN}, data={
    'executable': 'bash',
    'arguments': 'pip3 install --user flask-socketio flask-cors'
})
print('Status:', r.status_code)
print(r.text[:500])
