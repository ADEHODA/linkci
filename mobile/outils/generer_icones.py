"""Genere les icones de l'app LinkCI : un L geometrique relie a un noeud (l'idee de "lien").

Touche ivoirienne : les trois couleurs du pays (fond orange, L blanc, coeur du noeud
vert) et un motif textile en filigrane (losanges et points des pagnes baoule /
toiles de Korhogo).

Usage (depuis le dossier mobile) : python outils/generer_icones.py
Necessite Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ICI = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ICI, '..', 'assets')
HAUT_GAUCHE, BAS_DROITE = (255, 140, 82), (236, 78, 26)  # degrade orange LinkCI
BLANC = (255, 255, 255)
VERT = (0, 158, 96)  # vert du drapeau ivoirien
SS = 4  # sur-echantillonnage : on dessine en grand puis on reduit (bords lisses)


def fond(taille):
    """Degrade diagonal + reflet doux en haut a gauche."""
    img = Image.new('RGBA', (taille, taille))
    px = img.load()
    for y in range(0, taille, 4):
        for x in range(0, taille, 4):
            t = (x + y) / (2 * (taille - 1))
            c = tuple(int(a + (b - a) * t) for a, b in zip(HAUT_GAUCHE, BAS_DROITE)) + (255,)
            for dy in range(4):
                for dx in range(4):
                    if x + dx < taille and y + dy < taille:
                        px[x + dx, y + dy] = c
    reflet = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    ImageDraw.Draw(reflet).ellipse([-taille * 0.5, -taille * 0.6, taille * 0.7, taille * 0.5], fill=(255, 255, 255, 26))
    img.alpha_composite(reflet.filter(ImageFilter.GaussianBlur(taille * 0.16)))
    return img


def motif_textile(taille, opacite=34):
    """Losanges en treillis + points, facon pagne baoule / toile de Korhogo, tres discret."""
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pas = taille / 7
    trait = max(1, int(taille * 0.006))
    couleur = (255, 255, 255, opacite)
    n = 9
    for i in range(-1, n):
        for j in range(-1, n):
            cx, cy = (i + 0.5) * pas + (pas / 2 if j % 2 else 0), (j + 0.5) * pas * 0.62
            h, l = pas * 0.31, pas * 0.5
            d.polygon([(cx, cy - h), (cx + l, cy), (cx, cy + h), (cx - l, cy)], outline=couleur, width=trait)
            r = pas * 0.045
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, int(opacite * 1.4)))
    return img


def logo(taille, echelle, ombre=True):
    """Logo blanc sur fond transparent. Coordonnees dans un carre de 100 unites, centre.
    echelle : part de l'image occupee par ce carre de 100 unites."""
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = taille * echelle / 100
    o = taille * (1 - echelle) / 2
    P = lambda x, y: (o + (x - 3.2) * u, o + (y + 3) * u)  # recentre le dessin

    def trait(a, b, largeur, couleur=BLANC):
        d.line([P(*a), P(*b)], fill=couleur, width=int(largeur * u))
        for x, y in (a, b):  # bouts arrondis
            r = largeur * u / 2
            cx, cy = P(x, y)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=couleur)

    def rond(c, r, couleur=BLANC):
        cx, cy = P(*c)
        d.ellipse([cx - r * u, cy - r * u, cx + r * u, cy + r * u], fill=couleur)

    # le lien : du bout du L vers le noeud
    trait((68, 72), (68, 38), 7, (255, 255, 255, 150))
    # le L
    trait((34, 22), (34, 72), 17)
    trait((34, 72), (68, 72), 17)
    # le noeud, avec un anneau
    rond((68, 30), 13)
    rond((68, 30), 6.5, VERT + (255,))  # coeur vert : orange, blanc, vert, les couleurs du pays

    if ombre:  # ombre portee douce sous le logo
        alpha = img.split()[3]
        sombre = Image.new('RGBA', img.size, (120, 30, 0, 0))
        sombre.putalpha(alpha.point(lambda a: int(a * 0.35)))
        sombre = sombre.filter(ImageFilter.GaussianBlur(taille * 0.018))
        decale = Image.new('RGBA', img.size, (0, 0, 0, 0))
        decale.paste(sombre, (0, int(taille * 0.018)))
        decale.alpha_composite(img)
        img = decale
    return img


def enregistrer(img, nom, taille):
    img.resize((taille, taille), Image.LANCZOS).save(os.path.join(ASSETS, nom))
    print('ok', nom, taille)


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)
    T = 1024 * SS

    # Icone classique : fond plein (Android et iOS arrondissent eux-memes)
    icone = fond(T)
    icone.alpha_composite(motif_textile(T))
    icone.alpha_composite(logo(T, 0.62))
    enregistrer(icone, 'icon.png', 1024)

    # Icone adaptative Android : logo seul, dans la zone jamais rognee (66 % central),
    # sur un arriere-plan degrade + motif (qu'Android decoupe selon la forme du telephone)
    enregistrer(logo(T, 0.56), 'adaptive-icon.png', 1024)
    arriere = fond(T)
    arriere.alpha_composite(motif_textile(T))
    enregistrer(arriere, 'adaptive-background.png', 1024)

    # Ecran de demarrage : logo blanc (fond orange defini dans app.json)
    enregistrer(logo(T, 0.70, ombre=False), 'splash-icon.png', 1024)

    # Favicon (version web)
    enregistrer(icone, 'favicon.png', 48)
