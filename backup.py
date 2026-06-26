"""Backup LINK CI: export DB + uploads to timestamped zip.
Usage: python backup.py
"""
import os, shutil, tempfile, zipfile
from datetime import datetime

PROJ = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(PROJ, 'backups')
os.makedirs(BACKUP_DIR, exist_ok=True)

ts = datetime.now().strftime('%Y%m%d_%H%M%S')
zip_path = os.path.join(BACKUP_DIR, f'linkci_backup_{ts}.zip')

with tempfile.TemporaryDirectory() as tmp:
    # Export SQLite DB
    db_src = os.path.join(PROJ, 'linkci.db')
    if os.path.exists(db_src):
        shutil.copy2(db_src, os.path.join(tmp, 'linkci.db'))

    # Export uploads
    uploads_src = os.path.join(PROJ, 'uploads')
    if os.path.exists(uploads_src):
        shutil.copytree(uploads_src, os.path.join(tmp, 'uploads'))

    # Export avatars
    avatars_src = os.path.join(PROJ, 'static', 'avatars')
    if os.path.exists(avatars_src):
        shutil.copytree(avatars_src, os.path.join(tmp, 'avatars'))

    # Create zip
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(tmp):
            for f in files:
                fp = os.path.join(root, f)
                arcname = os.path.relpath(fp, tmp)
                zf.write(fp, arcname)

size_mb = os.path.getsize(zip_path) / 1024 / 1024
print(f"Backup created: {zip_path} ({size_mb:.1f} MB)")
