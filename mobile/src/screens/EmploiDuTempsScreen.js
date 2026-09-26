// Emploi du temps de la semaine et examens, avec rappels sur le telephone
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as api from '../api';
import { Card, EmptyState, Fab, PrimaryButton, Loading } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const COULEURS = ['#FF6B35', '#009E60', '#2563EB', '#7C3AED', '#D97706', '#DB2777', '#0891B2', '#65A30D'];
const CLE_RAPPELS = 'linkci_rappels_cours';
const couleur = (matiere) => COULEURS[[...matiere].reduce((n, c) => n + c.charCodeAt(0), 0) % COULEURS.length];
const aujourdhui = () => ((new Date().getDay() + 6) % 7) + 1; // 1 = lundi

function joursAvant(dateTexte) {
  const d = new Date(`${dateTexte}T00:00:00`);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

// Rappels locaux : 15 min avant chaque cours (chaque semaine), la veille (19 h) et 7 jours avant chaque examen
async function synchroniserRappels(cours, examens, actifs) {
  try {
    const prevus = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(prevus.filter((n) => ['cours', 'examen'].includes(n.content?.data?.type))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!actifs) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    for (const c of cours) {
      let [h, m] = c.debut.split(':').map(Number);
      let jour = c.jour;
      m -= 15;
      if (m < 0) { m += 60; h -= 1; }
      if (h < 0) { h += 24; jour = jour === 1 ? 7 : jour - 1; }
      await Notifications.scheduleNotificationAsync({
        content: { title: `${c.matiere} dans 15 min`, body: [c.salle, `${c.debut}-${c.fin}`].filter(Boolean).join(' · '), data: { type: 'cours' } },
        // expo : 1 = dimanche ... 7 = samedi
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: (jour % 7) + 1, hour: h, minute: m, channelId: 'default' },
      });
    }
    for (const e of examens) {
      for (const [avant, texte] of [[1, 'Demain'], [7, 'Dans une semaine']]) {
        const d = new Date(`${e.date_examen}T19:00:00`);
        d.setDate(d.getDate() - avant);
        if (d > new Date()) {
          await Notifications.scheduleNotificationAsync({
            content: { title: `${texte} : examen de ${e.matiere}`, body: [e.heure, e.salle].filter(Boolean).join(' · ') || 'Bonnes revisions !', data: { type: 'examen' } },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId: 'default' },
          });
        }
      }
    }
  } catch (err) {} // rappels facultatifs : jamais bloquant
}

export default function EmploiDuTempsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [onglet, setOnglet] = useState('semaine');
  const [cours, setCours] = useState(null);
  const [examens, setExamens] = useState([]);
  const [jour, setJour] = useState(Math.min(aujourdhui(), 7));
  const [rappels, setRappels] = useState(true);
  const [ajout, setAjout] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api.getEmploiDuTemps(), api.getExamens()]);
      setCours(c);
      setExamens(e);
      const actifs = (await AsyncStorage.getItem(CLE_RAPPELS).catch(() => null)) !== '0';
      setRappels(actifs);
      synchroniserRappels(c, e, actifs);
    } catch (err) {
      setCours((x) => x || []);
    }
  }, []);
  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const basculerRappels = async (v) => {
    setRappels(v);
    await AsyncStorage.setItem(CLE_RAPPELS, v ? '1' : '0').catch(() => {});
    synchroniserRappels(cours || [], examens, v);
  };

  const supprimer = (quoi, id, texte) => Alert.alert('Supprimer', texte, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => (quoi === 'cours' ? api.supprimerCours(id) : api.supprimerExamen(id)).then(charger).catch((e) => Alert.alert('Erreur', e.message)) },
  ]);

  if (!cours) return <Loading />;
  const duJour = cours.filter((c) => c.jour === jour);
  const avenir = examens.filter((e) => joursAvant(e.date_examen) >= 0);
  const passes = examens.filter((e) => joursAvant(e.date_examen) < 0);
  const prochain = avenir[0];

  return (
    <View style={styles.container}>
      <View style={styles.onglets}>
        {[['semaine', 'Emploi du temps'], ['examens', `Examens (${avenir.length})`]].map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.onglet, onglet === cle && styles.ongletActif]} onPress={() => setOnglet(cle)}>
            <Text style={[styles.ongletTexte, onglet === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {prochain ? (
          <View style={styles.compteARebours}>
            <Text style={styles.carTitre}>Prochain examen</Text>
            <Text style={styles.carMatiere}>{prochain.matiere}</Text>
            <Text style={styles.carJours}>{joursAvant(prochain.date_examen) === 0 ? "Aujourd'hui !" : `J-${joursAvant(prochain.date_examen)}`}</Text>
            <Text style={styles.carDetail}>{[prochain.date_examen.split('-').reverse().join('/'), prochain.heure, prochain.salle].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}

        {onglet === 'semaine' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: spacing.md }}>
              {JOURS.map((j, k) => {
                const n = cours.filter((c) => c.jour === k + 1).length;
                return (
                  <TouchableOpacity key={j} style={[styles.jour, jour === k + 1 && styles.jourActif]} onPress={() => setJour(k + 1)}>
                    <Text style={[styles.jourTexte, jour === k + 1 && { color: colors.white }]}>{j.slice(0, 3)}</Text>
                    <Text style={[styles.jourNb, jour === k + 1 && { color: colors.white }]}>{n || '-'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {duJour.length ? duJour.map((c) => (
              <Card key={c.id} style={styles.cours} onLongPress={() => supprimer('cours', c.id, `Supprimer ${c.matiere} du ${JOURS[c.jour - 1].toLowerCase()} ?`)}>
                <View style={[styles.barre, { backgroundColor: couleur(c.matiere) }]} />
                <View style={styles.heures}><Text style={styles.heure}>{c.debut}</Text><Text style={styles.heureFin}>{c.fin}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matiere}>{c.matiere}</Text>
                  <Text style={styles.detail}>{[c.salle, c.enseignant].filter(Boolean).join(' · ') || ' '}</Text>
                </View>
              </Card>
            )) : <EmptyState icon="calendar-outline" title={`Rien le ${JOURS[jour - 1].toLowerCase()}`} hint="Ajoute tes cours avec le bouton +" />}
            {cours.length ? <Text style={styles.aide}>Appui long sur un cours pour le supprimer.</Text> : null}
          </>
        ) : (
          <>
            {avenir.map((e) => (
              <Card key={e.id} style={styles.cours} onLongPress={() => supprimer('examen', e.id, `Supprimer l'examen de ${e.matiere} ?`)}>
                <View style={[styles.barre, { backgroundColor: couleur(e.matiere) }]} />
                <View style={styles.heures}><Text style={styles.jPlus}>J-{joursAvant(e.date_examen)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matiere}>{e.matiere}</Text>
                  <Text style={styles.detail}>{[e.date_examen.split('-').reverse().join('/'), e.heure, e.salle].filter(Boolean).join(' · ')}</Text>
                  {e.note ? <Text style={styles.detail}>{e.note}</Text> : null}
                </View>
              </Card>
            ))}
            {!avenir.length ? <EmptyState icon="school-outline" title="Aucun examen a venir" hint="Ajoute tes examens pour un compte a rebours et des rappels" /> : null}
            {passes.length ? <Text style={styles.aide}>{passes.length} examen(s) passe(s) · appui long pour supprimer</Text> : null}
          </>
        )}

        <View style={styles.reglage}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reglageTitre}>Rappels sur le telephone</Text>
            <Text style={styles.aide}>15 min avant chaque cours, la veille et une semaine avant chaque examen.</Text>
          </View>
          <Switch value={rappels} onValueChange={basculerRappels} trackColor={{ true: colors.primary }} thumbColor={colors.white} />
        </View>
      </ScrollView>
      <Fab icon="add" onPress={() => setAjout(true)} />
      <Ajout visible={ajout} type={onglet} jourDefaut={jour} onFermer={() => setAjout(false)} onAjoute={() => { setAjout(false); charger(); }} />
    </View>
  );
}

function Ajout({ visible, type, jourDefaut, onFermer, onAjoute }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [f, setF] = useState({});
  useEffect(() => { if (visible) setF({ jour: jourDefaut, debut: '08:00', fin: '10:00', matiere: '', salle: '', enseignant: '', date_examen: '', heure: '', note: '' }); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const champ = (cle, placeholder, extra = {}) => (
    <TextInput style={styles.champ} value={f[cle]} onChangeText={(v) => setF({ ...f, [cle]: v })} placeholder={placeholder} placeholderTextColor={colors.textFaint} {...extra} />
  );
  const enregistrer = async () => {
    try {
      if (type === 'semaine') await api.ajouterCours({ jour: f.jour, debut: f.debut, fin: f.fin, matiere: f.matiere, salle: f.salle, enseignant: f.enseignant });
      else await api.ajouterExamen({ matiere: f.matiere, date_examen: f.date_examen, heure: f.heure, salle: f.salle, note: f.note });
      onAjoute();
    } catch (e) {
      Alert.alert('Presque !', e.message);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fond}>
        <View style={styles.feuille}>
          <Text style={styles.feuilleTitre}>{type === 'semaine' ? 'Ajouter un cours' : 'Ajouter un examen'}</Text>
          {champ('matiere', 'Matiere (ex. Algorithmique)', { maxLength: 80 })}
          {type === 'semaine' ? (
            <>
              <View style={styles.puces}>
                {JOURS.map((j, k) => (
                  <TouchableOpacity key={j} style={[styles.jourPuce, f.jour === k + 1 && styles.jourActif]} onPress={() => setF({ ...f, jour: k + 1 })}>
                    <Text style={[styles.jourTexte, f.jour === k + 1 && { color: colors.white }]}>{j.slice(0, 3)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.ligne}>
                <View style={{ flex: 1 }}>{champ('debut', 'Debut 08:00', { maxLength: 5, keyboardType: 'numbers-and-punctuation' })}</View>
                <View style={{ flex: 1 }}>{champ('fin', 'Fin 10:00', { maxLength: 5, keyboardType: 'numbers-and-punctuation' })}</View>
              </View>
              {champ('salle', 'Salle (ex. Amphi A)', { maxLength: 60 })}
              {champ('enseignant', 'Enseignant (optionnel)', { maxLength: 60 })}
            </>
          ) : (
            <>
              <View style={styles.ligne}>
                <View style={{ flex: 2 }}>{champ('date_examen', 'Date AAAA-MM-JJ', { maxLength: 10, keyboardType: 'numbers-and-punctuation' })}</View>
                <View style={{ flex: 1 }}>{champ('heure', 'Heure 08:30', { maxLength: 5, keyboardType: 'numbers-and-punctuation' })}</View>
              </View>
              {champ('salle', 'Salle (optionnel)', { maxLength: 60 })}
              {champ('note', 'Note (chapitres a reviser...)', { maxLength: 200 })}
            </>
          )}
          <PrimaryButton title="Enregistrer" icon="checkmark" onPress={enregistrer} />
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 90 },
  onglets: { flexDirection: 'row', gap: 6, padding: spacing.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  onglet: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md },
  ongletActif: { backgroundColor: colors.primary },
  ongletTexte: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  compteARebours: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, alignItems: 'center' },
  carTitre: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  carMatiere: { color: colors.white, fontSize: 18, fontWeight: '800', marginTop: 2 },
  carJours: { color: colors.white, fontSize: 40, fontWeight: '900' },
  carDetail: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  jour: { width: 58, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.card },
  jourActif: { backgroundColor: colors.primary },
  jourTexte: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  jourNb: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  cours: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, overflow: 'hidden' },
  barre: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  heures: { width: 52, alignItems: 'center' },
  heure: { fontSize: 15, fontWeight: '800', color: colors.text },
  heureFin: { fontSize: 12, color: colors.textFaint },
  jPlus: { fontSize: 16, fontWeight: '900', color: colors.primary },
  matiere: { fontSize: 15, fontWeight: '800', color: colors.text },
  detail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  aide: { fontSize: 12, color: colors.textFaint, marginTop: 4 },
  reglage: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  reglageTitre: { fontSize: 15, fontWeight: '700', color: colors.text },
  fond: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  feuille: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.sm },
  feuilleTitre: { ...font.heading, marginBottom: spacing.xs },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.text },
  ligne: { flexDirection: 'row', gap: spacing.sm },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  jourPuce: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
