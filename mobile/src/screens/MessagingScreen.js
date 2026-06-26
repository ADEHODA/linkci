import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import Avatar from '../components/Avatar';

export default function MessagingScreen() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef(null);

  const loadConversations = async () => {
    try {
      const data = await api.getConversations();
      setConversations(data);
    } catch (e) {}
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadConversations(); }, []));

  const openConversation = async (conv) => {
    setSelected(conv);
    try {
      const data = await api.getMessages(conv.autre_id);
      setMessages(data);
    } catch (e) {}
  };

  const handleSend = async () => {
    if (!text.trim() || !selected) return;
    try {
      await api.sendMessage(selected.autre_id, text.trim());
      setText('');
      const data = await api.getMessages(selected.autre_id);
      setMessages(data);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  if (selected) {
    return (
      <View style={styles.container}>
        <View style={styles.convHeader}>
          <TouchableOpacity onPress={() => setSelected(null)}><Ionicons name="arrow-back" size={24} color="#FF6B35" /></TouchableOpacity>
          <Avatar name={`${selected.prenom} ${selected.nom}`} size={32} index={selected.autre_id} />
          <Text style={styles.convName}>{selected.prenom} {selected.nom}</Text>
        </View>

        <FlatList
          ref={flatListRef}
          style={styles.messageList}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.msg, item.expediteur_id === selected.autre_id ? styles.msgReceived : styles.msgSent]}>
              <Text style={[styles.msgText, item.expediteur_id !== selected.autre_id && styles.msgTextSent]}>{item.contenu}</Text>
              <Text style={[styles.msgTime, item.expediteur_id !== selected.autre_id && { color: 'rgba(255,255,255,0.7)' }]}>{item.date_envoi?.slice(11, 16)}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#999', padding: 40 }}>Aucun message</Text>}
        />

        <View style={styles.inputBar}>
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Ecris un message..." placeholderTextColor="#999" />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
            <Ionicons name="send" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.autre_id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.convItem} onPress={() => openConversation(item)}>
            <Avatar name={`${item.prenom} ${item.nom}`} size={40} index={item.autre_id} />
            <View style={styles.convInfo}>
              <Text style={styles.convName}>{item.prenom} {item.nom}</Text>
              <Text style={styles.convPreview} numberOfLines={1}>{item.dernier_message || '...'}</Text>
            </View>
            {item.non_lu > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{item.non_lu}</Text></View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucune conversation</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  convItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#EDEDEA', backgroundColor: 'white', gap: 10 },
  convInfo: { flex: 1 },
  convName: { fontWeight: '600', fontSize: 14 },
  convPreview: { fontSize: 13, color: '#999', marginTop: 2 },
  badge: { backgroundColor: '#FF6B35', borderRadius: 50, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
  convHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#EDEDEA' },
  messageList: { flex: 1, padding: 12 },
  msg: { marginBottom: 8, maxWidth: '78%' },
  msgSent: { alignSelf: 'flex-end' },
  msgReceived: { alignSelf: 'flex-start' },
  msgText: { padding: 10, borderRadius: 16, fontSize: 15, lineHeight: 20, backgroundColor: '#F0F0EE' },
  msgTextSent: { backgroundColor: '#FF6B35', color: 'white' },
  msgTime: { fontSize: 11, color: '#999', marginTop: 4, marginHorizontal: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#EDEDEA', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 50, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  sendBtn: { backgroundColor: '#FF6B35', borderRadius: 50, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
