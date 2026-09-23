"""Genere les icones de l'app a partir du logo LinkCI (static/images/logo.svg).

Usage (depuis le dossier mobile) : python outils/generer_icones.py
Necessite Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ICI, '..', 'assets')
ORANGE, ORANGE_FONCE, VERT, BLANC = (255, 107, 53), (232, 93, 38), (0, 157, 84), (255, 255, 255)
POLICE = next((p for p in (r'C:\Windows\Fonts\ariblk.ttf', r'C:\Windows\Fonts\arialbd.ttf',
                           '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)
SS = 4  # sur-echantillonnage : on dessine en grand puis on reduit (bords lisses)


def degrade(taille):
    img = Image.new('RGBA', (taille, taille))
    d = ImageDraw.Draw(img)
    for x in range(taille):
        t = x / (taille - 1)
        d.line([(x, 0), (x, taille)], fill=tuple(int(a + (b - a) * t) for a, b in zip(ORANGE, ORANGE_FONCE)) + (255,))
    return img


def motif(img, cx, cy, echelle, drapeau=True):
    """Logo : anneau fin, 4 points (le reseau), grand L blanc et drapeau ivoirien.
    Centre en (cx, cy) ; echelle = 1 pour un logo de 62 px de cote."""
    d = ImageDraw.Draw(img)
    e = echelle
    r = 23 * e
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 110), width=max(1, int(1.6 * e)))
    for ax, ay in ((-1, -1), (1, -1), (-1, 1), (1, 1)):  # points sur l'anneau, en diagonale
        x, y = cx + ax * r * 0.707, cy + ay * r * 0.707
        d.ellipse([x - 2.8 * e, y - 2.8 * e, x + 2.8 * e, y + 2.8 * e], fill=BLANC)
    police = ImageFont.truetype(POLICE, int(30 * e)) if POLICE else ImageFont.load_default()
    d.text((cx - 1.5 * e, cy), 'L', font=police, fill=BLANC, anchor='mm')
    if drapeau:  # petit drapeau ivoirien au pied du L
        x0, y0, w, h = cx + 6 * e, cy + 4 * e, 2.4 * e, 6.5 * e
        for i, c in enumerate((ORANGE, BLANC, VERT)):
            d.rectangle([x0 + i * w, y0, x0 + (i + 1) * w, y0 + h], fill=c)
        d.rectangle([x0, y0, x0 + 3 * w, y0 + h], outline=BLANC, width=max(1, int(0.6 * e)))


def enregistrer(img, nom, taille):
    img.resize((taille, taille), Image.LANCZOS).save(os.path.join(ASSETS, nom))
    print('ok', nom, taille)


os.makedirs(ASSETS, exist_ok=True)
T = 1024 * SS

# Icone classique : fond plein (Android et iOS arrondissent eux-memes)
icone = degrade(T)
motif(icone, T / 2, T / 2, T / 62 * 0.9)
enregistrer(icone, 'icon.png', 1024)

# Icone adaptative Android : premier plan transparent, motif dans la zone sure (66 % central)
adaptive = Image.new('RGBA', (T, T), (0, 0, 0, 0))
motif(adaptive, T / 2, T / 2, T / 62 * 0.7)
enregistrer(adaptive, 'adaptive-icon.png', 1024)

# Ecran de demarrage : logo blanc sur fond orange (couleur definie dans app.json)
splash = Image.new('RGBA', (T, T), (0, 0, 0, 0))
motif(splash, T / 2, T / 2, T / 62 * 0.9)
enregistrer(splash, 'splash-icon.png', 1024)

# Favicon (version web)
enregistrer(icone, 'favicon.png', 48)
