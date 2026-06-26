import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import Avatar from '../components/Avatar';

export default function GroupsScreen() {
  const [mesGroupes, setMesGroupes] = useState([]);
  const [tousGroupes, setTousGroupes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [tab, setTab] = useState('mes');

  const load = async () => {
    try {
      const data = await api.getGroupes();
      setMesGroupes(data.mes_groupes || []);
      setTousGroupes(data.tous_groupes || []);
    } catch (e) { Alert.alert('Erreur', e.message); }
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const openGroup = async (g) => {
    setSelected(g);
    try {
      const data = await api.getGroupeMessages(g.id);
      setMessages(data);
    } catch (e) {}
  };

  const handleSend = async () => {
    if (!text.trim() || !selected) return;
    try {
      await api.sendGroupeMessage(selected.id, text.trim());
      setText('');
      const data = await api.getGroupeMessages(selected.id);
      setMessages(data);
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const handleJoin = async (id) => {
    try {
      await api.rejoindreGroupe(id);
      load();
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const handleLeave = async () => {
    Alert.alert('Quitter', 'Quitter ce groupe ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', style: 'destructive', onPress: async () => {
        try {
          await api.quitterGroupe(selected.id);
          setSelected(null);
          load();
        } catch (e) { Alert.alert('Erreur', e.message); }
      }},
    ]);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await api.createGroupe({ nom: newName.trim(), description: newDesc.trim() });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      load();
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  if (selected) {
    return (
      <View style={styles.container}>
        <View style={styles.convHeader}>
          <TouchableOpacity onPress={() => setSelected(null)}><Ionicons name="arrow-back" size={24} color="#FF6B35" /></TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.convName}>{selected.nom}</Text>
            {selected.description ? <Text style={styles.convPreview}>{selected.description}</Text> : null}
          </View>
          <TouchableOpacity onPress={handleLeave}><Ionicons name="exit-outline" size={22} color="#DC2626" /></TouchableOpacity>
        </View>
        <FlatList
          style={styles.messageList}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <View style={styles.msg}>
              <Text style={styles.msgUser}>{item.prenom} {item.nom}</Text>
              <View style={styles.msgBubble}><Text style={styles.msgText}>{item.contenu}</Text></View>
              <Text style={styles.msgTime}>{item.date_envoi?.slice(11, 16)}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#999', padding: 40 }}>Aucun message</Text>}
        />
        <View style={styles.inputBar}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Ecris un message..." placeholderTextColor="#999" />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}><Ionicons name="send" size={20} color="white" /></TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'mes' && styles.tabActive]} onPress={() => setTab('mes')}>
          <Text style={[styles.tabText, tab === 'mes' && styles.tabTextActive]}>Mes groupes ({mesGroupes.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'tous' && styles.tabActive]} onPress={() => setTab('tous')}>
          <Text style={[styles.tabText, tab === 'tous' && styles.tabTextActive]}>Decouvrir ({tousGroupes.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={tab === 'mes' ? mesGroupes : tousGroupes}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.groupItem} onPress={() => tab === 'mes' ? openGroup(item) : handleJoin(item.id)}>
            <Avatar name={item.nom} size={44} index={item.id} />
            <View style={{ flex: 1 }}>
              <Text style={styles.groupName}>{item.nom}</Text>
              {item.description ? <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text> : null}
              {item.role ? <Text style={styles.roleBadge}>{item.role}</Text> : null}
            </View>
            {item.nb_membres ? <Text style={styles.memberCount}>{item.nb_membres} membres</Text> : null}
            {tab === 'tous' ? <Ionicons name="add-circle" size={24} color="#FF6B35" /> : <Ionicons name="chevron-forward" size={20} color="#ccc" />}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}><Ionicons name="people-outline" size={48} color="#ccc" /><Text style={styles.empty}>Aucun groupe</Text></View>
        }
      />

      <Modal visible={showCreate} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nouveau groupe</Text>
            <TextInput style={styles.modalInput} placeholder="Nom du groupe" value={newName} onChangeText={setNewName} />
            <TextInput style={styles.modalInput} placeholder="Description (optionnelle)" value={newDesc} onChangeText={setNewDesc} multiline />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCreate(false)}><Text style={{ color: '#666' }}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleCreate}><Text style={{ color: 'white', fontWeight: '700' }}>Creer</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  tabRow: { flexDirection: 'row', backgroundColor: 'white', padding: 8, borderBottomWidth: 1, borderBottomColor: '#EDEDEA', gap: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#FFF0E8' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#666' },
  tabTextActive: { color: '#FF6B35' },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center' },
  groupItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#EDEDEA', backgroundColor: 'white', gap: 10 },
  groupName: { fontWeight: '600', fontSize: 15 },
  groupDesc: { fontSize: 13, color: '#999', marginTop: 2 },
  memberCount: { fontSize: 12, color: '#999', marginRight: 8 },
  roleBadge: { fontSize: 11, color: '#FF6B35', fontWeight: '600', marginTop: 2 },
  convHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#EDEDEA' },
  convName: { fontWeight: '700', fontSize: 16 },
  convPreview: { fontSize: 12, color: '#999', marginTop: 2 },
  messageList: { flex: 1, padding: 12 },
  msg: { marginBottom: 10 },
  msgUser: { fontSize: 12, fontWeight: '600', color: '#FF6B35', marginBottom: 2, marginLeft: 4 },
  msgBubble: { backgroundColor: 'white', borderRadius: 12, padding: 10, alignSelf: 'flex-start', maxWidth: '85%', borderWidth: 1, borderColor: '#EDEDEA' },
  msgText: { fontSize: 15, lineHeight: 20 },
  msgTime: { fontSize: 11, color: '#999', marginTop: 2, marginLeft: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#EDEDEA', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 50, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  sendBtn: { backgroundColor: '#FF6B35', borderRadius: 50, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 },
  modal: { backgroundColor: 'white', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12 },
  modalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 20 },
  modalConfirm: { backgroundColor: '#FF6B35', borderRadius: 50, paddingVertical: 10, paddingHorizontal: 24 },
});
