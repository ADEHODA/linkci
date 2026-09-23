import React, { useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, pullToRefresh } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { dateRelative, heure } from '../utils';
import { useEvenement, useRealtime } from '../realtime';

export default function MessagingScreen() {
  const { data: conversations, loading, refreshing, refresh, reload } = useApiList(api.getConversations);
  const [selected, setSelected] = useState(null);

  // un nouveau message met a jour la liste des conversations
  useEvenement('message_recu', () => { if (!selected) reload(); });

  if (loading) return <Loading />;

  if (selected) {
    return <Conversation conv={selected} onBack={() => { setSelected(null); reload(); }} />;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={conversations}
      keyExtractor={(item) => String(item.autre_id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.convItem} onPress={() => setSelected(item)} activeOpacity={0.7}>
          <Avatar name={`${item.prenom} ${item.nom}`} size={50} index={item.autre_id} />
          <View style={styles.convInfo}>
            <View style={styles.convTop}>
              <Text style={[styles.convName, item.non_lu > 0 && styles.bold]} numberOfLines={1}>{item.prenom} {item.nom}</Text>
              {item.date_dernier ? <Text style={styles.convDate}>{dateRelative(item.date_dernier)}</Text> : null}
            </View>
            <Text style={[styles.convPreview, item.non_lu > 0 && styles.previewUnread]} numberOfLines={1}>{item.dernier_message || '...'}</Text>
          </View>
          {item.non_lu > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{item.non_lu}</Text></View>
          )}
        </TouchableOpacity>
      )}
      ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Aucune conversation" hint="Ecris a un etudiant depuis son profil sur le site." />}
    />
  );
}

function Conversation({ conv, onBack }) {
  const listRef = useRef(null);
  const { data: messages, loading, reload } = useApiList(() => api.getMessages(conv.autre_id));
  const [text, setText] = useState('');
  const { rafraichirCompteurs } = useRealtime();

  // message de cette conversation : on recharge (ce qui le marque aussi comme lu)
  useEvenement('message_recu', async (m) => {
    if (m.expediteur_id === conv.autre_id || m.destinataire_id === conv.autre_id) {
      await reload();
      rafraichirCompteurs();
    }
  });

  const handleSend = async () => {
    if (!text.trim()) return;
    const contenu = text.trim();
    setText('');
    try {
      await api.sendMessage(conv.autre_id, contenu);
      await reload();
    } catch (e) {
      setText(contenu);
      Alert.alert('Erreur', e.message);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.convHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={10}><Ionicons name="chevron-back" size={26} color={colors.primary} /></TouchableOpacity>
        <Avatar name={`${conv.prenom} ${conv.nom}`} size={36} index={conv.autre_id} />
        <Text style={styles.headerName}>{conv.prenom} {conv.nom}</Text>
      </View>

      {loading ? <Loading /> : (
        <FlatList
          ref={listRef}
          style={styles.messageList}
          contentContainerStyle={{ padding: spacing.md }}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const recu = item.expediteur_id === conv.autre_id;
            return (
              <View style={[styles.msg, recu ? styles.msgReceived : styles.msgSent]}>
                <Text style={[styles.msgText, !recu && styles.msgTextSent]}>{item.contenu}</Text>
                <Text style={[styles.msgTime, !recu && styles.msgTimeSent]}>{heure(item.date_envoi)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<EmptyState icon="hand-left-outline" title="Dis bonjour !" hint="Envoie le premier message." />}
        />
      )}

      <View style={styles.inputBar}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Ecris un message..." placeholderTextColor={colors.textFaint} multiline />
        <TouchableOpacity style={[styles.sendBtn, !text.trim() && { opacity: 0.4 }]} onPress={handleSend} disabled={!text.trim()}>
          <Ionicons name="send" size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingVertical: spacing.sm },
  convItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.card, gap: spacing.md, marginHorizontal: spacing.md, marginVertical: 3, borderRadius: radius.lg },
  convInfo: { flex: 1 },
  convTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  convName: { fontWeight: '600', fontSize: 15, color: colors.text, flex: 1 },
  bold: { fontWeight: '800' },
  convDate: { fontSize: 11, color: colors.textFaint },
  convPreview: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: '600' },
  badge: { backgroundColor: colors.primary, borderRadius: radius.pill, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  convHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerName: { fontWeight: '700', fontSize: 16, color: colors.text },
  messageList: { flex: 1 },
  msg: { marginBottom: spacing.sm, maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  msgSent: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  msgReceived: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 6 },
  msgText: { fontSize: 15, lineHeight: 20, color: colors.text },
  msgTextSent: { color: colors.white },
  msgTime: { fontSize: 10, color: colors.textFaint, marginTop: 3, alignSelf: 'flex-end' },
  msgTimeSent: { color: 'rgba(255,255,255,0.75)' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.bg, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text },
  sendBtn: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
