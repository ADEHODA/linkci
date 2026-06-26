import requests
TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# Download migrate_bourses.py to see what it does
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/files/path/home/' + USER + '/linkci/migrate_bourses.py'
r = requests.get(url, headers={'Authorization': 'Token ' + TOKEN})
if r.status_code == 200:
    print('=== migrate_bourses.py ===')
    print(r.text)
else:
    print('Erreur:', r.status_code)

# Check if .pythonanywhere has console history
url2 = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/files/path/home/' + USER + '/.pythonanywhere/'
r2 = requests.get(url2, headers={'Authorization': 'Token ' + TOKEN})
print('\n.pythonanywhere:', r2.status_code)
if r2.status_code == 200:
    print(r2.json())
