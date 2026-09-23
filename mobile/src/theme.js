// Charte graphique LinkCI : toutes les couleurs et tailles de l'app viennent d'ici.
import { Platform } from 'react-native';

export const colors = {
  primary: '#FF6B35',      // orange LinkCI
  primaryDark: '#E8551F',
  primarySoft: '#FFF1EA',  // fonds d'etiquettes, etats actifs
  accent: '#009E60',       // vert du drapeau ivoirien
  accentSoft: '#E6F6EF',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  like: '#E11D48',
  likeSoft: '#FFF1F3',

  bg: '#F4F4F6',           // fond des ecrans
  card: '#FFFFFF',
  border: '#E9E9EE',
  text: '#16161D',
  textMuted: '#6B6F7B',
  textFaint: '#A0A3AD',
  white: '#FFFFFF',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const font = {
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  heading: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
  tiny: { fontSize: 11, color: colors.textFaint },
};

export const shadow = Platform.select({
  ios: { shadowColor: '#1B1B2F', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  default: { elevation: 2 },
});

// En-tetes de navigation : blancs et sobres, titre fonce
export const headerOptions = {
  headerStyle: { backgroundColor: colors.card },
  headerShadowVisible: false,
  headerTintColor: colors.primary,
  headerTitleStyle: { fontWeight: '800', fontSize: 18, color: colors.text },
};
