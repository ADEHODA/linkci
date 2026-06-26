"""
DEPLOIEMENT SUR PYTHONANYWHERE - GRATUIT !

1. Va sur https://www.pythonanywhere.com
2. Crée un compte gratuit (Beskar plan - gratuit à vie)
3. Ouvre l'onglet "Web" > "Add a new web app"
4. Choisis "Manual configuration" > "Python 3.12"
5. Dans l'onglet "Files", upload tout le dossier linkci/
6. Ouvre "Consoles" > "Bash" et lance :
   pip install flask flask-cors bcrypt python-dotenv waitress

7. Dans "Web" > "Code" > "WSGI configuration file", remplace tout par :

   import sys
   sys.path.insert(0, '/home/TON_PSEUDO/linkci')
   from app import app as application

8. Clique sur "Reload" (le bouton vert)

TON APP SERA EN LIGNE SUR :
   https://TON_PSEUDO.pythonanywhere.com/sondage

Partage ce lien sur WhatsApp !
"""
print(open(__file__).read())
