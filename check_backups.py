import requests

TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

def check_dir(path):
    url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/files/path' + path
    r = requests.get(url, headers={'Authorization': 'Token ' + TOKEN})
    if r.status_code != 200:
        return
    data = r.json()
    if isinstance(data, dict):
        items = list(data.items())
        for name, info in items:
            full = path + '/' + name
            if info.get('type') == 'directory':
                skip = ['__pycache__', 'node_modules', '.git', '.ipython', '.local', '.cache']
                if name not in skip:
                    check_dir(full)
            else:
                low = name.lower()
                if '.db' in low or '.sql' in low or 'backup' in low or '.bak' in low or '.old' in low:
                    print(full + ' (' + str(info.get('size', '?')) + ' bytes)')

print('Recherche de fichiers de base de donnees anciens...')
check_dir('/home/' + USER)
print('Termine')
