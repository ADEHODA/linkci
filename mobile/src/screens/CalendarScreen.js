import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';

export default function CalendarScreen() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState('');
  const [lieu, setLieu] = useState('');

  const load = async () => {
    try {
      const data = await api.getEvenements();
      setEvents(data);
    } catch (e) { Alert.alert('Erreur', e.message); }
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const handleAdd = async () => {
    if (!title.trim() || !date.trim()) {
      Alert.alert('Erreur', 'Titre et date requis');
      return;
    }
    try {
      await api.createEvenement({ titre: title.trim(), description: desc.trim(), date_event: date.trim(), lieu: lieu.trim() });
      setShowAdd(false);
      setTitle(''); setDesc(''); setDate(''); setLieu('');
      load();
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const handleDelete = (id) => {
    Alert.alert('Supprimer', 'Supprimer cet evenement ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await api.deleteEvenement(id); load(); }
        catch (e) { Alert.alert('Erreur', e.message); }
      }},
    ]);
  };

  const mois = ['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];
  const jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

  const renderEvent = ({ item }) => {
    const d = item.date_event ? new Date(item.date_event) : null;
    const isPast = d && d < new Date(new Date().toDateString());
    return (
      <TouchableOpacity style={[styles.card, isPast && styles.past]} onLongPress={() => handleDelete(item.id)}>
        {d && (
          <View style={styles.dateBadge}>
            <Text style={styles.dateDay}>{d.getDate()}</Text>
            <Text style={styles.dateMonth}>{mois[d.getMonth()].slice(0, 3)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{item.titre}</Text>
          {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
          <View style={styles.meta}>
            {d ? <Text style={styles.metaText}>{jours[d.getDay()]} {d.getDate()} {mois[d.getMonth()]}</Text> : null}
            {item.lieu ? <Text style={styles.metaText}>{item.lieu}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderEvent}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="calendar-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucun evenement</Text>
            <Text style={styles.hint}>Ajoute un evenement campus !</Text>
          </View>
        }
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)}>
        <Ionicons name="add" size={28} color="white" />
      </TouchableOpacity>

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nouvel evenement</Text>
            <TextInput style={styles.input} placeholder="Titre" value={title} onChangeText={setTitle} />
            <TextInput style={styles.input} placeholder="Description (opt.)" value={desc} onChangeText={setDesc} multiline />
            <TextInput style={styles.input} placeholder="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Lieu (opt.)" value={lieu} onChangeText={setLieu} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}><Text style={{ color: '#666' }}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleAdd}><Text style={{ color: 'white', fontWeight: '700' }}>Ajouter</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4', padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  hint: { color: '#ccc', fontSize: 13, marginTop: 4 },
  card: { flexDirection: 'row', backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EDEDEA', gap: 12 },
  past: { opacity: 0.5 },
  dateBadge: { alignItems: 'center', justifyContent: 'center', width: 48, borderRadius: 10, backgroundColor: '#FFF0E8', paddingVertical: 6 },
  dateDay: { fontSize: 20, fontWeight: '800', color: '#FF6B35' },
  dateMonth: { fontSize: 11, fontWeight: '600', color: '#FF6B35', marginTop: -2 },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  desc: { fontSize: 13, color: '#666', marginBottom: 4, lineHeight: 18 },
  meta: { flexDirection: 'row', gap: 12 },
  metaText: { fontSize: 12, color: '#999' },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12 },
  modalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  confirmBtn: { backgroundColor: '#FF6B35', borderRadius: 50, paddingVertical: 10, paddingHorizontal: 24 },
});
