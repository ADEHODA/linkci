import requests
import os
from dotenv import load_dotenv
load_dotenv()
TOKEN = os.environ['PA_API_TOKEN']  # dans .env, jamais dans le code
USER = 'qasade'

# Try to execute a bash command on PythonAnywhere to find old db files
url = f'https://www.pythonanywhere.com/api/v0/user/{USER}/consoles/'
r = requests.get(url, headers={'Authorization': f'Token {TOKEN}'})
print(f'Consoles: {r.status_code}')
print(r.text[:2000])
