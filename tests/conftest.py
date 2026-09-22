import os, sys, tempfile, atexit
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Jamais la base de production : SQLite temporaire, ou TEST_DATABASE_URL si fourni
# (load_dotenv ne remplace pas une variable deja definie, meme vide).
os.environ['DATABASE_URL'] = os.environ.get('TEST_DATABASE_URL', '')
import app as linkci_app

# Patch DB to a temp file for tests
_db_fd, _db_path = tempfile.mkstemp(suffix='.db')
linkci_app.DB_PATH = _db_path
linkci_app.init_db()

import pytest

@pytest.fixture
def client():
    linkci_app.app.config['TESTING'] = True
    linkci_app.app.secret_key = 'test-secret'
    with linkci_app.app.test_client() as c:
        yield c

def cleanup():
    os.close(_db_fd)
    try:
        os.unlink(_db_path)
    except:
        pass
atexit.register(cleanup)