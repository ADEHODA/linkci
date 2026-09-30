// Charte graphique LinkCI, en mode clair et sombre.
//   const { colors, sombre } = useTheme();              // dans un composant
//   const useStyles = creerStyles(({ colors, font, shadow }) => ({ ... }));
//   const styles = useStyles();                          // styles recalcules au changement de theme
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const clair = {
  primary: '#FF6B35',      // orange LinkCI
  primaryDark: '#E8551F',
  primarySoft: '#FFF1EA',  // fonds d'etiquettes, etats actifs
  accent: '#009E60',       // vert ivoirien
  accentSoft: '#E6F6EF',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  like: '#E11D48',
  likeSoft: '#FFF1F3',
  bg: '#F4F4F6',           // fond des ecrans
  card: '#FFFFFF',
  cardAlt: '#F8F8FA',      // zones de saisie, bulles recues
  border: '#E9E9EE',
  text: '#16161D',
  textMuted: '#6B6F7B',
  textFaint: '#A0A3AD',
  white: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.45)',
};

const sombre = {
  primary: '#FF7A45',
  primaryDark: '#FF6B35',
  primarySoft: '#3A2419',
  accent: '#2DBE7E',
  accentSoft: '#153528',
  danger: '#F87171',
  dangerSoft: '#3A1D1F',
  like: '#FB7185',
  likeSoft: '#3A1B25',
  bg: '#0E1014',
  card: '#191C22',
  cardAlt: '#22262E',
  border: '#2A2F38',
  text: '#F2F3F5',
  textMuted: '#A7ACB7',
  textFaint: '#6F7581',
  white: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.65)',
};

export const palettes = { clair, sombre };

// Couleurs du mode clair : pour le code qui n'est pas dans un composant
export const colors = clair;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Accessibilite : taille du texte, contraste eleve et police (reglages dans Parametres > Apparence)
export const TAILLES = { petit: 0.9, normal: 1, grand: 1.15, tres_grand: 1.3 };
const CONTRASTE = {
  clair: { textMuted: '#3F424B', textFaint: '#5F636E', border: '#B9BCC6' },
  sombre: { textMuted: '#D5D8DF', textFaint: '#AEB3BD', border: '#4A505C' },
};

// Polices proposees : 'defaut' = police du telephone (aucun fichier a charger).
// Les 2 autres sont chargees par App.js via expo-font ; ces noms doivent correspondre
// exactement aux cles passees a useFonts(). Une seule graisse "normale" et une "grasse" :
// suffisant pour tous les styles de l'app (titres en gras, corps de texte normal).
export const POLICES = [['defaut', 'Par defaut'], ['lisible', 'Lisible'], ['arrondie', 'Arrondie']];
export const NOMS_POLICES = {
  lisible: { normal: 'AtkinsonHyperlegible_400Regular', gras: 'AtkinsonHyperlegible_700Bold' },
  arrondie: { normal: 'Quicksand_500Medium', gras: 'Quicksand_700Bold' },
};

// Style de texte : 'normal' (inchange), 'gras' (renforce la graisse), 'italique'.
export const STYLES_TEXTE = [['normal', 'Normal'], ['gras', 'Gras'], ['italique', 'Italique']];

// Agrandit fontSize et lineHeight d'une feuille de styles
function agrandir(feuille, echelle) {
  if (echelle === 1) return feuille;
  const r = {};
  for (const [cle, style] of Object.entries(feuille)) {
    r[cle] = style && typeof style === 'object' ? { ...style } : style;
    if (r[cle]?.fontSize) r[cle].fontSize = Math.round(r[cle].fontSize * echelle);
    if (r[cle]?.lineHeight) r[cle].lineHeight = Math.round(r[cle].lineHeight * echelle);
  }
  return r;
}

// Renforce la graisse ('gras') ou penche le texte ('italique') de chaque style de la feuille.
// Applique AVANT appliquerPolice : une graisse renforcee doit choisir la variante "gras" de la police.
function appliquerStyleTexte(feuille, styleTexte) {
  if (!styleTexte || styleTexte === 'normal') return feuille;
  const r = {};
  for (const [cle, style] of Object.entries(feuille)) {
    if (!style || typeof style !== 'object') { r[cle] = style; continue; }
    r[cle] = { ...style };
    if (styleTexte === 'gras') {
      const poids = style.fontWeight === 'bold' ? 700
        : (Number.isFinite(parseInt(style.fontWeight, 10)) ? parseInt(style.fontWeight, 10) : 400);
      r[cle].fontWeight = String(Math.max(poids, 700));
    } else if (styleTexte === 'italique') {
      r[cle].fontStyle = 'italic';
    }
  }
  return r;
}

// Remplace la police de chaque style de la feuille (systeme -> 'lisible'/'arrondie').
// Sans effet sur les styles qui ne s'appliquent pas a du texte (RN ignore fontFamily ailleurs).
function appliquerPolice(feuille, police) {
  const noms = NOMS_POLICES[police];
  if (!noms) return feuille; // 'defaut' (ou valeur inconnue) : police du systeme, inchangee
  const r = {};
  for (const [cle, style] of Object.entries(feuille)) {
    if (!style || typeof style !== 'object') { r[cle] = style; continue; }
    const poids = typeof style.fontWeight === 'string' ? parseInt(style.fontWeight, 10) : style.fontWeight;
    const gras = style.fontWeight === 'bold' || (Number.isFinite(poids) && poids >= 600);
    r[cle] = { ...style, fontFamily: gras ? noms.gras : noms.normal };
  }
  return r;
}

function construire(c, estSombre, echelle = 1, police = 'defaut', styleTexte = 'normal') {
  const font = {
    title: { fontSize: 22, fontWeight: '800', color: c.text },
    heading: { fontSize: 17, fontWeight: '700', color: c.text },
    body: { fontSize: 15, lineHeight: 22, color: c.text },
    small: { fontSize: 13, color: c.textMuted },
    tiny: { fontSize: 11, color: c.textFaint },
  };
  // font : deja agrandi + police appliquee (usage direct) ; fontBase : pour creerStyles, qui traite toute la feuille
  const fontBase = font;
  const shadow = estSombre
    ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border } // en sombre, un fin contour remplace l'ombre
    : Platform.select({
      ios: { shadowColor: '#1B1B2F', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
      default: { elevation: 2 },
    });
  const headerOptions = {
    headerStyle: { backgroundColor: c.card },
    headerShadowVisible: false,
    headerTintColor: c.primary,
    headerTitleStyle: { fontWeight: '800', fontSize: 18, color: c.text },
  };
  return { colors: c, sombre: estSombre,
    font: appliquerPolice(appliquerStyleTexte(agrandir(fontBase, echelle), styleTexte), police),
    fontBase, shadow, headerOptions, radius, spacing, echelle, police, styleTexte };
}

const themes = { clair: construire(clair, false), sombre: construire(sombre, true) };
let actuel = themes.clair;
// Pour les petites fonctions hors composant (ex. pullToRefresh)
export const themeActuel = () => actuel;

const CLE = 'linkci_theme';
const CLE_ACCES = 'linkci_accessibilite';
const ThemeContext = createContext({ ...themes.clair, preference: 'auto', setPreference: () => {} });

// preference : 'auto' (suit le telephone), 'clair' ou 'sombre' ; memorisee
export function ThemeProvider({ children }) {
  const systeme = useColorScheme();
  const [preference, setPref] = useState('auto');
  const [acces, setAcces] = useState({ taille: 'normal', contraste: false, police: 'defaut', styleTexte: 'normal' });

  useEffect(() => {
    SecureStore.getItemAsync(CLE).then((p) => { if (p) setPref(p); }).catch(() => {});
    SecureStore.getItemAsync(CLE_ACCES).then((a) => { if (a) setAcces((x) => ({ ...x, ...JSON.parse(a) })); }).catch(() => {});
  }, []);

  const setAccessibilite = (changement) => {
    setAcces((x) => {
      const n = { ...x, ...changement };
      SecureStore.setItemAsync(CLE_ACCES, JSON.stringify(n)).catch(() => {});
      return n;
    });
  };

  const setPreference = (p) => {
    setPref(p);
    SecureStore.setItemAsync(CLE, p).catch(() => {});
  };

  const mode = preference === 'auto' ? (systeme === 'dark' ? 'sombre' : 'clair') : preference;
  const echelle = TAILLES[acces.taille] || 1;
  const police = acces.police || 'defaut';
  const styleTexte = acces.styleTexte || 'normal';
  const base = useMemo(() => (echelle === 1 && !acces.contraste && police === 'defaut' && styleTexte === 'normal' ? themes[mode]
    : construire(acces.contraste ? { ...palettes[mode], ...CONTRASTE[mode] } : palettes[mode], mode === 'sombre', echelle, police, styleTexte)),
  [mode, echelle, acces.contraste, police, styleTexte]);
  const valeur = useMemo(() => ({ ...base, preference, setPreference, taille: acces.taille, contraste: acces.contraste, police, styleTexte,
    setAccessibilite, cleStyles: `${mode}-${acces.taille}-${acces.contraste ? 1 : 0}-${police}-${styleTexte}` }), [base, preference, acces, police, styleTexte]);
  actuel = base;
  return <ThemeContext.Provider value={valeur}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// Styles dependant du theme, recalcules seulement quand le theme change
export function creerStyles(fabrique) {
  const cache = {};
  return function useStyles() {
    const theme = useTheme();
    const cle = theme.cleStyles || (theme.sombre ? 'sombre' : 'clair');
    if (!cache[cle]) {
      let feuille = agrandir(fabrique({ ...theme, font: theme.fontBase || theme.font }), theme.echelle || 1);
      feuille = appliquerStyleTexte(feuille, theme.styleTexte);
      feuille = appliquerPolice(feuille, theme.police);
      cache[cle] = StyleSheet.create(feuille);
    }
    return cache[cle];
  };
}
