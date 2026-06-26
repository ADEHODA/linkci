import subprocess
import threading
import time
import re
import sys

def start_tunnel():
    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=30",
        "-R", "80:localhost:5000",
        "nokey@localhost.run"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        print(line.strip())
        match = re.search(r'https://[a-zA-Z0-9-]+\.lhr\.life', line)
        if match:
            url = match.group(0)
            print(f"\n{'='*50}")
            print(f"  LINK CI SUR INTERNET : {url}/sondage")
            print(f"  Partage ce lien sur WhatsApp !")
            print(f"{'='*50}")

if __name__ == "__main__":
    print("Demarrage du tunnel...")
    start_tunnel()
