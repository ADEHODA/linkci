import requests
TOKEN = 'ce70c0101a10765b13b4ee231ecf8cdb68572f32'
USER = 'qasade'

# Check API for schemas/tables info in current db
import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'linkci.db')
conn = sqlite3.connect(db_path)

# Check the sondage table schema
schema = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='sondages'").fetchone()
print('=== Schema table sondages ===')
print(schema[0] if schema else 'TABLE NOT FOUND')

# Check all sondage entries with their rowid
rows = conn.execute("SELECT rowid, * FROM sondages ORDER BY rowid").fetchall()
print('\n=== Contenu complet ===')
for r in rows:
    print(r)

# Check the sequence (auto-increment) value
seq = conn.execute("SELECT * FROM sqlite_sequence WHERE name='sondages'").fetchone()
print('\n=== Auto-increment sequence ===')
print(seq)

conn.close()
