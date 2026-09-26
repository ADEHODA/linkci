// Mon activite : serie de jours actifs, audience, entraide, meilleure publication
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import { SkeletonList } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const JOURS_COURTS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function encouragement(a) {
  if (a.serie >= 7) return `Incroyable, ${a.serie} jours d'affilee ! Continue comme ca.`;
  if (a.serie >= 2) return `Bravo, ${a.serie} jours de suite. Reviens demain pour allonger ta serie !`;
  if (a.serie === 1) return 'Tu es la aujourd\'hui. Reviens demain pour commencer une serie !';
  return 'Ouvre LinkCI chaque jour pour construire ta serie.';
}

export default function MonActiviteScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [a, setA] = useState(null);
  const [actualisation, setActualisation] = useState(false);

  const charger = useCallback(async () => {
    try { setA(await api.getMonActivite()); } catch (e) {}
  }, []);
  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  if (!a) return <SkeletonList carte />;

  const tuiles = [
    ['📝', a.publications, 'publications'],
    ['❤️', a.likes_recus + a.reactions_recues, 'likes et reactions'],
    ['💬', a.commentaires_recus, 'commentaires recus'],
    ['👥', a.abonnes, `abonnes (+${a.abonnes_30j} en 30 j)`],
    ['👀', a.vues_profil_30j, 'vues du profil (30 j)'],
    ['🤝', a.points, "points d'entraide"],
    ['✅', a.meilleures_reponses, 'meilleures reponses'],
    ['🎟️', a.filleuls, 'camarades invites'],
    ['📅', a.evenements, 'evenements'],
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={actualisation} tintColor={colors.primary}
        onRefresh={async () => { setActualisation(true); await charger(); setActualisation(false); }} />}>
      <View style={styles.serie}>
        <Text style={styles.flamme}>{a.serie > 0 ? '🔥' : '🌱'}</Text>
        <Text style={styles.serieNombre}>{a.serie} jour{a.serie > 1 ? 's' : ''}</Text>
        <Text style={styles.serieTexte}>{encouragement(a)}</Text>
        <Text style={styles.record}>Record : {a.record} jour{a.record > 1 ? 's' : ''} · {a.jours_actifs_30j} jours actifs sur 4 semaines</Text>
        <View style={styles.calendrier}>
          {a.calendrier.map((j) => (
            <View key={j.jour} style={styles.case}>
              <View style={[styles.pastille, j.actif && styles.pastilleActive]} accessibilityLabel={`${j.jour} ${j.actif ? 'actif' : 'inactif'}`} />
            </View>
          ))}
        </View>
        <View style={styles.legende}>
          {a.calendrier.slice(-7).map((j) => (
            <Text key={j.jour} style={styles.legendeTexte}>{JOURS_COURTS[new Date(`${j.jour}T00:00:00`).getDay()]}</Text>
          ))}
        </View>
      </View>

      <View style={styles.grille}>
        {tuiles.map(([icone, valeur, label]) => (
          <View key={label} style={styles.tuile}>
            <Text style={styles.tuileIcone}>{icone}</Text>
            <Text style={styles.tuileValeur}>{valeur}</Text>
            <Text style={styles.tuileLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {a.meilleure_publication ? (
        <View style={styles.carte}>
          <Text style={styles.carteTitre}>🏆 Ta publication la plus aimee</Text>
          <Text style={styles.carteTexte} numberOfLines={4}>{a.meilleure_publication.contenu || '(photo)'}</Text>
          <Text style={styles.carteMeta}>❤️ {a.meilleure_publication.nb_likes} like{a.meilleure_publication.nb_likes > 1 ? 's' : ''}</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.carte} onPress={() => navigation.navigate('Home', { screen: 'Accueil' })} activeOpacity={0.85}>
          <Text style={styles.carteTitre}>✍️ Publie ton premier post</Text>
          <Text style={styles.carteTexte}>Partage une astuce, une question ou une bonne nouvelle avec ta promo.</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.note}>Ces statistiques ne sont visibles que par toi.</Text>
    </ScrollView>
  );
}

const useStyles = creerStyles(({ colors, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  serie: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', marginBottom: spacing.md, ...shadow },
  flamme: { fontSize: 46 },
  serieNombre: { fontSize: 30, fontWeight: '900', color: colors.primary },
  serieTexte: { fontSize: 14, color: colors.text, textAlign: 'center', marginTop: 4, lineHeight: 20 },
  record: { fontSize: 12, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
  calendrier: { flexDirection: 'row', flexWrap: 'wrap', width: 7 * 34, marginTop: spacing.lg },
  case: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  pastille: { width: 22, height: 22, borderRadius: 6, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  pastilleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  legende: { flexDirection: 'row', width: 7 * 34 },
  legendeTexte: { width: 34, textAlign: 'center', fontSize: 11, color: colors.textFaint, fontWeight: '700' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  tuile: { width: '31.8%', backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', ...shadow },
  tuileIcone: { fontSize: 20 },
  tuileValeur: { fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 2 },
  tuileLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadow },
  carteTitre: { fontSize: 15, fontWeight: '800', color: colors.text },
  carteTexte: { fontSize: 14, color: colors.text, marginTop: 6, lineHeight: 20 },
  carteMeta: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontWeight: '700' },
  note: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },
}));
