// Discussion privee avec un etudiant : navigate('Conversation', { autre_id, prenom, nom, avatar })
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import { choisirPhoto } from '../photos';
import { BulleVocale, Enregistreur } from '../components/NoteVocale';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { heure, jourLisible, memeJour } from '../utils';
import { useEvenement, useRealtime } from '../realtime';

export default function ConversationScreen({ route, navigation }) {
  const conv = route.params;
  const styles = useStyles();
  const { colors } = useTheme();
  const listRef = useRef(null);
  const { data: messages, setData, loading, reload } = useApiList(() => api.getMessages(conv.autre_id));
  const [text, setText] = useState('');
  const { rafraichirCompteurs, emettre } = useRealtime();
  const [ecrit, setEcrit] = useState(false); // l'autre est en train d'ecrire
  const [enregistre, setEnregistre] = useState(false); // enregistrement d'une note vocale en cours
  const minuterieEcrit = useRef(null);
  const dernierSignal = useRef(0);

  // En-tete : photo + nom, touchable pour voir le profil
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity style={styles.header} onPress={() => navigation.navigate('ProfilEtudiant', { id: conv.autre_id })} activeOpacity={0.7}>
          <Avatar name={`${conv.prenom} ${conv.nom}`} size={34} index={conv.autre_id} avatar={conv.avatar} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>{conv.prenom} {conv.nom}</Text>
            {ecrit ? <Text style={styles.ecrit}>en train d'ecrire...</Text> : null}
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={menu} hitSlop={10} style={{ marginRight: 4 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, conv, styles, ecrit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Menu de la discussion : effacer l'historique (pour moi seulement)
  const menu = () => Alert.alert(`${conv.prenom} ${conv.nom}`, undefined, [
    { text: 'Voir le profil', onPress: () => navigation.navigate('ProfilEtudiant', { id: conv.autre_id }) },
    {
      text: "Effacer l'historique",
      style: 'destructive',
      onPress: () => Alert.alert("Effacer l'historique ?", `Les messages disparaissent pour toi seulement ; ${conv.prenom} garde les siens.`, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Effacer', style: 'destructive', onPress: () => api.effacerConversation(conv.autre_id).then(reload).catch((e) => Alert.alert('Erreur', e.message)) },
      ]),
    },
    { text: 'Fermer', style: 'cancel' },
  ]);

  // "en train d'ecrire..." : affiche 4 s apres le dernier signal de l'autre
  useEvenement('typing_indicator', (d) => {
    if (d.user_id !== conv.autre_id) return;
    setEcrit(true);
    clearTimeout(minuterieEcrit.current);
    minuterieEcrit.current = setTimeout(() => setEcrit(false), 4000);
  });
  useEffect(() => () => clearTimeout(minuterieEcrit.current), []);

  // l'autre a ouvert la conversation : mes messages passent en "Vu"
  useEvenement('messages_lus', (d) => {
    if (d.par === conv.autre_id) setData((m) => m.map((x) => (x.expediteur_id === conv.autre_id ? x : { ...x, lu: 1 })));
  });

  const surSaisie = (t) => {
    setText(t);
    if (t && Date.now() - dernierSignal.current > 2500) { // au plus un signal toutes les 2,5 s
      dernierSignal.current = Date.now();
      emettre('typing', { destinataire_id: conv.autre_id });
    }
  };

  // message de cette conversation : on recharge (ce qui le marque aussi comme lu)
  useEvenement('message_recu', async (m) => {
    if (m.expediteur_id === conv.autre_id || m.destinataire_id === conv.autre_id) {
      if (m.expediteur_id === conv.autre_id) setEcrit(false);
      await reload();
      rafraichirCompteurs();
    }
  });

  const handleSend = async () => {
    if (!text.trim()) return;
    const contenu = text.trim();
    setText('');
    // affichage immediat, remplace par la version du serveur ensuite
    const provisoire = { id: `tmp-${Date.now()}`, contenu, expediteur_id: -1, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true };
    setData((m) => [...m, provisoire]);
    try {
      await api.sendMessage(conv.autre_id, contenu);
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== provisoire.id));
      setText(contenu);
      Alert.alert('Message non envoye', e.message);
    }
  };

  const envoyerVocal = async (uri, duree) => {
    setEnregistre(false);
    const provisoire = { id: `tmp-${Date.now()}`, contenu: '', audioLocal: uri, duree: Math.round(duree), expediteur_id: -1, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true };
    setData((m) => [...m, provisoire]);
    try {
      await api.envoyerVocal(conv.autre_id, uri, duree);
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== provisoire.id));
      Alert.alert('Note vocale non envoyee', e.message);
    }
  };

  const envoyerPhoto = async () => {
    let photo;
    try {
      photo = await choisirPhoto('galerie');
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
      return;
    }
    if (!photo) return;
    const provisoire = { id: `tmp-${Date.now()}`, contenu: '', imageLocale: photo.uri, expediteur_id: -1, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true };
    setData((m) => [...m, provisoire]);
    try {
      await api.sendMessage(conv.autre_id, '', photo.base64);
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== provisoire.id));
      Alert.alert('Photo non envoyee', e.message);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {loading ? <Loading /> : (
        <FlatList
          ref={listRef}
          style={styles.messageList}
          contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item, index }) => {
            const recu = item.expediteur_id === conv.autre_id;
            const precedent = messages[index - 1];
            const nouveauJour = !precedent || !memeJour(precedent.date_envoi, item.date_envoi);
            return (
              <>
                {nouveauJour ? <Text style={styles.jour}>{jourLisible(item.date_envoi)}</Text> : null}
                <View style={[styles.msg, recu ? styles.msgReceived : styles.msgSent, item.enAttente && { opacity: 0.6 }]}>
                  {item.image || item.imageLocale ? (
                    <PostImage uri={item.imageLocale || api.imageUrl(item.image)} style={styles.photo} />
                  ) : null}
                  {item.audio || item.audioLocal ? (
                    <BulleVocale uri={item.audioLocal || api.imageUrl(item.audio)} duree={item.duree} clair={!recu} />
                  ) : null}
                  {item.contenu ? <Text style={[styles.msgText, !recu && styles.msgTextSent]}>{item.contenu}</Text> : null}
                  <View style={styles.meta}>
                    <Text style={[styles.msgTime, !recu && styles.msgTimeSent]}>{heure(item.date_envoi)}</Text>
                    {!recu ? <Ionicons name={item.enAttente ? 'time-outline' : item.lu ? 'checkmark-done' : 'checkmark'} size={13} color="rgba(255,255,255,0.8)" /> : null}
                  </View>
                </View>
              </>
            );
          }}
          ListEmptyComponent={<EmptyState icon="hand-left-outline" title="Dis bonjour !" hint={`Envoie ton premier message a ${conv.prenom}.`} />}
        />
      )}

      <View style={styles.inputBar}>
        {enregistre ? (
          <Enregistreur onEnvoyer={envoyerVocal} onAnnuler={() => setEnregistre(false)} />
        ) : (
          <>
            <TouchableOpacity style={styles.attache} onPress={envoyerPhoto} hitSlop={6}>
              <Ionicons name="image-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TextInput style={styles.input} value={text} onChangeText={surSaisie} placeholder="Ecris un message..." placeholderTextColor={colors.textFaint} multiline />
            {text.trim() ? (
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
                <Ionicons name="send" size={18} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={() => setEnregistre(true)}>
                <Ionicons name="mic" size={20} color={colors.white} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: 240 },
  headerName: { fontWeight: '800', fontSize: 16, color: colors.text },
  ecrit: { fontSize: 12, color: colors.accent, fontStyle: 'italic' },
  photo: { width: 220, marginBottom: 4, borderRadius: 14 },
  attache: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  messageList: { flex: 1 },
  jour: { alignSelf: 'center', fontSize: 11, fontWeight: '700', color: colors.textMuted, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginVertical: spacing.sm, overflow: 'hidden' },
  msg: { marginBottom: 6, maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  msgSent: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  msgReceived: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 6 },
  msgText: { fontSize: 15, lineHeight: 20, color: colors.text },
  msgTextSent: { color: colors.white },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 3 },
  msgTime: { fontSize: 10, color: colors.textFaint },
  msgTimeSent: { color: 'rgba(255,255,255,0.8)' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text },
  sendBtn: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
