import sqlite3
conn = sqlite3.connect('linkci.db')
tables = conn.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
for t in tables:
    print('=== ' + t[0] + ' ===')
    if t[1]:
        print(t[1][:100])
    count = conn.execute('SELECT COUNT(*) FROM "' + t[0] + '"').fetchone()[0]
    print('Lignes: ' + str(count))
    print()
conn.close()
