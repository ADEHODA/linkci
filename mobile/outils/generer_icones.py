"""Genere les icones de l'app LinkCI.

Logo : trois etudiants (badges ronds avec une silhouette) relies en reseau. Le badge
blanc est relie au badge vert du bas par un lien epais et courbe qui dessine le L
de LinkCI. Couleurs de la Cote d'Ivoire : orange, blanc, vert.

Usage (depuis le dossier mobile) : python outils/generer_icones.py
Necessite Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(ICI, '..', 'assets')
HAUT_GAUCHE, BAS_DROITE = (250, 138, 58), (234, 96, 22)  # degrade orange
BLANC = (255, 255, 255, 255)
VERT = (46, 158, 94, 255)
POLICE = next((p for p in (r'C:\Windows\Fonts\ariblk.ttf', r'C:\Windows\Fonts\arialbd.ttf',
                           '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)
SS = 4  # sur-echantillonnage : on dessine en grand puis on reduit (bords lisses)


def fond(taille):
    """Degrade diagonal orange + reflet doux en haut a gauche."""
    petit = Image.new('RGBA', (256, 256))
    px = petit.load()
    for y in range(256):
        for x in range(256):
            t = (x + y) / 510
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(HAUT_GAUCHE, BAS_DROITE)) + (255,)
    img = petit.resize((taille, taille), Image.BICUBIC)
    reflet = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    ImageDraw.Draw(reflet).ellipse([-taille * 0.5, -taille * 0.6, taille * 0.7, taille * 0.5], fill=(255, 255, 255, 24))
    img.alpha_composite(reflet.filter(ImageFilter.GaussianBlur(taille * 0.16)))
    return img


def logo(taille, echelle, ombre=True):
    """Logo sur fond transparent, dessine dans un carre de 100 unites centre.
    echelle : part de l'image occupee par ce carre."""
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = taille * echelle / 100
    o = taille * (1 - echelle) / 2
    P = lambda x, y: (o + x * u, o + y * u)

    def personne(cx, cy, r, fond_badge, couleur_perso):
        """Badge rond avec une silhouette (tete + epaules) : chaque noeud est un etudiant."""
        x, y = P(cx, cy)
        R_ = r * u
        badge = Image.new('RGBA', img.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(badge)
        bd.ellipse([x - R_, y - R_, x + R_, y + R_], fill=fond_badge)
        silhouette = Image.new('RGBA', img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(silhouette)
        rt = 0.30 * R_  # tete
        sd.ellipse([x - rt, y - 0.30 * R_ - rt, x + rt, y - 0.30 * R_ + rt], fill=couleur_perso)
        sd.ellipse([x - 0.62 * R_, y + 0.16 * R_, x + 0.62 * R_, y + 1.30 * R_], fill=couleur_perso)  # epaules
        masque = Image.new('L', img.size, 0)  # la silhouette reste dans le badge, avec une marge
        m = 0.80 * R_
        ImageDraw.Draw(masque).ellipse([x - m, y - m, x + m, y + m], fill=255)
        badge.paste(silhouette, (0, 0), Image.composite(silhouette.split()[3], Image.new('L', img.size, 0), masque))
        img.alpha_composite(badge)

    # Positions des noeuds
    blanc, vert_haut, vert_bas = (29, 29), (72, 29), (72, 71)
    R = 14.5          # rayon des noeuds
    L = 11.5          # epaisseur du lien
    coude = 17        # rayon de l'arrondi du L

    # Lien en L : descend du noeud blanc, s'arrondit, file vers le noeud vert du bas
    x0, y0 = blanc
    y_bas = vert_bas[1]
    d.line([P(x0, y0), P(x0, y_bas - coude)], fill=BLANC, width=int(L * u))
    d.line([P(x0 + coude, y_bas), P(vert_bas[0], y_bas)], fill=BLANC, width=int(L * u))
    # quart de cercle centre en (x0 + coude, y_bas - coude)
    cx, cy = P(x0 + coude, y_bas - coude)
    r_ext = (coude + L / 2) * u
    d.arc([cx - r_ext, cy - r_ext, cx + r_ext, cy + r_ext], 90, 180, fill=BLANC, width=int(L * u))

    # Les etudiants : blanc (silhouette orange), verts (silhouette blanche) avec lisere blanc
    personne(*blanc, R, BLANC, (240, 110, 34, 255))
    for c in (vert_haut, vert_bas):
        personne(*c, R, VERT, BLANC)
        x, y = P(*c)
        d.ellipse([x - R * u, y - R * u, x + R * u, y + R * u], outline=BLANC, width=int(2.4 * u))

    if ombre:  # ombre portee douce
        alpha = img.split()[3]
        sombre = Image.new('RGBA', img.size, (110, 35, 0, 0))
        sombre.putalpha(alpha.point(lambda a: int(a * 0.32)))
        sombre = sombre.filter(ImageFilter.GaussianBlur(taille * 0.016))
        decale = Image.new('RGBA', img.size, (0, 0, 0, 0))
        decale.paste(sombre, (0, int(taille * 0.016)))
        decale.alpha_composite(img)
        img = decale
    return img


def splash(taille):
    """Ecran de demarrage : logo + nom LINK CI, en blanc (fond orange dans app.json)."""
    img = Image.new('RGBA', (taille, taille), (0, 0, 0, 0))
    img.alpha_composite(logo(taille, 0.52, ombre=False), (0, -int(taille * 0.08)))
    if POLICE:
        police = ImageFont.truetype(POLICE, int(taille * 0.085))
        ImageDraw.Draw(img).text((taille / 2, taille * 0.80), 'LINK CI', font=police, fill=BLANC, anchor='mm')
    return img


def enregistrer(img, nom, taille):
    img.resize((taille, taille), Image.LANCZOS).save(os.path.join(ASSETS, nom))
    print('ok', nom, taille)


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)
    T = 1024 * SS

    # Icone classique : fond plein (Android et iOS arrondissent eux-memes)
    icone = fond(T)
    icone.alpha_composite(logo(T, 0.60))
    enregistrer(icone, 'icon.png', 1024)

    # Icone adaptative Android : logo dans la zone jamais rognee (66 % central),
    # sur un arriere-plan degrade (qu'Android decoupe selon la forme du telephone)
    enregistrer(logo(T, 0.54), 'adaptive-icon.png', 1024)
    enregistrer(fond(T), 'adaptive-background.png', 1024)

    # Ecran de demarrage
    enregistrer(splash(T), 'splash-icon.png', 1024)

    # Favicon (version web)
    enregistrer(icone, 'favicon.png', 48)

    # Petite icone de notification Android : silhouette blanche sur fond transparent
    silhouette = logo(T, 0.86, ombre=False)
    blanc = Image.new('RGBA', silhouette.size, (255, 255, 255, 0))
    blanc.putalpha(silhouette.split()[3])
    enregistrer(blanc, 'notification-icon.png', 96)
