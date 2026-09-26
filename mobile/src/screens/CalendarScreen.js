// Evenements du campus : conferences, soirees, sport... avec "Je participe" et rappels
import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Alert, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import Avatar from '../components/Avatar';
import { Card, EmptyState, PrimaryButton, Fab, pullToRefresh, SkeletonList } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { partager } from '../partage';

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const CATEGORIES = [
  { cle: 'conference', label: 'Conference', emoji: '🎤' },
  { cle: 'soiree', label: 'Soiree', emoji: '🎉' },
  { cle: 'sport', label: 'Sport', emoji: '⚽' },
  { cle: 'culture', label: 'Culture', emoji: '🎭' },
  { cle: 'atelier', label: 'Atelier', emoji: '🛠️' },
  { cle: 'autre', label: 'Autre', emoji: '📌' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.cle, c]));
const ONGLETS = [['', 'A venir'], ['mes', "J'y vais"], ['passes', 'Passes']];
const dateLocale = (d) => new Date(`${d}T00:00:00`);

// Rappels locaux : la veille a 19 h, et 1 h avant si l'heure est connue
async function programmerRappels(ev) {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const rappels = [];
    const veille = dateLocale(ev.date_event);
    veille.setDate(veille.getDate() - 1);
    veille.setHours(19, 0, 0, 0);
    rappels.push([veille, `Demain : ${ev.titre}`]);
    if (ev.heure) {
      const [h, m] = ev.heure.split(':').map(Number);
      const avant = dateLocale(ev.date_event);
      avant.setHours(h - 1, m, 0, 0);
      rappels.push([avant, `Dans 1 h : ${ev.titre}`]);
    }
    for (const [date, titre] of rappels) {
      if (date > new Date()) {
        await Notifications.scheduleNotificationAsync({
          content: { title: titre, body: [ev.heure, ev.lieu].filter(Boolean).join(' · ') || 'Evenement LinkCI', data: { type: 'evenement', id: ev.id } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'default' },
        });
      }
    }
  } catch (e) {} // facultatif
}

async function annulerRappels(id) {
  try {
    const prevus = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(prevus.filter((n) => n.content?.data?.type === 'evenement' && n.content?.data?.id === id)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch (e) {}
}

export default function CalendarScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [onglet, setOnglet] = useState('');
  const [categorie, setCategorie] = useState('');
  const { data: events, setData, loading, refreshing, refresh, reload } = useApiList(
    () => api.getEvenements({ categorie, mes: onglet === 'mes' ? '1' : '', passes: onglet === 'passes' ? '1' : '' }));
  const [ajout, setAjout] = useState(false);
  const [detail, setDetail] = useState(null);

  const premier = React.useRef(true);
  React.useEffect(() => { // au changement d'onglet ou de filtre (l'affichage initial est charge par useApiList)
    if (premier.current) { premier.current = false; return; }
    reload();
  }, [onglet, categorie]); // eslint-disable-line react-hooks/exhaustive-deps

  const participer = async (ev) => {
    const oui = !ev.je_participe;
    try {
      const r = await api.participerEvenement(ev.id, oui);
      const maj = { ...ev, ...r };
      setData((liste) => liste.map((e) => (e.id === ev.id ? maj : e)));
      if (detail?.id === ev.id) setDetail(maj);
      if (oui) programmerRappels(ev); else annulerRappels(ev.id);
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const supprimer = (ev) => {
    Alert.alert('Supprimer', `Supprimer "${ev.titre}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await api.deleteEvenement(ev.id); annulerRappels(ev.id); setDetail(null); reload(); }
        catch (e) { Alert.alert('Erreur', e.message); }
      } },
    ]);
  };

  const renderEvent = ({ item }) => {
    const d = dateLocale(item.date_event);
    const passe = onglet === 'passes';
    const cat = CAT[item.categorie] || CAT.autre;
    return (
      <Card style={[styles.card, passe && { opacity: 0.6 }]} onPress={() => setDetail(item)}>
        <View style={styles.dateBadge}>
          <Text style={styles.dateDay}>{d.getDate()}</Text>
          <Text style={styles.dateMonth}>{MOIS[d.getMonth()].slice(0, 3).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.categorie}>{cat.emoji} {cat.label}</Text>
          <Text style={styles.title} numberOfLines={2}>{item.titre}</Text>
          <View style={styles.meta}>
            <View style={styles.metaItem}><Ionicons name="time-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText}>{JOURS[d.getDay()]} {d.getDate()} {MOIS[d.getMonth()]}{item.heure ? ` · ${item.heure}` : ''}</Text></View>
            {item.lieu ? <View style={styles.metaItem}><Ionicons name="location-outline" size={13} color={colors.textMuted} /><Text style={styles.metaText}>{item.lieu}</Text></View> : null}
          </View>
          <View style={styles.basCarte}>
            <Text style={styles.metaText}>👥 {item.nb_participants} participant{item.nb_participants > 1 ? 's' : ''}</Text>
            {!passe ? (
              <TouchableOpacity style={[styles.btnParticipe, item.je_participe && styles.btnParticipeOui]} onPress={() => participer(item)}
                accessibilityLabel={item.je_participe ? 'Ne plus participer' : 'Je participe'}>
                <Text style={[styles.btnParticipeTexte, item.je_participe && { color: colors.white }]}>{item.je_participe ? "✓ J'y vais" : 'Je participe'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Card>
    );
  };

  const entete = (
    <View>
      <View style={styles.onglets}>
        {ONGLETS.map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.onglet, onglet === cle && styles.ongletActif]} onPress={() => setOnglet(cle)}>
            <Text style={[styles.ongletTexte, onglet === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: spacing.md }}>
        {[{ cle: '', label: 'Tout', emoji: '✨' }, ...CATEGORIES].map((c) => (
          <TouchableOpacity key={c.cle} style={[styles.puce, categorie === c.cle && styles.puceActive]} onPress={() => setCategorie(c.cle)}>
            <Text style={[styles.puceTexte, categorie === c.cle && { color: colors.primary }]}>{c.emoji} {c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={loading ? [] : events}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 90 }}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderEvent}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={entete}
        ListEmptyComponent={loading ? <SkeletonList /> : (
          <EmptyState icon="calendar-outline" title={onglet === 'mes' ? "Tu ne participes a rien pour l'instant" : 'Aucun evenement'}
            hint="Conference, match, soiree de promo... cree le premier avec +" />
        )}
      />
      <Fab onPress={() => setAjout(true)} />
      <Detail ev={detail} onFermer={() => setDetail(null)} onParticiper={participer} onSupprimer={supprimer}
        onProfil={(id) => { setDetail(null); navigation.navigate('ProfilEtudiant', { id }); }} passe={onglet === 'passes'} />
      <Ajout visible={ajout} onFermer={() => setAjout(false)} onCree={(ev) => { setAjout(false); programmerRappels(ev); setOnglet(''); reload(); }} />
    </View>
  );
}

function Detail({ ev, onFermer, onParticiper, onSupprimer, onProfil, passe }) {
  const styles = useStyles();
  const [gens, setGens] = useState([]);
  React.useEffect(() => {
    setGens([]);
    if (ev) api.getParticipantsEvenement(ev.id).then(setGens).catch(() => {});
  }, [ev?.id, ev?.nb_participants]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ev) return null;
  const d = dateLocale(ev.date_event);
  const cat = CAT[ev.categorie] || CAT.autre;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <ScrollView style={{ maxHeight: 520 }}>
            <Text style={styles.categorie}>{cat.emoji} {cat.label}</Text>
            <Text style={styles.sheetTitle}>{ev.titre}</Text>
            <Text style={styles.ligneInfo}>📅 {JOURS[d.getDay()]} {d.getDate()} {MOIS[d.getMonth()]} {d.getFullYear()}{ev.heure ? ` a ${ev.heure}` : ''}</Text>
            {ev.lieu ? <Text style={styles.ligneInfo}>📍 {ev.lieu}</Text> : null}
            <Text style={styles.ligneInfo}>🙋 Organise par {ev.auteur_prenom} {ev.auteur_nom}</Text>
            {ev.description ? <Text style={styles.description}>{ev.description}</Text> : null}
            <Text style={styles.sousTitre}>{ev.nb_participants} participant{ev.nb_participants > 1 ? 's' : ''}</Text>
            <View style={styles.participants}>
              {gens.slice(0, 30).map((g) => (
                <TouchableOpacity key={g.id} style={styles.participant} onPress={() => onProfil(g.id)}>
                  <Avatar name={`${g.prenom} ${g.nom}`} avatar={g.avatar} size={40} index={g.id} />
                  <Text style={styles.participantNom} numberOfLines={1}>{g.prenom}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          {!passe ? <PrimaryButton title={ev.je_participe ? "✓ J'y vais (annuler)" : 'Je participe'} onPress={() => onParticiper(ev)} /> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.action} onPress={() => partager(`${cat.emoji} ${ev.titre} - ${d.getDate()} ${MOIS[d.getMonth()]}${ev.lieu ? ` (${ev.lieu})` : ''}`, '/calendrier')}>
              <Ionicons name="share-social-outline" size={18} style={styles.actionIcone} /><Text style={styles.actionTexte}>Partager</Text>
            </TouchableOpacity>
            {ev.est_auteur ? (
              <TouchableOpacity style={styles.action} onPress={() => onSupprimer(ev)}>
                <Ionicons name="trash-outline" size={18} style={styles.actionDanger} /><Text style={[styles.actionTexte, styles.actionDanger]}>Supprimer</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.action} onPress={onFermer}><Text style={styles.actionTexte}>Fermer</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Dates proposees : les 14 prochains jours (evite de taper AAAA-MM-JJ)
function prochainsJours() {
  return Array.from({ length: 14 }, (_, k) => {
    const d = new Date();
    d.setDate(d.getDate() + k);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, label: k === 0 ? "Auj." : k === 1 ? 'Demain' : `${JOURS[d.getDay()]} ${d.getDate()}` };
  });
}

function Ajout({ visible, onFermer, onCree }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const vide = { titre: '', categorie: 'conference', date_event: '', heure: '', lieu: '', description: '' };
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);
  const jours = React.useMemo(prochainsJours, [visible]);
  const maj = (cle) => (v) => setF((x) => ({ ...x, [cle]: v }));

  const creer = async () => {
    if (!f.titre.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(f.date_event.trim())) {
      Alert.alert('Presque', 'Donne un titre et choisis une date (ou tape-la au format AAAA-MM-JJ).');
      return;
    }
    if (f.heure && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.heure.trim())) {
      Alert.alert('Heure', 'Ecris l\'heure au format HH:MM, par exemple 18:30.');
      return;
    }
    setEnvoi(true);
    try {
      const ev = await api.createEvenement({ ...f, titre: f.titre.trim(), date_event: f.date_event.trim(), heure: f.heure.trim() });
      setF(vide);
      onCree(ev);
    } catch (e) { Alert.alert('Erreur', e.message); }
    setEnvoi(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>Nouvel evenement</Text>
            <TextInput style={styles.field} placeholder="Titre (ex. Tournoi de foot inter-promo)" placeholderTextColor={colors.textFaint}
              value={f.titre} onChangeText={maj('titre')} maxLength={120} />
            <View style={styles.grille}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.cle} style={[styles.puce, f.categorie === c.cle && styles.puceActive]} onPress={() => maj('categorie')(c.cle)}>
                  <Text style={[styles.puceTexte, f.categorie === c.cle && { color: colors.primary }]}>{c.emoji} {c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: spacing.sm }}>
              {jours.map((j) => (
                <TouchableOpacity key={j.iso} style={[styles.puce, f.date_event === j.iso && styles.puceActive]} onPress={() => maj('date_event')(j.iso)}>
                  <Text style={[styles.puceTexte, f.date_event === j.iso && { color: colors.primary }]}>{j.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput style={[styles.field, { flex: 1.4 }]} placeholder="Date AAAA-MM-JJ" placeholderTextColor={colors.textFaint}
                value={f.date_event} onChangeText={maj('date_event')} autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10} />
              <TextInput style={[styles.field, { flex: 1 }]} placeholder="Heure 18:00" placeholderTextColor={colors.textFaint}
                value={f.heure} onChangeText={maj('heure')} keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
            <TextInput style={styles.field} placeholder="Lieu (ex. Amphi A, stade de l'UFHB)" placeholderTextColor={colors.textFaint}
              value={f.lieu} onChangeText={maj('lieu')} maxLength={120} />
            <TextInput style={[styles.field, { minHeight: 70 }]} placeholder="Description (programme, prix d'entree...)" placeholderTextColor={colors.textFaint}
              value={f.description} onChangeText={maj('description')} multiline maxLength={1000} />
          </ScrollView>
          <PrimaryButton title="Publier l'evenement" onPress={creer} loading={envoi} />
          <TouchableOpacity style={styles.cancel} onPress={onFermer}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  onglets: { flexDirection: 'row', gap: 6, marginBottom: spacing.md },
  onglet: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  ongletActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  ongletTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  puce: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  puceActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  puceTexte: { fontSize: 13, fontWeight: '600', color: colors.text },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md },
  card: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  dateBadge: { alignItems: 'center', justifyContent: 'center', width: 56, height: 60, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  dateDay: { fontSize: 22, fontWeight: '900', color: colors.primary },
  dateMonth: { fontSize: 11, fontWeight: '800', color: colors.primary, marginTop: -2 },
  categorie: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  basCarte: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  btnParticipe: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary },
  btnParticipeOui: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnParticipeTexte: { fontSize: 13, fontWeight: '800', color: colors.primary },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 30, gap: spacing.sm },
  sheetTitle: { ...font.heading, fontSize: 19, marginBottom: spacing.md },
  ligneInfo: { fontSize: 14, color: colors.text, marginBottom: 6 },
  description: { fontSize: 14, lineHeight: 21, color: colors.text, marginTop: spacing.sm, backgroundColor: colors.cardAlt, padding: spacing.md, borderRadius: radius.md },
  sousTitre: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm },
  participants: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  participant: { alignItems: 'center', width: 56 },
  participantNom: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  field: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 14, fontSize: 15, marginBottom: spacing.md, color: colors.text, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  actionIcone: { color: colors.text },
  actionTexte: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  actionDanger: { color: colors.danger },
  cancel: { alignItems: 'center', paddingTop: spacing.md },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
}));
