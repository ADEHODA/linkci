// Carte "Complete ton profil" (en haut du fil), tant qu'il manque des informations
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const ETAPES = [
  { champ: 'avatar', label: 'Photo', ok: (u) => u.avatar && u.avatar !== 'default.png' },
  { champ: 'universite', label: 'Universite', ok: (u) => !!u.universite },
  { champ: 'filiere', label: 'Filiere', ok: (u) => !!u.filiere },
  { champ: 'bio', label: 'Bio', ok: (u) => !!u.bio },
];

export default function CompleterProfil({ moi }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const navigation = useNavigation();
  if (!moi) return null;
  const faites = ETAPES.filter((e) => e.ok(moi)).length;
  if (faites === ETAPES.length) return null;
  const pourcent = Math.round(((faites + 1) / (ETAPES.length + 1)) * 100); // le compte cree compte deja

  return (
    <TouchableOpacity style={styles.carte} activeOpacity={0.85} onPress={() => navigation.navigate('ModifierProfil', { user: moi })}>
      <View style={styles.haut}>
        <View style={styles.icone}><Ionicons name="sparkles" size={20} color={colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.titre}>Complete ton profil ({pourcent} %)</Text>
          <Text style={styles.texte}>Tes camarades te trouveront plus facilement.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
      </View>
      <View style={styles.barre}><View style={[styles.remplie, { width: `${pourcent}%` }]} /></View>
      <View style={styles.etapes}>
        {ETAPES.map((e) => {
          const ok = e.ok(moi);
          return (
            <View key={e.champ} style={[styles.etape, ok && styles.etapeOk]}>
              <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={ok ? colors.accent : colors.textFaint} />
              <Text style={[styles.etapeTexte, ok && { color: colors.accent }]}>{e.label}</Text>
            </View>
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

const useStyles = creerStyles(({ colors, shadow }) => ({
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary + '40', ...shadow },
  haut: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icone: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  titre: { fontSize: 15, fontWeight: '800', color: colors.text },
  texte: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  barre: { height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, marginTop: spacing.md, overflow: 'hidden' },
  remplie: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  etapes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  etape: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  etapeOk: { backgroundColor: colors.accentSoft },
  etapeTexte: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
}));
