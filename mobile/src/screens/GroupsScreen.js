// Groupes de promo : mes groupes, suggestions (ma fac / ma filiere), discussion riche, administration
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, Modal, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import { BulleVocale, Enregistreur } from '../components/NoteVocale';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { heure } from '../utils';
import { useEvenement } from '../realtime';

export default function GroupsScreen({ navigation, route }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, loading, refreshing, refresh, reload } = useApiList(api.getGroupes, {});
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [tab, setTab] = useState('mes');
  const [moi, setMoi] = useState(null);
  const mesGroupes = data.mes_groupes || [];
  const tousGroupes = data.tous_groupes || [];

  useEffect(() => { api.getMe().then(setMoi).catch(() => {}); }, []);

  // ouverture depuis une notification : navigate('Groupes', { ouvrir: id })
  useEffect(() => {
    const id = route?.params?.ouvrir;
    if (!id || loading) return;
    const g = mesGroupes.find((x) => x.id === id);
    if (g) setSelected(g);
    navigation.setParams({ ouvrir: undefined });
  }, [route?.params?.ouvrir, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async (g) => {
    try {
      await api.rejoindreGroupe(g.id);
      await reload();
      setTab('mes');
      setSelected(g);
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const creer = async (groupe) => {
    try {
      const r = await api.createGroupe(groupe);
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setTab('mes');
      await reload();
      setSelected({ id: r.id, nom: groupe.nom, description: groupe.description || '' });
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  if (loading) return <SkeletonList />;

  if (selected) {
    return <GroupChat groupe={selected} moi={moi} navigation={navigation}
      onBack={() => { setSelected(null); reload(); }} onVoirProfil={(id) => navigation.navigate('ProfilEtudiant', { id })} />;
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
        ListHeaderComponent={data.a_creer ? (
          <TouchableOpacity style={styles.promo} onPress={() => creer({ ...data.a_creer, description: 'Groupe de promo' })} activeOpacity={0.85}>
            <Ionicons name="school" size={26} color={colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={styles.promoTitre}>Cree le groupe de ta promo</Text>
              <Text style={styles.promoTexte}>{data.a_creer.nom}</Text>
            </View>
            <Ionicons name="add-circle" size={26} color={colors.white} />
          </TouchableOpacity>
        ) : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.groupItem} onPress={() => tab === 'mes' ? setSelected(item) : handleJoin(item)} activeOpacity={0.7}>
            <Avatar name={item.nom} size={48} index={item.id} />
            <View style={{ flex: 1 }}>
              <Text style={styles.groupName}>{item.nom}</Text>
              {item.description ? <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text> : null}
              <Text style={styles.groupMeta}>
                {item.suggere ? 'Suggere pour toi  ·  ' : ''}
                {item.nb_membres ? `${item.nb_membres} membre${item.nb_membres > 1 ? 's' : ''}` : ''}
                {item.role === 'admin' ? 'Admin' : ''}
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
            <TextInput style={styles.field} placeholder="Nom du groupe (ex. MIAGE L1)" placeholderTextColor={colors.textFaint} value={newName} onChangeText={setNewName} maxLength={100} />
            <TextInput style={[styles.field, { minHeight: 70 }]} placeholder="Description (optionnelle)" placeholderTextColor={colors.textFaint} value={newDesc} onChangeText={setNewDesc} multiline maxLength={500} />
            <PrimaryButton title="Creer le groupe" onPress={() => newName.trim() && creer({
              nom: newName.trim(), description: newDesc.trim(), universite: moi?.universite || '', filiere: moi?.filiere || '',
            })} />
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

function GroupChat({ groupe: groupeInitial, moi, onBack, onVoirProfil }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const listRef = useRef(null);
  const [groupe, setGroupe] = useState(groupeInitial);
  const { data: messages, setData, loading, reload } = useApiList(() => api.getGroupeMessages(groupe.id));
  const [infos, setInfos] = useState({ membres: [], je_suis_admin: false });
  const [text, setText] = useState('');
  const [enregistre, setEnregistre] = useState(false);
  const [gestion, setGestion] = useState(false);

  const chargerInfos = () => api.getMembresGroupe(groupe.id).then((r) => { setInfos(r); if (r.groupe) setGroupe((g) => ({ ...g, ...r.groupe })); }).catch(() => {});
  useEffect(() => { chargerInfos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEvenement('groupe_message', (m) => { if (m.groupe_id === groupe.id) reload(); });

  // @mentions : suggestions quand le dernier mot commence par @
  const motCourant = (/(^|\s)@([\w-]*)$/.exec(text) || [])[2];
  const suggestions = motCourant !== undefined
    ? infos.membres.filter((m) => m.id !== moi?.id && m.prenom.toLowerCase().startsWith(motCourant.toLowerCase())).slice(0, 5)
    : [];
  const mentionner = (m) => setText(text.replace(/@[\w-]*$/, `@${m.prenom} `));

  const provisoire = (extra) => ({ id: `tmp-${Date.now()}`, user_id: moi?.id, prenom: moi?.prenom || '', nom: moi?.nom || '', avatar: moi?.avatar,
    contenu: '', date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true, ...extra });

  const envoyer = async (fonction, extra, texteSiEchec) => {
    const tmp = provisoire(extra);
    setData((m) => [...m, tmp]);
    try {
      await fonction();
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== tmp.id));
      if (texteSiEchec) setText(texteSiEchec);
      Alert.alert('Non envoye', e.message);
    }
  };

  const handleSend = () => {
    const contenu = text.trim();
    if (!contenu) return;
    setText('');
    envoyer(() => api.sendGroupeMessage(groupe.id, contenu), { contenu }, contenu);
  };
  const envoyerPhoto = async () => {
    let photo;
    try { photo = await choisirPhoto('galerie'); } catch (e) { return; }
    if (photo) envoyer(() => api.sendGroupeMessage(groupe.id, '', photo.base64), { imageLocale: photo.uri });
  };
  const envoyerVocal = (uri, duree) => {
    setEnregistre(false);
    envoyer(() => api.envoyerVocalGroupe(groupe.id, uri, duree), { audioLocal: uri, duree: Math.round(duree) });
  };

  const actionsMessage = (item) => {
    if (item.enAttente || !(item.user_id === moi?.id || infos.je_suis_admin)) return;
    Alert.alert('Message', undefined, [
      { text: 'Supprimer', style: 'destructive', onPress: () => api.supprimerMessageGroupe(groupe.id, item.id).then(reload).catch((e) => Alert.alert('Erreur', e.message)) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const handleLeave = () => {
    Alert.alert('Quitter', `Quitter le groupe ${groupe.nom} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', style: 'destructive', onPress: async () => {
        try { await api.quitterGroupe(groupe.id); onBack(); } catch (e) { Alert.alert('Erreur', e.message); }
      } },
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={10}><Ionicons name="chevron-back" size={26} color={colors.primary} /></TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }} onPress={() => setGestion(true)} activeOpacity={0.7}>
          <Avatar name={groupe.nom} size={36} index={groupe.id} />
          <View style={{ flex: 1 }}>
            <Text style={styles.chatName} numberOfLines={1}>{groupe.nom}</Text>
            <Text style={styles.chatDesc} numberOfLines={1}>{infos.membres.length ? `${infos.membres.length} membres · toucher pour les infos` : groupe.description}</Text>
          </View>
        </TouchableOpacity>
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
          renderItem={({ item }) => {
            const moiAuteur = item.user_id === moi?.id;
            return (
              <View style={[styles.msgRow, moiAuteur && { justifyContent: 'flex-end' }]}>
                {!moiAuteur ? (
                  <TouchableOpacity onPress={() => onVoirProfil(item.user_id)}>
                    <Avatar name={`${item.prenom} ${item.nom}`} size={30} index={item.user_id} avatar={item.avatar} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity activeOpacity={0.9} onLongPress={() => actionsMessage(item)}
                  style={[styles.msgBubble, moiAuteur && styles.msgMoi, item.enAttente && { opacity: 0.6 }]}>
                  {!moiAuteur ? <Text style={styles.msgUser}>{item.prenom} {item.nom}</Text> : null}
                  {item.image || item.imageLocale ? <PostImage uri={item.imageLocale || api.imageUrl(item.image)} style={{ width: 210, marginBottom: 4 }} /> : null}
                  {item.audio || item.audioLocal ? <BulleVocale uri={item.audioLocal || api.imageUrl(item.audio)} duree={item.duree} clair={moiAuteur} /> : null}
                  {item.contenu ? <TexteMentions texte={item.contenu} clair={moiAuteur} /> : null}
                  <Text style={[styles.msgTime, moiAuteur && { color: 'rgba(255,255,255,0.8)' }]}>{heure(item.date_envoi)}</Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Aucun message" hint="Lance la discussion ! Utilise @prenom pour mentionner quelqu'un." />}
        />
      )}
      {suggestions.length ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.suggestions}>
          {suggestions.map((m) => (
            <TouchableOpacity key={m.id} style={styles.suggestion} onPress={() => mentionner(m)}>
              <Avatar name={`${m.prenom} ${m.nom}`} size={22} index={m.id} avatar={m.avatar} />
              <Text style={styles.suggestionTexte}>@{m.prenom}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.inputBar}>
        {enregistre ? (
          <Enregistreur onEnvoyer={envoyerVocal} onAnnuler={() => setEnregistre(false)} />
        ) : (
          <>
            <TouchableOpacity style={styles.attache} onPress={envoyerPhoto} hitSlop={6}>
              <Ionicons name="image-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Ecris au groupe... (@ pour mentionner)" placeholderTextColor={colors.textFaint} multiline />
            <TouchableOpacity style={styles.sendBtn} onPress={text.trim() ? handleSend : () => setEnregistre(true)}>
              <Ionicons name={text.trim() ? 'send' : 'mic'} size={text.trim() ? 18 : 20} color={colors.white} />
            </TouchableOpacity>
          </>
        )}
      </View>
      <GestionGroupe visible={gestion} groupe={groupe} infos={infos} moi={moi} onFermer={() => setGestion(false)}
        onChange={chargerInfos} onVoirProfil={(id) => { setGestion(false); onVoirProfil(id); }} />
    </KeyboardAvoidingView>
  );
}

// Texte avec les @mentions en gras
function TexteMentions({ texte, clair }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const morceaux = texte.split(/(@[\w-]{2,40})/);
  return (
    <Text style={[styles.msgText, clair && { color: colors.white }]}>
      {morceaux.map((m, k) => (m.startsWith('@') ? <Text key={k} style={{ fontWeight: '800', color: clair ? colors.white : colors.primary }}>{m}</Text> : m))}
    </Text>
  );
}

// Infos du groupe : membres, et pour les admins : modifier, nommer admin, retirer
function GestionGroupe({ visible, groupe, infos, moi, onFermer, onChange, onVoirProfil }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [nom, setNom] = useState(groupe.nom);
  const [description, setDescription] = useState(groupe.description || '');
  useEffect(() => { setNom(groupe.nom); setDescription(groupe.description || ''); }, [groupe.nom, groupe.description]);

  const enregistrer = () => api.modifierGroupe(groupe.id, nom.trim(), description.trim())
    .then(() => { onChange(); Alert.alert('Groupe', 'Modifications enregistrees.'); })
    .catch((e) => Alert.alert('Erreur', e.message));

  const gerer = (m) => {
    if (!infos.je_suis_admin || m.id === moi?.id) { onVoirProfil(m.id); return; }
    Alert.alert(`${m.prenom} ${m.nom}`, undefined, [
      { text: 'Voir le profil', onPress: () => onVoirProfil(m.id) },
      m.role === 'admin'
        ? { text: "Retirer le role d'admin", onPress: () => api.gererMembre(groupe.id, m.id, 'membre').then(onChange).catch((e) => Alert.alert('Erreur', e.message)) }
        : { text: 'Nommer admin', onPress: () => api.gererMembre(groupe.id, m.id, 'admin').then(onChange).catch((e) => Alert.alert('Erreur', e.message)) },
      { text: 'Retirer du groupe', style: 'destructive', onPress: () => api.gererMembre(groupe.id, m.id, 'retirer').then(onChange).catch((e) => Alert.alert('Erreur', e.message)) },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.modalOverlay}>
        <View style={[styles.sheet, { maxHeight: '88%' }]}>
          <Text style={styles.sheetTitle}>Infos du groupe</Text>
          <ScrollView>
            {infos.je_suis_admin ? (
              <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
                <TextInput style={styles.field} value={nom} onChangeText={setNom} maxLength={100} placeholder="Nom du groupe" placeholderTextColor={colors.textFaint} />
                <TextInput style={[styles.field, { minHeight: 60 }]} value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Description" placeholderTextColor={colors.textFaint} />
                <PrimaryButton title="Enregistrer" icon="checkmark" onPress={enregistrer} />
              </View>
            ) : groupe.description ? <Text style={styles.groupDesc}>{groupe.description}</Text> : null}
            <Text style={styles.membresTitre}>{infos.membres.length} membres</Text>
            {infos.membres.map((m) => (
              <TouchableOpacity key={m.id} style={styles.membre} onPress={() => gerer(m)}>
                <Avatar name={`${m.prenom} ${m.nom}`} size={36} index={m.id} avatar={m.avatar} />
                <Text style={styles.membreNom}>{m.prenom} {m.nom}{m.id === moi?.id ? ' (toi)' : ''}</Text>
                {m.role === 'admin' ? <Text style={styles.badgeAdmin}>Admin</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cancel} onPress={onFermer}><Text style={styles.cancelText}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  segment: { flexDirection: 'row', backgroundColor: colors.card, margin: spacing.md, marginBottom: 0, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  segTextActive: { color: colors.white },
  promo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  promoTitre: { color: colors.white, fontWeight: '800', fontSize: 15 },
  promoTexte: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  groupItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: spacing.sm, gap: spacing.md },
  groupName: { fontWeight: '700', fontSize: 15, color: colors.text },
  groupDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  groupMeta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  joinBtn: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  joinText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 36 },
  sheetTitle: { ...font.heading, marginBottom: spacing.lg },
  field: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 14, fontSize: 15, marginBottom: spacing.sm, color: colors.text, textAlignVertical: 'top' },
  cancel: { alignItems: 'center', paddingTop: spacing.lg },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  chatName: { fontWeight: '700', fontSize: 16, color: colors.text },
  chatDesc: { fontSize: 12, color: colors.textMuted },
  msgRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginBottom: spacing.sm },
  msgBubble: { backgroundColor: colors.card, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '82%' },
  msgMoi: { backgroundColor: colors.primary, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 },
  msgUser: { fontSize: 12, fontWeight: '800', color: colors.primary, marginBottom: 1 },
  msgText: { fontSize: 15, lineHeight: 20, color: colors.text },
  msgTime: { fontSize: 10, color: colors.textFaint, marginTop: 3, alignSelf: 'flex-end' },
  suggestions: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.card },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  suggestionTexte: { color: colors.primary, fontWeight: '700' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  attache: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  input: { flex: 1, backgroundColor: colors.bg, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text },
  sendBtn: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  membresTitre: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  membre: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  membreNom: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  badgeAdmin: { fontSize: 11, fontWeight: '800', color: colors.accent, backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
}));
