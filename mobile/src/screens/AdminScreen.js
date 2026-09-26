// Tableau de bord administrateur : statistiques, moderation, annonce a tous, utilisateurs
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, RefreshControl, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import { Card, Chip, EmptyState, Loading, PrimaryButton } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const ONGLETS = [['stats', 'Stats', 'stats-chart'], ['moderation', 'Moderation', 'shield-checkmark'],
  ['annonce', 'Annonce', 'megaphone'], ['utilisateurs', 'Etudiants', 'people']];

export default function AdminScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [onglet, setOnglet] = useState('stats');
  return (
    <View style={styles.container}>
      <View style={styles.onglets}>
        {ONGLETS.map(([cle, label, icone]) => (
          <TouchableOpacity key={cle} style={[styles.onglet, onglet === cle && styles.ongletActif]} onPress={() => setOnglet(cle)}>
            <Ionicons name={icone} size={18} color={onglet === cle ? colors.white : colors.textMuted} />
            <Text style={[styles.ongletTexte, onglet === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {onglet === 'stats' ? <Stats /> : onglet === 'moderation' ? <Moderation /> : onglet === 'annonce' ? <Annonce /> : <Utilisateurs />}
    </View>
  );
}

// Charge une ressource admin avec tirer-pour-actualiser
function useChargement(fonction) {
  const [data, setData] = useState(null);
  const [actualisation, setActualisation] = useState(false);
  const charger = useCallback(async () => {
    try {
      setData(await fonction());
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  }, [fonction]);
  useEffect(() => { charger(); }, [charger]);
  const actualiser = async () => { setActualisation(true); await charger(); setActualisation(false); };
  return { data, charger, controle: <RefreshControl refreshing={actualisation} onRefresh={actualiser} /> };
}

function Stats() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, controle } = useChargement(api.getAdminStats);
  if (!data) return <Loading />;
  const t = data.totaux;
  const cartes = [
    ['Etudiants', t.utilisateurs, 'people', colors.primary], ['Actifs (7 j)', t.actifs_7j, 'pulse', colors.accent],
    ['Publications', t.publications, 'newspaper', '#2563EB'], ['Messages', t.messages, 'chatbubbles', '#7C3AED'],
    ['Annonces', t.annonces, 'pricetags', '#DB2777'], ['Offres', t.offres, 'briefcase', '#0891B2'],
    ['Questions', t.questions, 'help-buoy', '#7C3AED'], ['Documents', t.documents, 'folder-open', '#D97706'],
  ];
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={controle}>
      <View style={styles.grille}>
        {cartes.map(([label, valeur, icone, couleur]) => (
          <View key={label} style={styles.stat}>
            <Ionicons name={icone} size={18} color={couleur} />
            <Text style={[styles.statValeur, { color: couleur }]}>{valeur}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {t.non_verifies || t.bannis ? (
        <Text style={styles.aide}>{t.non_verifies} compte(s) en attente de verification · {t.bannis} banni(s)</Text>
      ) : null}
      {data.erreurs?.recentes?.length ? (
        <Card>
          <Text style={styles.cardTitre}>🚨 Erreurs serveur · {data.erreurs.nb_24h} sur 24 h</Text>
          {data.erreurs.recentes.slice(0, 8).map((e) => (
            <View key={e.id} style={styles.erreur}>
              <Text style={styles.erreurRoute} numberOfLines={1}>{e.route}</Text>
              <Text style={styles.aide} numberOfLines={2}>{e.message}</Text>
              <Text style={styles.axeTexte}>{e.date_erreur.slice(5, 16)} UTC</Text>
            </View>
          ))}
        </Card>
      ) : null}
      <Graphique titre="Inscriptions (14 jours)" serie={data.inscriptions} couleur={colors.primary} />
      <Graphique titre="Publications (14 jours)" serie={data.publications} couleur={colors.accent} />
      {data.universites.length ? (
        <Card>
          <Text style={styles.cardTitre}>Universites les plus representees</Text>
          {data.universites.map((u) => (
            <View key={u.universite} style={styles.ligne}>
              <Text style={styles.ligneTexte} numberOfLines={1}>{u.universite}</Text>
              <Text style={styles.ligneNb}>{u.nb}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {data.versions_app?.length ? (
        <Card>
          <Text style={styles.cardTitre}>Versions de l'application</Text>
          {data.versions_app.map((v) => (
            <View key={v.version} style={styles.ligne}>
              <Text style={styles.ligneTexte} numberOfLines={1}>
                {v.version === 'ancienne' ? 'Ancienne (1.0 / 1.1) : pas de mises a jour auto' : `Version ${v.version}`}
              </Text>
              <Text style={styles.ligneNb}>{v.nb}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Graphique({ titre, serie, couleur }) {
  const styles = useStyles();
  const maxi = Math.max(1, ...serie.map((j) => j.nb));
  const total = serie.reduce((n, j) => n + j.nb, 0);
  return (
    <Card>
      <Text style={styles.cardTitre}>{titre} · {total}</Text>
      <View style={styles.barres}>
        {serie.map((j) => (
          <View key={j.jour} style={styles.colonne}>
            {j.nb ? <Text style={styles.barreNb}>{j.nb}</Text> : null}
            <View style={[styles.barre, { height: `${Math.max(3, (j.nb / maxi) * 100)}%`, backgroundColor: couleur, opacity: j.nb ? 1 : 0.2 }]} />
          </View>
        ))}
      </View>
      <View style={styles.axe}>
        <Text style={styles.axeTexte}>{serie[0]?.jour.slice(5).split('-').reverse().join('/')}</Text>
        <Text style={styles.axeTexte}>Aujourd'hui</Text>
      </View>
    </Card>
  );
}

const LIBELLES = { bourse: 'Bourse', formation: 'Formation', opportunite: 'Offre' };

function Moderation() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, charger, controle } = useChargement(api.getAdminModeration);
  if (!data) return <Loading />;

  const decider = (p, decision) => api.modererProposition(p.genre, p.id, decision)
    .then((r) => { Alert.alert('OK', r.message); charger(); })
    .catch((e) => Alert.alert('Erreur', e.message));
  const traiter = (s, supprimer) => {
    const faire = () => (supprimer ? api.supprimerPostSignale(s.id) : api.ignorerSignalement(s.id)).then(charger).catch((e) => Alert.alert('Erreur', e.message));
    if (!supprimer) return faire();
    return Alert.alert('Supprimer', 'Supprimer definitivement cette publication ?', [
      { text: 'Annuler', style: 'cancel' }, { text: 'Supprimer', style: 'destructive', onPress: faire },
    ]);
  };
  const vide = !data.propositions.length && !data.signalements.length;

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={controle}>
      {vide ? <EmptyState icon="checkmark-done-circle-outline" title="Rien a moderer" hint="Tout est traite, bravo !" /> : null}
      {data.propositions.length ? <Text style={styles.section}>Propositions a valider ({data.propositions.length})</Text> : null}
      {data.propositions.map((p) => (
        <Card key={`${p.genre}-${p.id}`}>
          <Chip label={LIBELLES[p.genre] || p.genre} />
          <Text style={styles.titre}>{p.titre}</Text>
          {p.details ? <Text style={styles.aide}>{p.details}</Text> : null}
          {p.lien ? <Text style={styles.lien} onPress={() => Linking.openURL(p.lien)}>Verifier le lien</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.action, { backgroundColor: colors.accentSoft }]} onPress={() => decider(p, 'valider')}>
              <Ionicons name="checkmark" size={16} color={colors.accent} /><Text style={[styles.actionTexte, { color: colors.accent }]}>Publier</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.action, { backgroundColor: colors.dangerSoft }]} onPress={() => decider(p, 'refuser')}>
              <Ionicons name="close" size={16} color={colors.danger} /><Text style={[styles.actionTexte, { color: colors.danger }]}>Refuser</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ))}
      {data.signalements.length ? <Text style={styles.section}>Publications signalees ({data.signalements.length})</Text> : null}
      {data.signalements.map((s) => (
        <Card key={s.id}>
          <Text style={styles.aide}>{s.prenom} {s.nom} · signalee {s.nb} fois{s.motif ? ` · ${s.motif}` : ''}</Text>
          <Text style={styles.titre} numberOfLines={4}>{s.contenu || '(photo)'}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.action, { backgroundColor: colors.dangerSoft }]} onPress={() => traiter(s, true)}>
              <Ionicons name="trash" size={16} color={colors.danger} /><Text style={[styles.actionTexte, { color: colors.danger }]}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.action} onPress={() => traiter(s, false)}>
              <Text style={styles.actionTexte}>Ignorer</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function Annonce() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const envoyer = () => {
    if (message.trim().length < 5) {
      Alert.alert('Annonce', 'Ecris un message un peu plus long.');
      return;
    }
    Alert.alert('Envoyer a tous ?', 'Tous les etudiants recevront une notification sur leur telephone.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Envoyer',
        onPress: async () => {
          setEnvoi(true);
          try {
            const r = await api.envoyerAnnonce(message.trim());
            setMessage('');
            Alert.alert('Envoye', r.message);
          } catch (e) {
            Alert.alert('Erreur', e.message);
          }
          setEnvoi(false);
        },
      },
    ]);
  };
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.cardTitre}>📣 Annonce a tous les etudiants</Text>
        <Text style={styles.aide}>Notification dans l'app et sur les telephones. 3 annonces par heure au maximum.</Text>
        <TextInput style={styles.zone} value={message} onChangeText={setMessage} multiline maxLength={300}
          placeholder="Ex. Les resultats du concours sont en ligne !" placeholderTextColor={colors.textFaint} />
        <Text style={styles.compteur}>{message.length}/300</Text>
        <PrimaryButton title="Envoyer l'annonce" icon="megaphone" onPress={envoyer} loading={envoi} />
      </Card>
    </ScrollView>
  );
}

function Utilisateurs() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [liste, setListe] = useState(null);
  const chercher = useCallback((texte) => api.getAdminUtilisateurs(texte).then(setListe).catch((e) => Alert.alert('Erreur', e.message)), []);
  useEffect(() => {
    const minuterie = setTimeout(() => chercher(q), 350); // attend la fin de la saisie
    return () => clearTimeout(minuterie);
  }, [q, chercher]);

  const bannir = (u) => Alert.alert(u.banni ? `Reactiver ${u.prenom} ?` : `Bannir ${u.prenom} ?`,
    u.banni ? 'Il pourra de nouveau se connecter.' : "Il ne pourra plus se connecter, ni sur le site ni dans l'app.", [
      { text: 'Annuler', style: 'cancel' },
      {
        text: u.banni ? 'Reactiver' : 'Bannir',
        style: u.banni ? 'default' : 'destructive',
        onPress: () => api.bannirUtilisateur(u.id).then(() => chercher(q)).catch((e) => Alert.alert('Erreur', e.message)),
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.recherche}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput style={styles.rechercheTexte} placeholder="Nom ou e-mail..." placeholderTextColor={colors.textFaint} value={q} onChangeText={setQ} autoCapitalize="none" />
      </View>
      {!liste ? <Loading /> : liste.map((u) => (
        <Card key={u.id} style={styles.utilisateur}>
          <View style={{ flex: 1 }}>
            <Text style={styles.titre}>{u.prenom} {u.nom}</Text>
            <Text style={styles.aide} numberOfLines={1}>{u.email}</Text>
            <View style={styles.puces}>
              {u.role === 'admin' ? <Chip label="Admin" tone="accent" /> : null}
              {u.banni ? <Chip label="Banni" tone="danger" /> : null}
              {!u.email_verifie ? <Chip label="Non verifie" tone="muted" /> : null}
              {u.universite ? <Text style={styles.aide}>{u.universite}</Text> : null}
            </View>
          </View>
          {u.role !== 'admin' ? (
            <TouchableOpacity style={[styles.action, { backgroundColor: u.banni ? colors.accentSoft : colors.dangerSoft }]} onPress={() => bannir(u)}>
              <Text style={[styles.actionTexte, { color: u.banni ? colors.accent : colors.danger }]}>{u.banni ? 'Reactiver' : 'Bannir'}</Text>
            </TouchableOpacity>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  onglets: { flexDirection: 'row', gap: 6, padding: spacing.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  onglet: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: radius.md },
  ongletActif: { backgroundColor: colors.primary },
  ongletTexte: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  stat: { width: '23%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 2 },
  statValeur: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  cardTitre: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  barres: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 3 },
  colonne: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  barre: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barreNb: { fontSize: 9, color: colors.textMuted, marginBottom: 1 },
  axe: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axeTexte: { fontSize: 10, color: colors.textFaint },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  erreur: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  erreurRoute: { fontSize: 13, fontWeight: '700', color: colors.danger },
  ligneTexte: { flex: 1, fontSize: 14, color: colors.text },
  ligneNb: { fontSize: 14, fontWeight: '800', color: colors.primary },
  section: { ...font.heading, fontSize: 16, marginVertical: spacing.sm },
  titre: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4 },
  aide: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lien: { fontSize: 13, color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  actionTexte: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  zone: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, minHeight: 110, textAlignVertical: 'top', marginTop: spacing.md },
  compteur: { alignSelf: 'flex-end', fontSize: 11, color: colors.textFaint, marginVertical: 4 },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  rechercheTexte: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  utilisateur: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  puces: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
}));
