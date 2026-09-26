// Discussion privee avec un etudiant : navigate('Conversation', { autre_id, prenom, nom, avatar })
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView } from 'react-native';
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
import { Fond, ChoixFondEcran, useFondEcran } from '../components/FondEcran';
import { useFocusEffect } from '@react-navigation/native';
import Medias from '../components/Medias';

const EMOJIS = ['❤️', '😂', '😮', '😢', '🙏', '👍'];
const extrait = (m) => (m.supprime ? 'Message supprime' : m.contenu || (m.audio || m.audioLocal ? 'Note vocale' : m.image || m.imageLocale ? 'Photo' : ''));
// un message ne peut etre supprime pour tous que pendant 48 h
const ageMs = (m) => Date.now() - new Date(`${String(m.date_envoi).slice(0, 19).replace(' ', 'T')}Z`).getTime();
const modifiable = (m) => !!m.contenu && !m.supprime && ageMs(m) < 15 * 60 * 1000;
// "en ligne", "vu aujourd'hui a 14:32", "vu hier a 09:10", "vu le 12/09"
function textePresence(p) {
  if (!p || p.masque) return null;
  if (p.en_ligne) return 'en ligne';
  if (!p.vu_a) return null;
  const d = new Date(`${p.vu_a.replace(' ', 'T')}Z`);
  const h = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const jours = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (jours <= 0) return `vu aujourd'hui a ${h}`;
  if (jours === 1) return `vu hier a ${h}`;
  return `vu le ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const supprimable = (m) => Date.now() - new Date(`${String(m.date_envoi).slice(0, 19).replace(' ', 'T')}Z`).getTime() < 48 * 3600 * 1000;

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
  const [reponse, setReponse] = useState(null); // message auquel je reponds
  const [actions, setActions] = useState(null); // message touche longuement
  const [transfert, setTransfert] = useState(null); // message a transferer
  const [edition, setEdition] = useState(null); // message en cours de modification
  const [presence, setPresence] = useState(null);
  const [choixFond, setChoixFond] = useState(false);
  const [medias, setMedias] = useState(false);
  const [recherche, setRecherche] = useState(null); // null = barre fermee
  const [position, setPosition] = useState(0); // resultat affiche (0 = le plus recent)
  const [surbrillance, setSurbrillance] = useState(conv.cible || null);
  const suivreFin = useRef(!conv.cible); // defile en bas a chaque nouveau contenu, sauf pendant une recherche

  const allerA = (id) => {
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    suivreFin.current = false;
    setSurbrillance(id);
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  };
  // arrivee depuis la recherche : on va au message trouve
  const cibleFaite = useRef(false);
  useEffect(() => {
    if (conv.cible && !cibleFaite.current && messages.some((m) => m.id === conv.cible)) {
      cibleFaite.current = true;
      setTimeout(() => allerA(conv.cible), 300);
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  // recherche dans la discussion (sur le telephone)
  const mot = (recherche || '').trim().toLowerCase();
  const resultats = mot.length >= 2 ? messages.filter((m) => (m.contenu || '').toLowerCase().includes(mot)).map((m) => m.id).reverse() : [];
  useEffect(() => {
    setPosition(0);
    if (resultats.length) allerA(resultats[0]);
  }, [mot]); // eslint-disable-line react-hooks/exhaustive-deps
  const naviguer = (sens) => {
    if (!resultats.length) return;
    const p = (position + sens + resultats.length) % resultats.length;
    setPosition(p);
    allerA(resultats[p]);
  };
  const fermerRecherche = () => { setRecherche(null); setSurbrillance(null); suivreFin.current = true; };
  const { fond } = useFondEcran(conv.autre_id);

  // "en ligne" / "vu a" : actualise toutes les 30 s tant que la discussion est ouverte
  useFocusEffect(React.useCallback(() => {
    let actif = true;
    const lire = () => api.getPresence(conv.autre_id).then((p) => actif && setPresence(p)).catch(() => {});
    lire();
    const minuteur = setInterval(lire, 30000);
    return () => { actif = false; clearInterval(minuteur); };
  }, [conv.autre_id]));
  const dernierSignal = useRef(0);

  // En-tete : photo + nom, touchable pour voir le profil
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity style={styles.header} onPress={() => navigation.navigate('ProfilEtudiant', { id: conv.autre_id })} activeOpacity={0.7}>
          <Avatar name={`${conv.prenom} ${conv.nom}`} size={34} index={conv.autre_id} avatar={conv.avatar} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>{conv.prenom} {conv.nom}</Text>
            {ecrit ? <Text style={styles.ecrit}>en train d'ecrire...</Text>
              : textePresence(presence) ? <Text style={styles.presence}>{textePresence(presence)}</Text> : null}
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={menu} hitSlop={10} style={{ marginRight: 4 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, conv, styles, ecrit, presence]); // eslint-disable-line react-hooks/exhaustive-deps

  // Menu de la discussion : effacer l'historique (pour moi seulement)
  const menu = () => Alert.alert(`${conv.prenom} ${conv.nom}`, undefined, [
    { text: 'Voir le profil', onPress: () => navigation.navigate('ProfilEtudiant', { id: conv.autre_id }) },
    { text: 'Rechercher dans la discussion', onPress: () => setRecherche('') },
    { text: 'Photos partagees', onPress: () => setMedias(true) },
    { text: "Fond d'ecran", onPress: () => setChoixFond(true) },
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

  // reaction, suppression pour tous : on recharge la discussion
  useEvenement('message_maj', (m) => {
    if (m.expediteur_id === conv.autre_id || m.destinataire_id === conv.autre_id) reload();
  });

  const reagir = async (message, emoji) => {
    setActions(null);
    try {
      const maj = await api.reagirMessage(message.id, emoji);
      setData((liste) => liste.map((x) => (x.id === message.id ? { ...x, reactions: maj.reactions } : x)));
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const supprimerPourTous = (message) => {
    setActions(null);
    Alert.alert('Supprimer pour tout le monde ?', `Le message disparaitra aussi chez ${conv.prenom}.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await api.supprimerMessage(message.id); reload(); } catch (e) { Alert.alert('Erreur', e.message); }
      } },
    ]);
  };

  // nom affiche dans une citation
  const auteurCite = (c) => (c.expediteur_id === conv.autre_id ? conv.prenom : 'Toi');

  // messages ecrits hors ligne pour cette discussion (affiches avec une horloge)
  const [enFile, setEnFile] = useState([]);
  const lireEnFile = () => api.lireFile().then((f) => setEnFile(f.filter((m) => m.destinataire_id === conv.autre_id)));
  useEffect(() => {
    lireEnFile();
    return api.surFileEnvoi((m) => { if (m.destinataire_id === conv.autre_id) { lireEnFile(); reload(); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commencerEdition = (m) => {
    setActions(null);
    setReponse(null);
    setEdition(m);
    setText(m.contenu);
  };
  const annulerEdition = () => { setEdition(null); setText(''); };

  const handleSend = async () => {
    if (!text.trim()) return;
    if (edition) {
      const m = edition;
      const contenu = text.trim();
      setEdition(null);
      setText('');
      setData((liste) => liste.map((x) => (x.id === m.id ? { ...x, contenu, modifie: true } : x)));
      try { await api.modifierMessage(m.id, contenu); }
      catch (e) { Alert.alert('Message non modifie', e.message); reload(); }
      return;
    }
    const contenu = text.trim();
    const cite = reponse;
    suivreFin.current = true;
    setSurbrillance(null);
    setText('');
    setReponse(null);
    // affichage immediat, remplace par la version du serveur ensuite
    const provisoire = { id: `tmp-${Date.now()}`, contenu, expediteur_id: -1, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true,
      reponse: cite ? { expediteur_id: cite.expediteur_id, extrait: extrait(cite) } : null };
    setData((m) => [...m, provisoire]);
    try {
      await api.sendMessage(conv.autre_id, contenu, null, cite?.id);
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== provisoire.id));
      if (/connexion internet/i.test(e.message)) {
        await api.mettreEnFile(conv.autre_id, contenu); // envoye automatiquement au retour du reseau
        lireEnFile();
        return;
      }
      setText(contenu);
      setReponse(cite);
      Alert.alert('Message non envoye', e.message);
    }
  };

  const envoyerVocal = async (uri, duree) => {
    setEnregistre(false);
    const provisoire = { id: `tmp-${Date.now()}`, contenu: '', audioLocal: uri, duree: Math.round(duree), expediteur_id: -1, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' '), enAttente: true };
    setData((m) => [...m, provisoire]);
    try {
      await api.envoyerVocal(conv.autre_id, uri, duree, reponse?.id);
      setReponse(null);
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
      await api.sendMessage(conv.autre_id, '', photo.base64, reponse?.id);
      setReponse(null);
      await reload();
    } catch (e) {
      setData((m) => m.filter((x) => x.id !== provisoire.id));
      Alert.alert('Photo non envoyee', e.message);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {recherche !== null ? (
        <View style={styles.barreRecherche}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput style={styles.rechercheChamp} value={recherche} onChangeText={setRecherche} placeholder="Chercher dans la discussion..."
            placeholderTextColor={colors.textFaint} autoFocus returnKeyType="search" onSubmitEditing={() => naviguer(1)} />
          <Text style={styles.rechercheCompte}>{mot.length >= 2 ? (resultats.length ? `${position + 1}/${resultats.length}` : '0') : ''}</Text>
          <TouchableOpacity onPress={() => naviguer(1)} hitSlop={8} accessibilityLabel="Resultat precedent"><Ionicons name="chevron-up" size={22} color={colors.text} /></TouchableOpacity>
          <TouchableOpacity onPress={() => naviguer(-1)} hitSlop={8} accessibilityLabel="Resultat suivant"><Ionicons name="chevron-down" size={22} color={colors.text} /></TouchableOpacity>
          <TouchableOpacity onPress={fermerRecherche} hitSlop={8}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
        </View>
      ) : null}
      <Fond fond={fond} style={{ flex: 1 }}>
      {loading ? <Loading /> : (
        <FlatList
          ref={listRef}
          style={styles.messageList}
          contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
          data={[...messages, ...enFile.map((m) => ({ ...m, expediteur_id: -1, enAttente: true, horsLigne: true }))]}
          keyExtractor={(item) => String(item.id)}
          onContentSizeChange={() => { if (suivreFin.current) listRef.current?.scrollToEnd({ animated: false }); }}
          onScrollToIndexFailed={(info) => {
            // hauteur des messages pas encore connue : on s'approche, puis on reessaie
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.4 }), 150);
          }}
          renderItem={({ item, index }) => {
            const recu = item.expediteur_id === conv.autre_id;
            const precedent = messages[index - 1];
            const nouveauJour = !precedent || !memeJour(precedent.date_envoi, item.date_envoi);
            return (
              <>
                {nouveauJour ? <Text style={styles.jour}>{jourLisible(item.date_envoi)}</Text> : null}
                <TouchableOpacity activeOpacity={0.85} delayLongPress={300}
                  onLongPress={item.enAttente || item.supprime ? undefined : () => setActions(item)}
                  style={[styles.msg, recu ? styles.msgReceived : styles.msgSent, item.enAttente && { opacity: 0.6 },
                    surbrillance === item.id && styles.surbrillance]}>
                  {item.transfere ? <Text style={[styles.transfere, !recu && styles.msgTimeSent]}>↪ Transfere</Text> : null}
                  {item.story_apercu ? (
                    <View style={[styles.citation, !recu && styles.citationEnvoyee]}>
                      <Text style={[styles.citationNom, !recu && { color: colors.white }]}>
                        🟢 {recu ? `A repondu a ton statut` : `Statut de ${conv.prenom}`}
                      </Text>
                      <Text style={[styles.citationTexte, !recu && styles.msgTimeSent]} numberOfLines={2}>{item.story_apercu}</Text>
                    </View>
                  ) : null}
                  {item.reponse ? (
                    <View style={[styles.citation, !recu && styles.citationEnvoyee]}>
                      <Text style={[styles.citationNom, !recu && { color: colors.white }]} numberOfLines={1}>{auteurCite(item.reponse)}</Text>
                      <Text style={[styles.citationTexte, !recu && styles.msgTimeSent]} numberOfLines={2}>{item.reponse.extrait}</Text>
                    </View>
                  ) : null}
                  {item.supprime ? <Text style={[styles.supprime, !recu && styles.msgTimeSent]}>🚫 Message supprime</Text> : null}
                  {item.image || item.imageLocale ? (
                    <PostImage uri={item.imageLocale || api.imageUrl(item.image)} style={styles.photo} />
                  ) : null}
                  {item.audio || item.audioLocal ? (
                    <BulleVocale uri={item.audioLocal || api.imageUrl(item.audio)} duree={item.duree} clair={!recu}
                      onEcoute={recu && !item.ecoute ? () => api.vocalEcoute(item.id).catch(() => {}) : undefined} />
                  ) : null}
                  {item.contenu ? <Text style={[styles.msgText, !recu && styles.msgTextSent]}>{item.contenu}</Text> : null}
                  <View style={styles.meta}>
                    {item.modifie ? <Text style={[styles.msgTime, !recu && styles.msgTimeSent]}>modifie</Text> : null}
                    {!recu && item.audio ? <Ionicons name="mic" size={12} color={item.ecoute ? '#7DD3FC' : 'rgba(255,255,255,0.8)'} /> : null}
                    <Text style={[styles.msgTime, !recu && styles.msgTimeSent]}>{heure(item.date_envoi)}</Text>
                    {item.horsLigne ? <Text style={styles.horsLigne}>en attente de reseau</Text> : null}
                    {!recu ? <Ionicons name={item.enAttente ? 'time-outline' : item.lu ? 'checkmark-done' : 'checkmark'} size={13} color="rgba(255,255,255,0.8)" /> : null}
                  </View>
                </TouchableOpacity>
                {item.reactions?.length ? (
                  <View style={[styles.reactions, recu ? { alignSelf: 'flex-start' } : { alignSelf: 'flex-end' }]}>
                    {item.reactions.map((x) => (
                      <TouchableOpacity key={x.emoji} style={[styles.reaction, x.moi && styles.reactionMoi]} onPress={() => reagir(item, x.emoji)}>
                        <Text style={styles.reactionTexte}>{x.emoji}{x.nb > 1 ? ` ${x.nb}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </>
            );
          }}
          ListEmptyComponent={<EmptyState icon="hand-left-outline" title="Dis bonjour !" hint={`Envoie ton premier message a ${conv.prenom}.`} />}
        />
      )}

      </Fond>
      {edition ? (
        <View style={styles.barreReponse}>
          <View style={styles.barreReponseTrait} />
          <View style={{ flex: 1 }}>
            <Text style={styles.citationNom}>Modifier le message</Text>
            <Text style={styles.citationTexte} numberOfLines={1}>{edition.contenu}</Text>
          </View>
          <TouchableOpacity onPress={annulerEdition} hitSlop={10}><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
        </View>
      ) : null}
      {reponse ? (
        <View style={styles.barreReponse}>
          <View style={styles.barreReponseTrait} />
          <View style={{ flex: 1 }}>
            <Text style={styles.citationNom}>Reponse a {reponse.expediteur_id === conv.autre_id ? conv.prenom : 'toi-meme'}</Text>
            <Text style={styles.citationTexte} numberOfLines={1}>{extrait(reponse)}</Text>
          </View>
          <TouchableOpacity onPress={() => setReponse(null)} hitSlop={10}><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.inputBar}>
        {enregistre ? (
          <Enregistreur onEnvoyer={envoyerVocal} onAnnuler={() => setEnregistre(false)} />
        ) : (
          <>
            <TouchableOpacity style={styles.attache} onPress={envoyerPhoto} hitSlop={6}>
              <Ionicons name="image-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
            <TextInput style={styles.input} value={text} onChangeText={surSaisie} placeholder="Ecris un message..." placeholderTextColor={colors.textFaint} multiline />
            {text.trim() || edition ? (
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
                <Ionicons name={edition ? 'checkmark' : 'send'} size={edition ? 22 : 18} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={() => setEnregistre(true)}>
                <Ionicons name="mic" size={20} color={colors.white} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      <Modal visible={!!actions} transparent animationType="fade" onRequestClose={() => setActions(null)}>
        <TouchableOpacity style={styles.fond} activeOpacity={1} onPress={() => setActions(null)}>
          {actions ? (
            <View style={styles.feuille}>
              <View style={styles.emojis}>
                {EMOJIS.map((e) => {
                  const mien = actions.reactions?.some((x) => x.moi && x.emoji === e);
                  return (
                    <TouchableOpacity key={e} style={[styles.emojiBtn, mien && styles.reactionMoi]} onPress={() => reagir(actions, e)} accessibilityLabel={`Reagir ${e}`}>
                      <Text style={{ fontSize: 28 }}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.apercu} numberOfLines={2}>{extrait(actions)}</Text>
              <Action icone="arrow-undo-outline" texte="Repondre" onPress={() => { setReponse(actions); setActions(null); }} />
              <Action icone="arrow-redo-outline" texte="Transferer" onPress={() => { setTransfert(actions); setActions(null); }} />
              {actions.expediteur_id !== conv.autre_id && modifiable(actions) ? (
                <Action icone="create-outline" texte="Modifier" onPress={() => commencerEdition(actions)} />
              ) : null}
              {actions.expediteur_id !== conv.autre_id && supprimable(actions) ? (
                <Action icone="trash-outline" texte="Supprimer pour tout le monde" danger onPress={() => supprimerPourTous(actions)} />
              ) : null}
            </View>
          ) : null}
        </TouchableOpacity>
      </Modal>
      <Transfert message={transfert} onFermer={() => setTransfert(null)} />
      <Medias visible={medias} titre={`Photos avec ${conv.prenom}`} charger={() => api.getMediasConversation(conv.autre_id)} onFermer={() => setMedias(false)} />
      <ChoixFondEcran visible={choixFond} onFermer={() => setChoixFond(false)} autreId={conv.autre_id} nom={conv.prenom} />
    </KeyboardAvoidingView>
  );
}

function Action({ icone, texte, onPress, danger }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.action} onPress={onPress}>
      <Ionicons name={icone} size={21} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.actionTexte, danger && { color: colors.danger }]}>{texte}</Text>
    </TouchableOpacity>
  );
}

// Choisir jusqu'a 5 discussions ou transferer le message
function Transfert({ message, onFermer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [convs, setConvs] = useState([]);
  const [choix, setChoix] = useState([]);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setChoix([]);
    if (message) api.getConversations().then(setConvs).catch(() => {});
  }, [message]);
  if (!message) return null;
  const basculer = (id) => setChoix((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 5 ? [...c, id] : c));
  const envoyer = async () => {
    setEnvoi(true);
    try {
      const r = await api.transfererMessage(message.id, choix);
      onFermer();
      Alert.alert('Transfere', r.envoyes > 1 ? `Envoye dans ${r.envoyes} discussions.` : 'Message transfere.');
    } catch (e) { Alert.alert('Erreur', e.message); }
    setEnvoi(false);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fondBas}>
        <View style={styles.feuilleBas}>
          <Text style={styles.feuilleTitre}>Transferer a...</Text>
          <Text style={styles.apercu} numberOfLines={2}>{extrait(message)}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {convs.length ? convs.map((c) => (
              <TouchableOpacity key={c.autre_id} style={styles.choixLigne} onPress={() => basculer(c.autre_id)}>
                <Avatar name={`${c.prenom} ${c.nom}`} size={40} index={c.autre_id} avatar={c.avatar} />
                <Text style={styles.choixNom} numberOfLines={1}>{c.prenom} {c.nom}</Text>
                <Ionicons name={choix.includes(c.autre_id) ? 'checkmark-circle' : 'ellipse-outline'} size={24}
                  color={choix.includes(c.autre_id) ? colors.primary : colors.textFaint} />
              </TouchableOpacity>
            )) : <Text style={styles.apercu}>Aucune autre discussion pour l'instant.</Text>}
          </ScrollView>
          <TouchableOpacity style={[styles.btnEnvoyer, (!choix.length || envoi) && { opacity: 0.5 }]} disabled={!choix.length || envoi} onPress={envoyer}>
            <Text style={styles.btnEnvoyerTexte}>{envoi ? 'Envoi...' : `Envoyer${choix.length ? ` (${choix.length})` : ''}`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onFermer} style={{ alignItems: 'center', padding: spacing.md }}>
            <Text style={styles.annuler}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: 240 },
  headerName: { fontWeight: '800', fontSize: 16, color: colors.text },
  ecrit: { fontSize: 12, color: colors.accent, fontStyle: 'italic' },
  presence: { fontSize: 12, color: colors.textMuted },
  surbrillance: { borderWidth: 2, borderColor: '#FACC15' },
  barreRecherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  rechercheChamp: { flex: 1, paddingVertical: 8, fontSize: 15, color: colors.text },
  rechercheCompte: { fontSize: 12, color: colors.textMuted, minWidth: 30, textAlign: 'right' },
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
  horsLigne: { fontSize: 10, color: 'rgba(255,255,255,0.85)', fontStyle: 'italic' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text },
  transfere: { fontSize: 11, fontStyle: 'italic', color: colors.textMuted, marginBottom: 2 },
  supprime: { fontSize: 14, fontStyle: 'italic', color: colors.textMuted },
  citation: { borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 5 },
  citationEnvoyee: { borderLeftColor: colors.white, backgroundColor: 'rgba(255,255,255,0.18)' },
  citationNom: { fontSize: 12, fontWeight: '800', color: colors.primary },
  citationTexte: { fontSize: 13, color: colors.textMuted },
  reactions: { flexDirection: 'row', gap: 4, marginTop: -4, marginBottom: 6, marginHorizontal: 6 },
  reaction: { backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: colors.border },
  reactionMoi: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reactionTexte: { fontSize: 13, color: colors.text },
  barreReponse: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  barreReponseTrait: { width: 3, alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: 2 },
  fond: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  feuille: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg },
  emojis: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  emojiBtn: { borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: 'transparent' },
  apercu: { fontSize: 13, color: colors.textMuted, marginVertical: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  actionTexte: { fontSize: 16, fontWeight: '600', color: colors.text },
  fondBas: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  feuilleBas: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 24 },
  feuilleTitre: { fontSize: 18, fontWeight: '800', color: colors.text },
  choixLigne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  choixNom: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  btnEnvoyer: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  btnEnvoyerTexte: { color: colors.white, fontWeight: '800', fontSize: 16 },
  annuler: { color: colors.textMuted, fontWeight: '600' },
  sendBtn: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
