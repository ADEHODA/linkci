import React, { useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, Modal, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { colors, radius, spacing, font, creerStyles, useTheme } from '../theme';
import { heure } from '../utils';
import { useEvenement } from '../realtime';

export default function GroupsScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, loading, refreshing, refresh, reload } = useApiList(api.getGroupes, {});
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [tab, setTab] = useState('mes');
  const mesGroupes = data.mes_groupes || [];
  const tousGroupes = data.tous_groupes || [];

  const handleJoin = async (g) => {
    try {
      await api.rejoindreGroupe(g.id);
      await reload();
      setTab('mes');
      setSelected(g);
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await api.createGroupe({ nom: newName.trim(), description: newDesc.trim() });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setTab('mes');
      reload();
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  if (loading) return <SkeletonList />;

  if (selected) {
    return <GroupChat groupe={selected} onBack={() => { setSelected(null); reload(); }} onVoirProfil={(id) => navigation.navigate('ProfilEtudiant', { id })} />;
  }

  const liste = tab === 'mes' ? mesGroupes : tousGroupes;

  return (
    <View style={styles.container}>
      <View style={styles.segment}>
        <Segment actif={tab === 'mes'} label={`Mes groupes (${mesGroupes.length})`} onPress={() => setTab('mes')} />
        <Segment actif={tab === 'tous'} label={`Decouvrir (${tousGroupes.length})`} onPress={() => setTab('tous')} />
      </View>

      <FlatList
        data={liste}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 90 }}
        keyExtractor={(item) => String(item.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.groupItem} onPress={() => tab === 'mes' ? setSelected(item) : handleJoin(item)} activeOpacity={0.7}>
            <Avatar name={item.nom} size={48} index={item.id} />
            <View style={{ flex: 1 }}>
              <Text style={styles.groupName}>{item.nom}</Text>
              {item.description ? <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text> : null}
              <Text style={styles.groupMeta}>
                {item.nb_membres ? `${item.nb_membres} membre${item.nb_membres > 1 ? 's' : ''}` : ''}
                {item.role === 'admin' ? '  ·  Admin' : ''}
              </Text>
            </View>
            {tab === 'tous'
              ? <View style={styles.joinBtn}><Text style={styles.joinText}>Rejoindre</Text></View>
              : <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />}
          </TouchableOpacity>
        )}
        ListEmptyComponent={tab === 'mes'
          ? <EmptyState icon="people-outline" title="Aucun groupe" hint="Rejoins un groupe dans Decouvrir ou cree le tien avec +" />
          : <EmptyState icon="compass-outline" title="Rien a decouvrir" hint="Tu es deja dans tous les groupes !" />}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowCreate(true)} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Nouveau groupe</Text>
            <TextInput style={styles.field} placeholder="Nom du groupe (ex. MIAGE L1)" placeholderTextColor={colors.textFaint} value={newName} onChangeText={setNewName} />
            <TextInput style={[styles.field, { minHeight: 70 }]} placeholder="Description (optionnelle)" placeholderTextColor={colors.textFaint} value={newDesc} onChangeText={setNewDesc} multiline />
            <PrimaryButton title="Creer le groupe" onPress={handleCreate} />
            <TouchableOpacity style={styles.cancel} onPress={() => setShowCreate(false)}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Segment({ actif, label, onPress }) {
  const styles = useStyles();
  return (
    <TouchableOpacity style={[styles.segBtn, actif && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, actif && styles.segTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function GroupChat({ groupe, onBack, onVoirProfil }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const listRef = useRef(null);
  const { data: messages, loading, reload } = useApiList(() => api.getGroupeMessages(groupe.id));
  const [text, setText] = useState('');

  useEvenement('groupe_message', (m) => { if (m.groupe_id === groupe.id) reload(); });

  const handleSend = async () => {
    if (!text.trim()) return;
    const contenu = text.trim();
    setText('');
    try {
      await api.sendGroupeMessage(groupe.id, contenu);
      await reload();
    } catch (e) { setText(contenu); Alert.alert('Erreur', e.message); }
  };

  const handleLeave = () => {
    Alert.alert('Quitter', `Quitter le groupe ${groupe.nom} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', style: 'destructive', onPress: async () => {
        try { await api.quitterGroupe(groupe.id); onBack(); }
        catch (e) { Alert.alert('Erreur', e.message); }
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={10}><Ionicons name="chevron-back" size={26} color={colors.primary} /></TouchableOpacity>
        <Avatar name={groupe.nom} size={36} index={groupe.id} />
        <View style={{ flex: 1 }}>
          <Text style={styles.chatName}>{groupe.nom}</Text>
          {groupe.description ? <Text style={styles.chatDesc} numberOfLines={1}>{groupe.description}</Text> : null}
        </View>
        <TouchableOpacity onPress={handleLeave} hitSlop={10}><Ionicons name="exit-outline" size={22} color={colors.danger} /></TouchableOpacity>
      </View>
      {loading ? <Loading /> : (
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.md }}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={styles.msgRow}>
              <TouchableOpacity onPress={() => onVoirProfil(item.user_id)}>
                <Avatar name={`${item.prenom} ${item.nom}`} size={30} index={item.user_id} avatar={item.avatar} />
              </TouchableOpacity>
              <View style={styles.msgBubble}>
                <Text style={styles.msgUser}>{item.prenom} {item.nom}</Text>
                <Text style={styles.msgText}>{item.contenu}</Text>
                <Text style={styles.msgTime}>{heure(item.date_envoi)}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Aucun message" hint="Lance la discussion !" />}
        />
      )}
      <View style={styles.inputBar}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Ecris au groupe..." placeholderTextColor={colors.textFaint} multiline />
        <TouchableOpacity style={[styles.sendBtn, !text.trim() && { opacity: 0.4 }]} onPress={handleSend} disabled={!text.trim()}>
          <Ionicons name="send" size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  segment: { flexDirection: 'row', backgroundColor: colors.card, margin: spacing.md, marginBottom: 0, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  segTextActive: { color: colors.white },
  groupItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: spacing.sm, gap: spacing.md },
  groupName: { fontWeight: '700', fontSize: 15, color: colors.text },
  groupDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  groupMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  joinBtn: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  joinText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 36 },
  sheetTitle: { ...font.heading, marginBottom: spacing.lg },
  field: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 14, fontSize: 15, marginBottom: spacing.md, color: colors.text, textAlignVertical: 'top' },
  cancel: { alignItems: 'center', paddingTop: spacing.lg },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  chatName: { fontWeight: '700', fontSize: 16, color: colors.text },
  chatDesc: { fontSize: 12, color: colors.textMuted },
  msgRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginBottom: spacing.sm },
  msgBubble: { backgroundColor: colors.card, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '82%' },
  msgUser: { fontSize: 12, fontWeight: '800', color: colors.primary, marginBottom: 1 },
  msgText: { fontSize: 15, lineHeight: 20, color: colors.text },
  msgTime: { fontSize: 10, color: colors.textFaint, marginTop: 3, alignSelf: 'flex-end' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.bg, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text },
  sendBtn: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
