import requests
TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# Try to execute a bash command on PythonAnywhere to find old db files
url = f'https://www.pythonanywhere.com/api/v0/user/{USER}/consoles/'
r = requests.get(url, headers={'Authorization': f'Token {TOKEN}'})
print(f'Consoles: {r.status_code}')
print(r.text[:2000])
