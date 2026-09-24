// Detail d'une question d'entraide : reponses, votes, meilleure reponse, repondre
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import useApiList from '../hooks/useApiList';
import { Card, Chip, Loading, pullToRefresh } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

export default function QuestionScreen({ route, navigation }) {
  const { id } = route.params;
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, setData, loading, refreshing, refresh, reload } = useApiList(() => api.getQuestion(id), null);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);

  if (loading || !data) return <Loading />;
  const { question: q, reponses } = data;
  const voirProfil = (uid) => navigation.navigate('ProfilEtudiant', { id: uid });

  const repondre = async () => {
    if (texte.trim().length < 2) return;
    setEnvoi(true);
    try {
      await api.repondre(id, texte.trim());
      setTexte('');
      await reload();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setEnvoi(false);
  };

  const voter = async (r) => {
    try {
      const res = await api.voterReponse(r.id);
      setData((d) => ({ ...d, reponses: d.reponses.map((x) => (x.id === r.id ? { ...x, ...res } : x)) }));
    } catch (e) {
      Alert.alert('Vote', e.message);
    }
  };

  const choisir = (r) => {
    const deja = q.meilleure_reponse_id === r.id;
    api.meilleureReponse(id, deja ? null : r.id).then(reload).catch((e) => Alert.alert('Erreur', e.message));
  };

  const supprimerQuestion = () => Alert.alert('Supprimer', 'Supprimer cette question et ses reponses ?', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => api.supprimerQuestion(id).then(() => navigation.goBack()).catch((e) => Alert.alert('Erreur', e.message)) },
  ]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        contentContainerStyle={styles.content}
        data={reponses}
        keyExtractor={(r) => String(r.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={
          <Card>
            <View style={styles.haut}>
              <Chip label={q.matiere} />
              {q.resolue ? <Chip label="Resolue" tone="accent" icon="checkmark-circle" /> : null}
              <View style={{ flex: 1 }} />
              {q.est_auteur ? <TouchableOpacity onPress={supprimerQuestion} hitSlop={10}><Ionicons name="trash-outline" size={19} color={colors.textFaint} /></TouchableOpacity> : null}
            </View>
            <Text style={styles.titre}>{q.titre}</Text>
            {q.contenu ? <Text style={styles.contenu}>{q.contenu}</Text> : null}
            {q.image ? <PostImage uri={api.imageUrl(q.image)} style={{ marginTop: spacing.md }} /> : null}
            <TouchableOpacity style={styles.auteur} onPress={() => voirProfil(q.user_id)}>
              <Avatar name={`${q.prenom} ${q.nom}`} size={24} index={q.user_id} avatar={q.avatar} />
              <Text style={styles.meta}>{q.prenom} {q.nom} · {dateRelative(q.date_creation)}</Text>
            </TouchableOpacity>
            <Text style={styles.nbReponses}>{reponses.length} reponse{reponses.length > 1 ? 's' : ''}</Text>
          </Card>
        }
        renderItem={({ item: r }) => {
          const meilleure = q.meilleure_reponse_id === r.id;
          return (
            <Card style={meilleure && styles.meilleure}>
              {meilleure ? <Text style={styles.badge}>✅ Meilleure reponse</Text> : null}
              <TouchableOpacity style={styles.auteur} onPress={() => voirProfil(r.user_id)}>
                <Avatar name={`${r.prenom} ${r.nom}`} size={28} index={r.user_id} avatar={r.avatar} />
                <Text style={styles.nom}>{r.prenom} {r.nom}</Text>
                <Text style={styles.points}>{r.points} pts</Text>
                <Text style={styles.meta}>· {dateRelative(r.date_creation)}</Text>
              </TouchableOpacity>
              <Text style={styles.contenu}>{r.contenu}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.action, r.a_vote && styles.actionActive]} onPress={() => voter(r)}>
                  <Ionicons name={r.a_vote ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={r.a_vote ? colors.primary : colors.textMuted} />
                  <Text style={[styles.actionTexte, r.a_vote && { color: colors.primary }]}>{r.votes}</Text>
                </TouchableOpacity>
                {q.est_auteur ? (
                  <TouchableOpacity style={[styles.action, meilleure && styles.actionActive]} onPress={() => choisir(r)}>
                    <Ionicons name={meilleure ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color={meilleure ? colors.accent : colors.textMuted} />
                    <Text style={[styles.actionTexte, meilleure && { color: colors.accent }]}>{meilleure ? 'Choisie' : 'Meilleure reponse'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </Card>
          );
        }}
        ListEmptyComponent={<Text style={styles.vide}>Pas encore de reponse. Aide ton camarade !</Text>}
      />
      <View style={styles.barre}>
        <TextInput style={styles.saisie} value={texte} onChangeText={setTexte} placeholder="Ecris ta reponse..." placeholderTextColor={colors.textFaint} multiline maxLength={5000} />
        <TouchableOpacity style={[styles.envoyer, (texte.trim().length < 2 || envoi) && { opacity: 0.4 }]} onPress={repondre} disabled={texte.trim().length < 2 || envoi}>
          <Ionicons name="send" size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  haut: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  titre: { fontSize: 18, fontWeight: '800', color: colors.text },
  contenu: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: spacing.sm },
  auteur: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  nom: { fontSize: 14, fontWeight: '700', color: colors.text },
  points: { fontSize: 12, fontWeight: '800', color: colors.primary },
  meta: { fontSize: 12, color: colors.textFaint },
  nbReponses: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md },
  meilleure: { borderWidth: 2, borderColor: colors.accent },
  badge: { fontSize: 13, fontWeight: '800', color: colors.accent, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  actionActive: { backgroundColor: colors.primarySoft },
  actionTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  vide: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.lg },
  barre: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  saisie: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120, color: colors.text },
  envoyer: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
