import sqlite3
import hashlib
import bcrypt

DB_PATH = r'C:\Users\lenovo\Documents\linkci\linkci.db'

def migrate():
    conn = sqlite3.connect(DB_PATH)
    users = conn.execute('SELECT id, mot_de_passe FROM users').fetchall()
    migrated = 0
    for uid, pwd in users:
        if pwd and not pwd.startswith('$2'):
            new_hash = bcrypt.hashpw(hashlib.sha256(pwd.encode()).hexdigest().encode(), bcrypt.gensalt()).decode()
            conn.execute('UPDATE users SET mot_de_passe = ? WHERE id = ?', (new_hash, uid))
            migrated += 1
            print(f'Migrated user {uid}: {pwd[:20]}... -> bcrypt')
    conn.commit()
    conn.close()
    print(f'Done: {migrated} passwords migrated')

if __name__ == '__main__':
    migrate()
