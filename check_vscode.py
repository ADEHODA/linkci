import sqlite3
import os

# Check the VS Code workspace state database
ws_path = os.path.expanduser(r'~\AppData\Roaming\Code\User\workspaceStorage\8f8d3c6fb18e0bd4d9936381a6fd83df')
state_db = os.path.join(ws_path, 'state.vscdb')

if os.path.exists(state_db):
    print('state.vscdb trouve, taille:', os.path.getsize(state_db))
    try:
        conn = sqlite3.connect(state_db)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        print('Tables:', [t[0] for t in tables])
        
        # Look for any content with sondage data
        for t in tables:
            name = t[0]
            try:
                # Check if table has any linkci or sondage content
                cols = conn.execute(f'PRAGMA table_info("{name}")').fetchall()
                col_names = [c[1] for c in cols]
                print(f'\nTable: {name} (cols: {col_names})')
                
                # For value-based tables, check content
                if 'value' in col_names:
                    rows = conn.execute(f'SELECT * FROM "{name}" LIMIT 20').fetchall()
                    for row in rows:
                        row_dict = dict(zip(col_names, row))
                        val_str = str(row_dict)
                        if 'linkci' in val_str.lower() or 'sondage' in val_str.lower() or 'interesse' in val_str.lower():
                            print(f'  >>> MATCH: {row_dict}')
            except:
                pass
        conn.close()
    except Exception as e:
        print('Erreur:', e)
else:
    print('state.vscdb non trouve')
    
    # Check backup
    backup_db = os.path.join(ws_path, 'state.vscdb.backup')
    if os.path.exists(backup_db):
        print('state.vscdb.backup trouve, taille:', os.path.getsize(backup_db))
    else:
        print('state.vscdb.backup non trouve non plus')
