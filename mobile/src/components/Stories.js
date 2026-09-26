// Statuts 24 h (comme WhatsApp) : bandeau de ronds en haut du fil + lecteur plein ecran.
// Photo ou texte sur fond colore ; anneau gris une fois vu ; "vu par" pour mes statuts ; repondre en message prive.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Image, Animated, TextInput, Alert, StatusBar, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from './Avatar';
import { choisirPhoto } from '../photos';
import { spacing, radius, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

const DUREE_STORY = 5000; // ms par statut
const FONDS = ['#FF6B35', '#009E60', '#2563EB', '#7C3AED', '#DB2777', '#0F172A', '#D97706', '#0891B2'];

export default function StoriesBar({ moi, rechargement }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [groupes, setGroupes] = useState([]);
  const [ouvert, setOuvert] = useState(null); // index du groupe affiche
  const [nouvelle, setNouvelle] = useState(null); // { photo } ou { texte: true }

  const charger = () => api.getStories().then(setGroupes).catch(() => {});
  useEffect(() => { charger(); }, [rechargement]);

  const miennes = groupes.find((g) => g.est_moi);
  const autres = groupes.filter((g) => !g.est_moi);

  const ajouterPhoto = async () => {
    try {
      const p = await choisirPhoto('galerie');
      if (p) setNouvelle({ photo: p });
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };
  const ajouter = () => Alert.alert('Nouveau statut', 'Visible 24 h par les etudiants de LinkCI', [
    { text: '🖼️ Photo', onPress: ajouterPhoto },
    { text: '✍️ Texte', onPress: () => setNouvelle({ texte: true }) },
    { text: 'Annuler', style: 'cancel' },
  ]);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bandeau}>
        <TouchableOpacity style={styles.item} onPress={() => (miennes ? setOuvert(groupes.indexOf(miennes)) : ajouter())} onLongPress={ajouter}>
          <View style={[styles.anneau, miennes ? styles.anneauActif : styles.anneauVide]}>
            {moi ? <Avatar name={`${moi.prenom} ${moi.nom}`} size={56} index={moi.id} avatar={moi.avatar} /> : null}
          </View>
          <TouchableOpacity style={styles.plus} onPress={ajouter} hitSlop={8}>
            <Ionicons name="add" size={14} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.nom} numberOfLines={1}>Mon statut</Text>
        </TouchableOpacity>
        {autres.map((g) => (
          <TouchableOpacity key={g.user_id} style={styles.item} onPress={() => setOuvert(groupes.indexOf(g))}>
            <View style={[styles.anneau, g.tout_vu ? styles.anneauVu : styles.anneauActif]}>
              <Avatar name={`${g.prenom} ${g.nom}`} size={56} index={g.user_id} avatar={g.avatar} />
            </View>
            <Text style={[styles.nom, !g.tout_vu && { color: colors.text }]} numberOfLines={1}>{g.prenom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {ouvert !== null && groupes[ouvert] ? (
        <LecteurStories groupes={groupes} depart={ouvert} onFermer={() => { setOuvert(null); charger(); }} />
      ) : null}
      {nouvelle ? <NouvelleStory photo={nouvelle.photo} onFermer={() => setNouvelle(null)} onPubliee={() => { setNouvelle(null); charger(); }} /> : null}
    </>
  );
}

function LecteurStories({ groupes, depart, onFermer }) {
  const styles = useStyles();
  const [g, setG] = useState(depart);
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const [reponse, setReponse] = useState('');
  const [vues, setVues] = useState(null); // liste "vu par" ouverte
  const progression = useRef(new Animated.Value(0)).current;
  const valeur = useRef(0);
  const groupe = groupes[g];
  const story = groupe.stories[i];

  const suivante = () => {
    setReponse('');
    if (i + 1 < groupe.stories.length) setI(i + 1);
    else if (g + 1 < groupes.length) { setG(g + 1); setI(0); }
    else onFermer();
  };
  const precedente = () => {
    if (i > 0) setI(i - 1);
    else if (g > 0) { setG(g - 1); setI(0); }
  };

  // vu : note chez l'auteur (sauf mes statuts)
  useEffect(() => {
    valeur.current = 0;
    progression.setValue(0);
    if (!groupe.est_moi && !story.vue) api.voirStory(story.id).catch(() => {});
  }, [g, i]); // eslint-disable-line react-hooks/exhaustive-deps

  // defilement automatique, en pause pendant une reponse ou la liste des vues
  useEffect(() => {
    if (pause) return undefined;
    const id = progression.addListener(({ value }) => { valeur.current = value; });
    const anim = Animated.timing(progression, { toValue: 1, duration: DUREE_STORY * (1 - valeur.current), useNativeDriver: false });
    anim.start(({ finished }) => finished && suivante());
    return () => { anim.stop(); progression.removeListener(id); };
  }, [g, i, pause]); // eslint-disable-line react-hooks/exhaustive-deps

  const supprimer = () => {
    setPause(true);
    Alert.alert('Supprimer', 'Supprimer ce statut ?', [
      { text: 'Annuler', style: 'cancel', onPress: () => setPause(false) },
      { text: 'Supprimer', style: 'destructive', onPress: () => api.supprimerStory(story.id).then(onFermer).catch((e) => Alert.alert('Erreur', e.message)) },
    ]);
  };

  const envoyerReponse = async () => {
    const texte = reponse.trim();
    if (!texte) return;
    try {
      await api.sendMessage(groupe.user_id, texte, null, null, story.id);
      setReponse('');
      Alert.alert('Envoye', `Ta reponse est dans ta discussion avec ${groupe.prenom}.`, [{ text: 'OK', onPress: () => setPause(false) }]);
    } catch (e) { Alert.alert('Non envoye', e.message); }
  };

  const ouvrirVues = async () => {
    setPause(true);
    try { setVues(await api.getVuesStory(story.id)); } catch (e) { setVues([]); }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onFermer} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={[styles.lecteur, !story.image && { backgroundColor: story.fond || FONDS[0] }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {story.image ? <Image source={{ uri: api.imageUrl(story.image) }} style={styles.photoPlein} resizeMode="contain" /> : (
          <View style={styles.texteCentre}><Text style={styles.texteStatut}>{story.texte}</Text></View>
        )}
        <View style={styles.barres}>
          {groupe.stories.map((s, k) => (
            <View key={s.id} style={styles.barreFond}>
              <Animated.View style={[styles.barrePleine, {
                width: k < i ? '100%' : k === i ? progression.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%',
              }]} />
            </View>
          ))}
        </View>
        <View style={styles.entete}>
          <Avatar name={`${groupe.prenom} ${groupe.nom}`} size={34} index={groupe.user_id} avatar={groupe.avatar} />
          <Text style={styles.enteteNom}>{groupe.est_moi ? 'Mon statut' : groupe.prenom}</Text>
          <Text style={styles.enteteDate}>{dateRelative(story.date_creation)}</Text>
          <View style={{ flex: 1 }} />
          {groupe.est_moi ? <TouchableOpacity onPress={supprimer} hitSlop={10}><Ionicons name="trash-outline" size={22} color="#fff" /></TouchableOpacity> : null}
          <TouchableOpacity onPress={onFermer} hitSlop={10} style={{ marginLeft: 14 }}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
        </View>
        {/* toucher a gauche : precedent, a droite : suivant ; appui long : pause */}
        <View style={styles.zones}>
          <Pressable style={{ flex: 1 }} onPress={precedente} onLongPress={() => setPause(true)} onPressOut={() => !reponse && !vues && setPause(false)} />
          <Pressable style={{ flex: 2 }} onPress={suivante} onLongPress={() => setPause(true)} onPressOut={() => !reponse && !vues && setPause(false)} />
        </View>
        {story.image && story.texte ? <Text style={styles.legende}>{story.texte}</Text> : null}
        {groupe.est_moi ? (
          <TouchableOpacity style={styles.vuPar} onPress={ouvrirVues}>
            <Ionicons name="eye-outline" size={20} color="#fff" />
            <Text style={styles.vuParTexte}>{story.nb_vues || 0} vue{(story.nb_vues || 0) > 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.composer}>
            <TextInput style={styles.composerTexte} placeholder={`Repondre a ${groupe.prenom}...`} placeholderTextColor="rgba(255,255,255,0.7)"
              value={reponse} onChangeText={setReponse} onFocus={() => setPause(true)} onBlur={() => !reponse && setPause(false)} maxLength={500} />
            {reponse.trim() ? (
              <TouchableOpacity style={styles.envoyer} onPress={envoyerReponse}><Ionicons name="send" size={18} color="#fff" /></TouchableOpacity>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={!!vues} transparent animationType="slide" onRequestClose={() => { setVues(null); setPause(false); }}>
        <Pressable style={styles.fondVues} onPress={() => { setVues(null); setPause(false); }}>
          <Pressable style={styles.feuilleVues}>
            <Text style={styles.titreVues}>👁 Vu par {vues?.length || 0}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {vues?.length ? vues.map((v) => (
                <View key={v.id} style={styles.ligneVue}>
                  <Avatar name={`${v.prenom} ${v.nom}`} size={38} index={v.id} avatar={v.avatar} />
                  <Text style={styles.nomVue}>{v.prenom} {v.nom}</Text>
                  <Text style={styles.dateVue}>{dateRelative(v.date_vue)}</Text>
                </View>
              )) : <Text style={styles.dateVue}>Personne ne l'a encore vu.</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

// photo : statut photo (legende facultative) ; sinon statut texte sur fond colore
function NouvelleStory({ photo, onFermer, onPubliee }) {
  const styles = useStyles();
  const [texte, setTexte] = useState('');
  const [fond, setFond] = useState(FONDS[0]);
  const [envoi, setEnvoi] = useState(false);

  const publier = async () => {
    if (!photo && !texte.trim()) return;
    setEnvoi(true);
    try {
      await api.creerStory(photo ? photo.base64 : null, texte.trim(), photo ? '' : fond);
      onPubliee();
    } catch (e) {
      Alert.alert('Erreur', e.message);
      setEnvoi(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onFermer} statusBarTranslucent>
      <KeyboardAvoidingView style={[styles.lecteur, !photo && { backgroundColor: fond }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {photo ? <Image source={{ uri: photo.uri }} style={styles.photoPlein} resizeMode="contain" /> : (
          <View style={styles.texteCentre}>
            <TextInput style={styles.texteStatut} placeholder="Ecris ton statut..." placeholderTextColor="rgba(255,255,255,0.7)"
              value={texte} onChangeText={setTexte} maxLength={250} multiline autoFocus />
          </View>
        )}
        <View style={[styles.entete, { paddingTop: 44 }]}>
          <TouchableOpacity onPress={onFermer} hitSlop={10}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
          <View style={{ flex: 1 }} />
          {!photo ? (
            <TouchableOpacity onPress={() => setFond(FONDS[(FONDS.indexOf(fond) + 1) % FONDS.length])} hitSlop={10} accessibilityLabel="Changer la couleur">
              <Ionicons name="color-palette" size={26} color="#fff" />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.composer}>
          {photo ? (
            <TextInput style={styles.composerTexte} placeholder="Ajoute une legende (optionnel)" placeholderTextColor="rgba(255,255,255,0.7)"
              value={texte} onChangeText={setTexte} maxLength={150} />
          ) : <View style={{ flex: 1 }} />}
          <TouchableOpacity style={[styles.publier, (!photo && !texte.trim()) && { opacity: 0.5 }]} onPress={publier} disabled={envoi || (!photo && !texte.trim())}>
            <Text style={styles.publierTexte}>{envoi ? '...' : 'Publier 24 h'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  bandeau: { gap: spacing.md, paddingBottom: spacing.md, paddingHorizontal: spacing.xs },
  item: { alignItems: 'center', width: 70 },
  anneau: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  anneauActif: { borderColor: colors.primary },
  anneauVu: { borderColor: colors.border },
  anneauVide: { borderColor: colors.border, borderStyle: 'dashed' },
  plus: { position: 'absolute', top: 46, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  nom: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontWeight: '600' },
  lecteur: { flex: 1, backgroundColor: '#000' },
  photoPlein: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  texteCentre: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 28 },
  texteStatut: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', lineHeight: 34, minWidth: 200 },
  barres: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingTop: 44 },
  barreFond: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barrePleine: { height: 3, backgroundColor: '#fff' },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, zIndex: 2 },
  enteteNom: { color: '#fff', fontWeight: '800', fontSize: 15 },
  enteteDate: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  zones: { position: 'absolute', top: 110, bottom: 100, left: 0, right: 0, flexDirection: 'row' },
  legende: { position: 'absolute', bottom: 100, left: 20, right: 20, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 10, borderRadius: radius.md, overflow: 'hidden' },
  composer: { position: 'absolute', bottom: 34, left: 16, right: 16, flexDirection: 'row', gap: 10, alignItems: 'center' },
  composerTexte: { flex: 1, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  envoyer: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  publier: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12 },
  publierTexte: { color: '#fff', fontWeight: '800' },
  vuPar: { position: 'absolute', bottom: 34, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  vuParTexte: { color: '#fff', fontWeight: '700', fontSize: 15 },
  fondVues: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  feuilleVues: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 30 },
  titreVues: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  ligneVue: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  nomVue: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  dateVue: { fontSize: 12, color: colors.textMuted },
}));
