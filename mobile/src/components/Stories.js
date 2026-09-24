// Stories 24 h : bandeau de ronds en haut du fil + lecteur plein ecran
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Image, Animated, TextInput, Alert, StatusBar, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from './Avatar';
import { choisirPhoto } from '../photos';
import { spacing, radius, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

const DUREE_STORY = 5000; // ms par story

export default function StoriesBar({ moi, rechargement }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [groupes, setGroupes] = useState([]);
  const [ouvert, setOuvert] = useState(null); // index du groupe affiche
  const [nouvelle, setNouvelle] = useState(null); // photo choisie pour ma story

  const charger = () => api.getStories().then(setGroupes).catch(() => {});
  useEffect(() => { charger(); }, [rechargement]);

  const miennes = groupes.find((g) => g.est_moi);
  const autres = groupes.filter((g) => !g.est_moi);

  const ajouter = async () => {
    try {
      const p = await choisirPhoto('galerie');
      if (p) setNouvelle(p);
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };

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
          <Text style={styles.nom} numberOfLines={1}>Ma story</Text>
        </TouchableOpacity>
        {autres.map((g) => (
          <TouchableOpacity key={g.user_id} style={styles.item} onPress={() => setOuvert(groupes.indexOf(g))}>
            <View style={[styles.anneau, styles.anneauActif]}>
              <Avatar name={`${g.prenom} ${g.nom}`} size={56} index={g.user_id} avatar={g.avatar} />
            </View>
            <Text style={styles.nom} numberOfLines={1}>{g.prenom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {ouvert !== null && groupes[ouvert] ? (
        <LecteurStories groupes={groupes} depart={ouvert} onFermer={() => { setOuvert(null); charger(); }} />
      ) : null}
      {nouvelle ? <NouvelleStory photo={nouvelle} onFermer={() => setNouvelle(null)} onPubliee={() => { setNouvelle(null); charger(); }} /> : null}
    </>
  );
}

function LecteurStories({ groupes, depart, onFermer }) {
  const styles = useStyles();
  const [g, setG] = useState(depart);
  const [i, setI] = useState(0);
  const progression = useRef(new Animated.Value(0)).current;
  const groupe = groupes[g];
  const story = groupe.stories[i];

  const suivante = () => {
    if (i + 1 < groupe.stories.length) setI(i + 1);
    else if (g + 1 < groupes.length) { setG(g + 1); setI(0); }
    else onFermer();
  };
  const precedente = () => {
    if (i > 0) setI(i - 1);
    else if (g > 0) { setG(g - 1); setI(0); }
  };

  useEffect(() => {
    progression.setValue(0);
    const anim = Animated.timing(progression, { toValue: 1, duration: DUREE_STORY, useNativeDriver: false });
    anim.start(({ finished }) => finished && suivante());
    return () => anim.stop();
  }, [g, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const supprimer = () => Alert.alert('Supprimer', 'Supprimer cette story ?', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => api.supprimerStory(story.id).then(onFermer).catch((e) => Alert.alert('Erreur', e.message)) },
  ]);

  return (
    <Modal visible animationType="fade" onRequestClose={onFermer} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={styles.lecteur}>
        <Image source={{ uri: api.imageUrl(story.image) }} style={styles.photoPlein} resizeMode="contain" />
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
          <Text style={styles.enteteNom}>{groupe.est_moi ? 'Ma story' : groupe.prenom}</Text>
          <Text style={styles.enteteDate}>{dateRelative(story.date_creation)}</Text>
          <View style={{ flex: 1 }} />
          {groupe.est_moi ? <TouchableOpacity onPress={supprimer} hitSlop={10}><Ionicons name="trash-outline" size={22} color="#fff" /></TouchableOpacity> : null}
          <TouchableOpacity onPress={onFermer} hitSlop={10} style={{ marginLeft: 14 }}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
        </View>
        {/* toucher a gauche : precedente, a droite : suivante */}
        <View style={styles.zones}>
          <Pressable style={{ flex: 1 }} onPress={precedente} />
          <Pressable style={{ flex: 2 }} onPress={suivante} />
        </View>
        {story.texte ? <Text style={styles.legende}>{story.texte}</Text> : null}
      </View>
    </Modal>
  );
}

function NouvelleStory({ photo, onFermer, onPubliee }) {
  const styles = useStyles();
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const publier = async () => {
    setEnvoi(true);
    try {
      await api.creerStory(photo.base64, texte.trim());
      onPubliee();
    } catch (e) {
      Alert.alert('Erreur', e.message);
      setEnvoi(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onFermer} statusBarTranslucent>
      <View style={styles.lecteur}>
        <Image source={{ uri: photo.uri }} style={styles.photoPlein} resizeMode="contain" />
        <View style={styles.entete}>
          <TouchableOpacity onPress={onFermer} hitSlop={10}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
        </View>
        <View style={styles.composer}>
          <TextInput style={styles.composerTexte} placeholder="Ajoute un texte (optionnel)" placeholderTextColor="rgba(255,255,255,0.7)"
            value={texte} onChangeText={setTexte} maxLength={150} />
          <TouchableOpacity style={styles.publier} onPress={publier} disabled={envoi}>
            <Text style={styles.publierTexte}>{envoi ? '...' : 'Publier 24 h'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  bandeau: { gap: spacing.md, paddingBottom: spacing.md, paddingHorizontal: spacing.xs },
  item: { alignItems: 'center', width: 70 },
  anneau: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  anneauActif: { borderColor: colors.primary },
  anneauVide: { borderColor: colors.border, borderStyle: 'dashed' },
  plus: { position: 'absolute', top: 46, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  nom: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontWeight: '600' },
  lecteur: { flex: 1, backgroundColor: '#000' },
  photoPlein: { ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
  barres: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingTop: 44 },
  barreFond: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barrePleine: { height: 3, backgroundColor: '#fff' },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, zIndex: 2 },
  enteteNom: { color: '#fff', fontWeight: '800', fontSize: 15 },
  enteteDate: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  zones: { position: 'absolute', top: 110, bottom: 90, left: 0, right: 0, flexDirection: 'row' },
  legende: { position: 'absolute', bottom: 60, left: 20, right: 20, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 10, borderRadius: radius.md, overflow: 'hidden' },
  composer: { position: 'absolute', bottom: 40, left: 16, right: 16, flexDirection: 'row', gap: 10, alignItems: 'center' },
  composerTexte: { flex: 1, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15 },
  publier: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12 },
  publierTexte: { color: '#fff', fontWeight: '800' },
}));
