import requests
TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# List all consoles on PythonAnywhere
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/consoles/'
r = requests.get(url, headers={'Authorization': 'Token ' + TOKEN})
print('Status:', r.status_code)
if r.status_code == 200:
    data = r.json()
    print('Consoles:', len(data))
    for c in data:
        print(c)
else:
    print(r.text[:1000])

# Try to get the web app info
url2 = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/webapps/'
r2 = requests.get(url2, headers={'Authorization': 'Token ' + TOKEN})
print('\nWebapps status:', r2.status_code)
if r2.status_code == 200:
    print(r2.json())
else:
    print(r2.text[:1000])
