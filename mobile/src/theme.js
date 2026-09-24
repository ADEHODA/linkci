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

function construire(c, estSombre) {
  const font = {
    title: { fontSize: 22, fontWeight: '800', color: c.text },
    heading: { fontSize: 17, fontWeight: '700', color: c.text },
    body: { fontSize: 15, lineHeight: 22, color: c.text },
    small: { fontSize: 13, color: c.textMuted },
    tiny: { fontSize: 11, color: c.textFaint },
  };
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
  return { colors: c, sombre: estSombre, font, shadow, headerOptions, radius, spacing };
}

const themes = { clair: construire(clair, false), sombre: construire(sombre, true) };
let actuel = themes.clair;
// Pour les petites fonctions hors composant (ex. pullToRefresh)
export const themeActuel = () => actuel;

const CLE = 'linkci_theme';
const ThemeContext = createContext({ ...themes.clair, preference: 'auto', setPreference: () => {} });

// preference : 'auto' (suit le telephone), 'clair' ou 'sombre' ; memorisee
export function ThemeProvider({ children }) {
  const systeme = useColorScheme();
  const [preference, setPref] = useState('auto');

  useEffect(() => {
    SecureStore.getItemAsync(CLE).then((p) => { if (p) setPref(p); }).catch(() => {});
  }, []);

  const setPreference = (p) => {
    setPref(p);
    SecureStore.setItemAsync(CLE, p).catch(() => {});
  };

  const mode = preference === 'auto' ? (systeme === 'dark' ? 'sombre' : 'clair') : preference;
  const valeur = useMemo(() => ({ ...themes[mode], preference, setPreference }), [mode, preference]);
  actuel = themes[mode];
  return <ThemeContext.Provider value={valeur}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// Styles dependant du theme, recalcules seulement quand le theme change
export function creerStyles(fabrique) {
  const cache = {};
  return function useStyles() {
    const theme = useTheme();
    const cle = theme.sombre ? 'sombre' : 'clair';
    if (!cache[cle]) cache[cle] = StyleSheet.create(fabrique(theme));
    return cache[cle];
  };
}
