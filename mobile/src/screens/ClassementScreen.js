// Classement des etudiants (semaine ou depuis toujours ; tout LinkCI, ma fac, ma filiere) et defis de la semaine
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { SkeletonList, pullToRefresh } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const MEDAILLES = ['🥇', '🥈', '🥉'];
const PERIODES = [['semaine', 'Cette semaine'], ['total', 'Depuis toujours']];
const PORTEES = [['tous', 'Tout LinkCI'], ['universite', 'Ma fac'], ['filiere', 'Ma filiere']];

export default function ClassementScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [periode, setPeriode] = useState('semaine');
  const [portee, setPortee] = useState('tous');
  const [c, setC] = useState(null);
  const [defis, setDefis] = useState(null);
  const [actualisation, setActualisation] = useState(false);

  const charger = useCallback(async (p = periode, t = portee) => {
    try {
      const [cl, d] = await Promise.all([api.getClassement(p, t), api.getDefis()]);
      setC(cl);
      setDefis(d);
    } catch (e) {}
  }, [periode, portee]);
  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const choisir = (p, t) => { setPeriode(p); setPortee(t); setC(null); charger(p, t); };

  const joursRestants = defis ? Math.max(0, Math.ceil((new Date(`${defis.fin_semaine.replace(' ', 'T')}Z`) - new Date()) / 86400000)) : 0;

  const entete = (
    <View>
      {defis ? (
        <View style={styles.carte}>
          <View style={styles.ligneEntre}>
            <Text style={styles.carteTitre}>🎯 Defis de la semaine</Text>
            <Text style={styles.petit}>{defis.tous_reussis ? '✅ +20 points !' : `encore ${joursRestants} j`}</Text>
          </View>
          {defis.defis.map((d) => (
            <View key={d.cle} style={{ marginTop: spacing.md }}>
              <View style={styles.ligneEntre}>
                <Text style={styles.defiTexte}>{d.emoji} {d.titre}</Text>
                <Text style={[styles.defiScore, d.fait && { color: colors.accent }]}>{d.fait ? '✓' : `${d.progression}/${d.objectif}`}</Text>
              </View>
              <View style={styles.barre}>
                <View style={[styles.barrePleine, { width: `${Math.round((100 * d.progression) / Math.max(1, d.objectif))}%` },
                  d.fait && { backgroundColor: colors.accent }]} />
              </View>
            </View>
          ))}
          <Text style={[styles.petit, { marginTop: spacing.md }]}>Releve les 3 defis : +20 points et le badge Challenger 🏅</Text>
        </View>
      ) : null}
      <View style={styles.segment}>
        {PERIODES.map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.segBtn, periode === cle && styles.segActif]} onPress={() => choisir(cle, portee)}>
            <Text style={[styles.segTexte, periode === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[styles.segment, { marginTop: 6 }]}>
        {PORTEES.map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.segBtn, portee === cle && styles.segActif]} onPress={() => choisir(periode, cle)}>
            <Text style={[styles.segTexte, portee === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {c?.moi?.rang ? (
        <View style={styles.moi}>
          <Text style={styles.moiRang}>#{c.moi.rang}</Text>
          <Text style={styles.moiTexte}>Ta place sur {c.participants}</Text>
          <Text style={styles.moiPoints}>{c.moi.points} pts</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
      data={c?.classement || []}
      keyExtractor={(u) => String(u.id)}
      ListHeaderComponent={entete}
      refreshControl={pullToRefresh(actualisation, async () => { setActualisation(true); await charger(); setActualisation(false); })}
      renderItem={({ item: u }) => (
        <TouchableOpacity style={styles.ligne} onPress={() => navigation.navigate('ProfilEtudiant', { id: u.id })} activeOpacity={0.8}>
          <Text style={[styles.rang, u.rang <= 3 && { fontSize: 24 }]}>{MEDAILLES[u.rang - 1] || u.rang}</Text>
          <Avatar name={`${u.prenom} ${u.nom}`} size={40} index={u.id} avatar={u.avatar} />
          <View style={{ flex: 1 }}>
            <Text style={styles.nom} numberOfLines={1}>{u.prenom} {u.nom}</Text>
            <Text style={styles.petit} numberOfLines={1}>{[u.filiere, u.universite].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={styles.points}>{u.points}</Text>
        </TouchableOpacity>
      )}
      ListEmptyComponent={!c ? <SkeletonList avatar /> : (
        <Text style={styles.vide}>{c.message || "Personne n'a encore de points ici. Sois le premier !"}</Text>
      )}
      ListFooterComponent={
        <Text style={[styles.petit, { textAlign: 'center', marginTop: spacing.lg, lineHeight: 19 }]}>
          Points : publication +3 · commentaire +1 · reponse d'entraide +5 · jour actif +2 · evenement +2 · nouvel abonne +3 · camarade invite +10 · defis reussis +20
        </Text>
      }
    />
  );
}

const useStyles = creerStyles(({ colors, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadow },
  carteTitre: { fontSize: 16, fontWeight: '800', color: colors.text },
  ligneEntre: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  defiTexte: { flex: 1, fontSize: 14, color: colors.text },
  defiScore: { fontSize: 14, fontWeight: '800', color: colors.textMuted },
  barre: { height: 7, borderRadius: 4, backgroundColor: colors.cardAlt, marginTop: 6, overflow: 'hidden' },
  barrePleine: { height: 7, backgroundColor: colors.primary },
  segment: { flexDirection: 'row', gap: 6 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  segActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  segTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  moi: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  moiRang: { fontSize: 24, fontWeight: '900', color: colors.white },
  moiTexte: { flex: 1, fontSize: 14, color: colors.white },
  moiPoints: { fontSize: 16, fontWeight: '900', color: colors.white },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  rang: { width: 34, textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.textMuted },
  nom: { fontSize: 15, fontWeight: '700', color: colors.text },
  points: { fontSize: 16, fontWeight: '900', color: colors.primary },
  petit: { fontSize: 12, color: colors.textMuted },
  vide: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, paddingHorizontal: spacing.lg },
}));
