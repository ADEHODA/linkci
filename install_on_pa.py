import requests
TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# Create a console and install flask-socketio
url = 'https://www.pythonanywhere.com/api/v0/user/' + USER + '/consoles/'
r = requests.post(url, headers={'Authorization': 'Token ' + TOKEN}, data={
    'executable': 'bash',
    'arguments': 'pip3 install --user flask-socketio flask-cors'
})
print('Status:', r.status_code)
print(r.text[:500])
