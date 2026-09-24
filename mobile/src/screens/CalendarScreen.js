import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, PrimaryButton, Fab, pullToRefresh, SkeletonList } from '../components/ui';
import { colors, radius, spacing, font, creerStyles, useTheme } from '../theme';

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export default function CalendarScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: events, loading, refreshing, refresh, reload } = useApiList(api.getEvenements);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState('');
  const [lieu, setLieu] = useState('');

  const handleAdd = async () => {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('Erreur', 'Titre requis et date au format AAAA-MM-JJ (ex. 2026-10-15)');
      return;
    }
    try {
      await api.createEvenement({ titre: title.trim(), description: desc.trim(), date_event: date.trim(), lieu: lieu.trim() });
      setShowAdd(false);
      setTitle(''); setDesc(''); setDate(''); setLieu('');
      reload();
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const handleDelete = (id) => {
    Alert.alert('Supprimer', 'Supprimer cet evenement ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await api.deleteEvenement(id); reload(); }
        catch (e) { Alert.alert('Erreur', e.message); }
      }},
    ]);
  };

  const renderEvent = ({ item }) => {
    const d = item.date_event ? new Date(item.date_event) : null;
    const passe = d && d < new Date(new Date().toDateString());
    return (
      <Card style={[styles.card, passe && styles.past]} onLongPress={() => handleDelete(item.id)}>
        {d && (
          <View style={[styles.dateBadge, passe && { backgroundColor: colors.bg }]}>
            <Text style={[styles.dateDay, passe && { color: colors.textMuted }]}>{d.getDate()}</Text>
            <Text style={[styles.dateMonth, passe && { color: colors.textMuted }]}>{MOIS[d.getMonth()].slice(0, 3).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{item.titre}</Text>
          {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
          <View style={styles.meta}>
            {d ? <View style={styles.metaItem}><Ionicons name="time-outline" size={13} color={colors.textMuted} /><Text style={styles.metaText}>{JOURS[d.getDay()]} {d.getDate()} {MOIS[d.getMonth()]}</Text></View> : null}
            {item.lieu ? <View style={styles.metaItem}><Ionicons name="location-outline" size={13} color={colors.textMuted} /><Text style={styles.metaText}>{item.lieu}</Text></View> : null}
          </View>
        </View>
      </Card>
    );
  };

  if (loading) return <SkeletonList />;

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 90 }}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderEvent}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={events.length ? <Text style={styles.hint}>Appui long sur un evenement pour le supprimer</Text> : null}
        ListEmptyComponent={<EmptyState icon="calendar-outline" title="Aucun evenement" hint="Ajoute tes examens et evenements campus avec +" />}
      />
      <Fab onPress={() => setShowAdd(true)} />

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Nouvel evenement</Text>
            <TextInput style={styles.field} placeholder="Titre (ex. Partiel d'algebre)" placeholderTextColor={colors.textFaint} value={title} onChangeText={setTitle} />
            <TextInput style={styles.field} placeholder="Date (AAAA-MM-JJ)" placeholderTextColor={colors.textFaint} value={date} onChangeText={setDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
            <TextInput style={styles.field} placeholder="Lieu (optionnel)" placeholderTextColor={colors.textFaint} value={lieu} onChangeText={setLieu} />
            <TextInput style={[styles.field, { minHeight: 60 }]} placeholder="Description (optionnelle)" placeholderTextColor={colors.textFaint} value={desc} onChangeText={setDesc} multiline />
            <PrimaryButton title="Ajouter" onPress={handleAdd} />
            <TouchableOpacity style={styles.cancel} onPress={() => setShowAdd(false)}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  hint: { ...font.tiny, textAlign: 'center', marginBottom: spacing.sm },
  card: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  past: { opacity: 0.6 },
  dateBadge: { alignItems: 'center', justifyContent: 'center', width: 56, height: 60, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  dateDay: { fontSize: 22, fontWeight: '900', color: colors.primary },
  dateMonth: { fontSize: 11, fontWeight: '800', color: colors.primary, marginTop: -2 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  desc: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 36 },
  sheetTitle: { ...font.heading, marginBottom: spacing.lg },
  field: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 14, fontSize: 15, marginBottom: spacing.md, color: colors.text, textAlignVertical: 'top' },
  cancel: { alignItems: 'center', paddingTop: spacing.lg },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
}));
