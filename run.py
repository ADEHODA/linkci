import subprocess
import threading
import time
import re
import sys
import os

os.chdir(os.path.dirname(__file__))

LOG = os.path.join(os.environ.get('TEMP', '.'), 'linkci_tunnel.log')

def log(msg):
    with open(LOG, 'a') as f:
        f.write(str(msg) + '\n')
    print(msg)

def start_flask():
    import app
    app.init_db()
    log("Flask demarre sur 127.0.0.1:5000")
    app.socketio.run(app.app, host='127.0.0.1', port=5000, debug=False, allow_unsafe_werkzeug=True)

def start_tunnel():
    time.sleep(2)
    services = [
        {
            "name": "serveo.net",
            "cmd": ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30", "-R", "80:localhost:5000", "serveo.net"],
            "pattern": r'https://[a-zA-Z0-9-]+\.serveousercontent\.com'
        },
        {
            "name": "localhost.run",
            "cmd": ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30", "-R", "80:localhost:5000", "nokey@localhost.run"],
            "pattern": r'https://[a-zA-Z0-9-]+\.lhr\.life'
        }
    ]

    for service in services:
        log(f"Tentative avec {service['name']}...")
        try:
            proc = subprocess.Popen(
                service["cmd"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            started = time.time()
            while time.time() - started < 20:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                log(line)
                match = re.search(service["pattern"], line)
                if match:
                    url = match.group(0)
                    log("=" * 60)
                    log(f"  TUNNEL ACTIF avec {service['name']}!")
                    log(f"  Sondage : {url}/sondage")
                    log(f"  Resultats : {url}/sondage/resultats")
                    log(f"  Envoie ces liens sur WhatsApp !")
                    log("=" * 60)
                    # Keep reading
                    for remaining in proc.stdout:
                        pass
                    return
            proc.terminate()
            log(f"{service['name']} n'a pas fonctionné, essai suivant...")
        except Exception as e:
            log(f"Erreur avec {service['name']}: {e}")

    log("AUCUN tunnel n'a fonctionné!")
    log("Tu peux quand meme utiliser l'app en local: http://localhost:5000")

if __name__ == "__main__":
    log("Demarrage de LINK CI...")
    flask_thread = threading.Thread(target=start_flask, daemon=True)
    flask_thread.start()
    start_tunnel()
