// Notes vocales : bulle de lecture et enregistreur (expo-av)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { spacing, creerStyles, useTheme } from '../theme';

const DUREE_MAX = 180; // secondes, comme la limite du serveur
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Une seule note lue a la fois dans toute l'app
let lectureEnCours = null; // { son, arreter }
const VITESSES = [1, 1.5, 2];

// onEcoute : appele a la premiere lecture (note recue -> "ecoutee" chez l'expediteur)
export function BulleVocale({ uri, duree, clair, onEcoute }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const son = useRef(null);
  const [lecture, setLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [vitesse, setVitesse] = useState(1);
  const signale = useRef(false);
  const couleur = clair ? colors.white : colors.primary;

  // arret complet : retour au debut, plus rien ne joue (fin de la note, autre note, ecran quitte)
  const arreter = async () => {
    setLecture(false);
    setPosition(0);
    await son.current?.stopAsync().catch(() => {});
  };

  useEffect(() => () => {
    if (lectureEnCours?.son === son.current) lectureEnCours = null;
    son.current?.unloadAsync().catch(() => {});
  }, []);

  const basculer = async () => {
    try {
      if (lecture) {
        await son.current?.pauseAsync();
        setLecture(false);
        return;
      }
      if (lectureEnCours && lectureEnCours.son !== son.current) await lectureEnCours.arreter();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (!son.current) {
        const { sound } = await Audio.Sound.createAsync({ uri }, { progressUpdateIntervalMillis: 250, rate: vitesse, shouldCorrectPitch: true }, (st) => {
          if (!st.isLoaded) return;
          if (st.didJustFinish) {
            // fin de la note : on coupe (sans ca, Android peut la relancer en boucle)
            setLecture(false);
            setPosition(0);
            sound.stopAsync().catch(() => {});
            if (lectureEnCours?.son === sound) lectureEnCours = null;
            return;
          }
          setPosition(st.positionMillis / 1000);
          setLecture(st.isPlaying);
        });
        son.current = sound;
      }
      lectureEnCours = { son: son.current, arreter };
      await son.current.playAsync();
      setLecture(true);
      if (onEcoute && !signale.current) { signale.current = true; onEcoute(); }
    } catch (e) {
      Alert.alert('Lecture impossible', "La note vocale n'a pas pu etre lue.");
    }
  };

  const changerVitesse = async () => {
    const v = VITESSES[(VITESSES.indexOf(vitesse) + 1) % VITESSES.length];
    setVitesse(v);
    await son.current?.setRateAsync(v, true).catch(() => {});
  };

  const total = Math.max(1, duree || 1);
  return (
    <View style={styles.bulle}>
      <TouchableOpacity onPress={basculer} hitSlop={8} accessibilityLabel={lecture ? 'Pause' : 'Ecouter la note vocale'}>
        <Ionicons name={lecture ? 'pause-circle' : 'play-circle'} size={38} color={couleur} />
      </TouchableOpacity>
      <View style={styles.piste}>
        <View style={[styles.fond, { backgroundColor: clair ? 'rgba(255,255,255,0.35)' : colors.border }]}>
          <View style={[styles.avance, { width: `${Math.min(100, (position / total) * 100)}%`, backgroundColor: couleur }]} />
        </View>
        <Text style={[styles.temps, { color: clair ? 'rgba(255,255,255,0.85)' : colors.textMuted }]}>
          {mmss(lecture || position ? position : total)}
        </Text>
      </View>
      {lecture || vitesse !== 1 ? (
        <TouchableOpacity onPress={changerVitesse} hitSlop={8} style={[styles.vitesse, { borderColor: couleur }]} accessibilityLabel="Vitesse de lecture">
          <Text style={[styles.vitesseTexte, { color: couleur }]}>{String(vitesse).replace('.', ',')}x</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Barre d'enregistrement : demarre des l'affichage ; onEnvoyer(uri, duree) ou onAnnuler()
export function Enregistreur({ onEnvoyer, onAnnuler }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const enregistrement = useRef(null);
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
          Alert.alert('Micro', 'Autorise le micro dans les reglages pour envoyer des notes vocales.');
          onAnnuler();
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY, (st) => {
          if (!st.isRecording) return;
          const s = st.durationMillis / 1000;
          setSecondes(s);
          if (s >= DUREE_MAX) terminer(true); // eslint-disable-line no-use-before-define
        }, 250);
        if (!actif) { await recording.stopAndUnloadAsync().catch(() => {}); return; }
        enregistrement.current = recording;
      } catch (e) {
        Alert.alert('Micro', "Impossible de demarrer l'enregistrement.");
        onAnnuler();
      }
    })();
    return () => {
      actif = false;
      enregistrement.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const terminer = async (envoyer) => {
    const rec = enregistrement.current;
    enregistrement.current = null;
    if (!rec) { onAnnuler(); return; }
    try {
      const statut = await rec.getStatusAsync();
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const duree = (statut.durationMillis || 0) / 1000;
      if (envoyer && duree >= 1) onEnvoyer(rec.getURI(), duree);
      else onAnnuler();
    } catch (e) {
      onAnnuler();
    }
  };

  return (
    <View style={styles.enregistreur}>
      <TouchableOpacity onPress={() => terminer(false)} hitSlop={8}>
        <Ionicons name="trash-outline" size={24} color={colors.danger} />
      </TouchableOpacity>
      <View style={styles.point} />
      <Text style={styles.chrono}>{mmss(secondes)}</Text>
      <Text style={styles.aide}>Enregistrement...</Text>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.envoyer} onPress={() => terminer(true)}>
        <Ionicons name="send" size={18} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  vitesse: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 4 },
  vitesseTexte: { fontSize: 11, fontWeight: '800' },
  bulle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 190 },
  piste: { flex: 1, gap: 4 },
  fond: { height: 4, borderRadius: 2, overflow: 'hidden' },
  avance: { height: 4, borderRadius: 2 },
  temps: { fontSize: 11 },
  enregistreur: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44 },
  point: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  chrono: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  aide: { fontSize: 13, color: colors.textMuted },
  envoyer: { backgroundColor: colors.primary, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
