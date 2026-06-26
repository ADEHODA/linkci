import requests
import time

TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# First create a bash console
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/consoles/'
r = requests.post(url, headers={'Authorization': 'Token ' + TOKEN}, data={
    'executable': 'bash'
})
print('Console created:', r.status_code)

if r.status_code == 201:
    data = r.json()
    console_id = data.get('id')
    print('Console ID:', console_id)
    
    # Send the pip install command
    send_url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/consoles/' + str(console_id) + '/send/'
    r2 = requests.post(send_url, headers={'Authorization': 'Token ' + TOKEN}, data={
        'data': 'pip3 install --user flask-socketio flask-cors\n'
    })
    print('Send status:', r2.status_code)
    
    # Wait and reload
    time.sleep(5)
    
    reload_url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/webapps/' + USER + '.pythonanywhere.com/reload/'
    r3 = requests.post(reload_url, headers={'Authorization': 'Token ' + TOKEN})
    print('Reload:', r3.status_code)
else:
    print(r.text[:500])
