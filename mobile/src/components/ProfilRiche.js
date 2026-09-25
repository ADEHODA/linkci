// Affichage du profil riche : couverture, competences, parcours, liens
import React from 'react';
import { View, Text, Image, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import { radius, spacing, creerStyles, useTheme } from '../theme';

export function Couverture({ user, hauteur = 140 }) {
  const styles = useStyles();
  if (!user?.couverture) return <View style={[styles.bandeau, { height: hauteur }]} />;
  return <Image source={{ uri: api.imageUrl(user.couverture) }} style={{ width: '100%', height: hauteur }} resizeMode="cover" />;
}

const LIENS = [['lien_linkedin', 'logo-linkedin', 'LinkedIn'], ['lien_github', 'logo-github', 'GitHub'], ['lien_site', 'globe-outline', 'Site web']];

export function DetailsProfil({ user }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const competences = user?.competences || [];
  const parcours = user?.parcours || [];
  const liens = LIENS.filter(([cle]) => api.lienSur(user?.[cle]));
  if (!competences.length && !parcours.length && !liens.length) return null;
  return (
    <View style={styles.carte}>
      {competences.length ? (
        <>
          <Text style={styles.titre}>Competences</Text>
          <View style={styles.puces}>
            {competences.map((c) => <Text key={c} style={styles.puce}>{c}</Text>)}
          </View>
        </>
      ) : null}
      {parcours.length ? (
        <>
          <Text style={styles.titre}>Parcours</Text>
          {parcours.map((e, k) => (
            <View key={k} style={styles.etape}>
              <View style={styles.point} />
              <View style={{ flex: 1 }}>
                <Text style={styles.etapeTitre}>{e.titre}</Text>
                {e.lieu || e.periode ? <Text style={styles.etapeSous}>{[e.lieu, e.periode].filter(Boolean).join(' · ')}</Text> : null}
              </View>
            </View>
          ))}
        </>
      ) : null}
      {liens.length ? (
        <View style={styles.liens}>
          {liens.map(([cle, icone, label]) => (
            <TouchableOpacity key={cle} style={styles.lien} onPress={() => Linking.openURL(api.lienSur(user[cle]))}>
              <Ionicons name={icone} size={16} color={colors.primary} />
              <Text style={styles.lienTexte}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  bandeau: { width: '100%', backgroundColor: colors.primary },
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginHorizontal: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  titre: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  puce: { backgroundColor: colors.primarySoft, color: colors.primary, fontWeight: '700', fontSize: 13, paddingHorizontal: 11, paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden' },
  etape: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  point: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 5 },
  etapeTitre: { fontSize: 15, fontWeight: '700', color: colors.text },
  etapeSous: { fontSize: 13, color: colors.textMuted },
  liens: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  lien: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  lienTexte: { color: colors.primary, fontWeight: '700', fontSize: 13 },
}));
