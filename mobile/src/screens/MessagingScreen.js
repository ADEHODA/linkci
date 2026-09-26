import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ouvrirMessages } from '../verrou';
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../api';
import Avatar from '../components/Avatar';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, PrimaryButton, SkeletonList, pullToRefresh } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const CLE_EPINGLES = 'linkci_discussions_epinglees';
const MAX_EPINGLES = 3;
import { dateRelative } from '../utils';
import { useEvenement } from '../realtime';

// Code sur les discussions : demande l'empreinte avant d'afficher la liste
export default function MessagingScreen(props) {
  const styles = useStyles();
  const [ouvert, setOuvert] = useState(null);
  const verifier = useCallback(() => { ouvrirMessages().then(setOuvert); }, []);
  useFocusEffect(verifier);
  if (ouvert === null) return <View style={styles.container} />;
  if (!ouvert) {
    return (
      <View style={[styles.container, styles.verrou]}>
        <Ionicons name="lock-closed" size={48} color="#FF6B35" />
        <Text style={styles.verrouTexte}>Tes discussions sont protegees</Text>
        <PrimaryButton title="Deverrouiller" icon="finger-print" onPress={verifier} />
      </View>
    );
  }
  return <ListeConversations {...props} />;
}

function ListeConversations({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: conversations, loading, refreshing, refresh, reload } = useApiList(api.getConversations, [], { cache: '/api/conversations' });
  const [epingles, setEpingles] = useState([]);
  React.useEffect(() => {
    AsyncStorage.getItem(CLE_EPINGLES).then((v) => setEpingles(JSON.parse(v || '[]'))).catch(() => {});
  }, []);
  const changerEpingles = (liste) => {
    setEpingles(liste);
    AsyncStorage.setItem(CLE_EPINGLES, JSON.stringify(liste)).catch(() => {});
  };
  const menu = (c) => {
    const epingle = epingles.includes(c.autre_id);
    Alert.alert(`${c.prenom} ${c.nom}`, undefined, [
      { text: epingle ? 'Desepingler' : 'Epingler en haut', onPress: () => {
        if (epingle) changerEpingles(epingles.filter((x) => x !== c.autre_id));
        else if (epingles.length >= MAX_EPINGLES) Alert.alert('Epingler', `Tu peux epingler ${MAX_EPINGLES} discussions au maximum.`);
        else changerEpingles([c.autre_id, ...epingles]);
      } },
      { text: 'Voir le profil', onPress: () => navigation.navigate('ProfilEtudiant', { id: c.autre_id }) },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };
  // recherche : noms des discussions (sur le telephone) + contenu des messages (serveur)
  const [q, setQ] = useState('');
  const [trouves, setTrouves] = useState(null);
  const minuterie = React.useRef(null);
  const chercher = (t) => {
    setQ(t);
    clearTimeout(minuterie.current);
    if (t.trim().length < 2) { setTrouves(null); return; }
    minuterie.current = setTimeout(() => api.rechercherMessages(t.trim()).then(setTrouves).catch(() => setTrouves({ prives: [], groupes: [] })), 400);
  };

  // discussions epinglees d'abord (dans l'ordre d'epinglage), puis les autres par date
  const triees = [...conversations].sort((a, b) => {
    const ia = epingles.indexOf(a.autre_id), ib = epingles.indexOf(b.autre_id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // un nouveau message met a jour la liste des conversations
  useEvenement('message_recu', () => reload());

  if (loading) return <SkeletonList lignes={6} avatar />;

  const ouvrir = (c) => navigation.navigate('Conversation', { autre_id: c.autre_id, prenom: c.prenom, nom: c.nom, avatar: c.avatar });

  const barre = (
    <View style={styles.recherche}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput style={styles.rechercheChamp} value={q} onChangeText={chercher} placeholder="Rechercher un nom ou un message..."
        placeholderTextColor={colors.textFaint} returnKeyType="search" />
      {q ? <TouchableOpacity onPress={() => chercher('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textFaint} /></TouchableOpacity> : null}
    </View>
  );

  if (q.trim().length >= 2) {
    const mot = q.trim().toLowerCase();
    const noms = conversations.filter((c) => `${c.prenom} ${c.nom}`.toLowerCase().includes(mot));
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        {barre}
        {noms.length ? <Text style={styles.section}>Discussions</Text> : null}
        {noms.map((c) => (
          <TouchableOpacity key={`c${c.autre_id}`} style={styles.convItem} onPress={() => ouvrir(c)}>
            <Avatar name={`${c.prenom} ${c.nom}`} size={44} index={c.autre_id} avatar={c.avatar} />
            <Text style={[styles.convName, { flex: 1 }]} numberOfLines={1}>{c.prenom} {c.nom}</Text>
          </TouchableOpacity>
        ))}
        {!trouves ? <Text style={styles.section}>Recherche...</Text> : null}
        {trouves?.prives.length ? <Text style={styles.section}>Messages</Text> : null}
        {trouves?.prives.map((m) => (
          <TouchableOpacity key={`m${m.id}`} style={styles.convItem}
            onPress={() => navigation.navigate('Conversation', { autre_id: m.autre_id, prenom: m.prenom, nom: m.nom, avatar: m.avatar, cible: m.id })}>
            <Avatar name={`${m.prenom} ${m.nom}`} size={44} index={m.autre_id} avatar={m.avatar} />
            <View style={styles.convInfo}>
              <View style={styles.convTop}>
                <Text style={styles.convName} numberOfLines={1}>{m.prenom} {m.nom}</Text>
                <Text style={styles.convDate}>{dateRelative(m.date_envoi)}</Text>
              </View>
              <TexteSurligne texte={m.contenu} mot={mot} style={styles.convPreview} />
            </View>
          </TouchableOpacity>
        ))}
        {trouves?.groupes.length ? <Text style={styles.section}>Dans tes groupes</Text> : null}
        {trouves?.groupes.map((m) => (
          <TouchableOpacity key={`g${m.id}`} style={styles.convItem} onPress={() => navigation.navigate('Groupes', { ouvrir: m.groupe_id })}>
            <Avatar name={m.groupe_nom} size={44} index={m.groupe_id} />
            <View style={styles.convInfo}>
              <View style={styles.convTop}>
                <Text style={styles.convName} numberOfLines={1}>{m.groupe_nom}</Text>
                <Text style={styles.convDate}>{dateRelative(m.date_envoi)}</Text>
              </View>
              <TexteSurligne texte={`${m.prenom} : ${m.contenu}`} mot={mot} style={styles.convPreview} />
            </View>
          </TouchableOpacity>
        ))}
        {trouves && !noms.length && !trouves.prives.length && !trouves.groupes.length ? (
          <EmptyState icon="search-outline" title="Aucun resultat" hint={`Rien ne contient "${q.trim()}".`} />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={styles.container}
      ListHeaderComponent={conversations.length ? barre : null}
      contentContainerStyle={styles.listContent}
      data={triees}
      keyExtractor={(item) => String(item.autre_id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.convItem} onPress={() => ouvrir(item)} onLongPress={() => menu(item)} delayLongPress={350} activeOpacity={0.7}>
          <Avatar name={`${item.prenom} ${item.nom}`} size={52} index={item.autre_id} avatar={item.avatar} />
          <View style={styles.convInfo}>
            <View style={styles.convTop}>
              <Text style={[styles.convName, item.non_lu > 0 && styles.bold]} numberOfLines={1}>{item.prenom} {item.nom}</Text>
              {epingles.includes(item.autre_id) ? <Ionicons name="pin" size={14} color={colors.textFaint} /> : null}
              {item.date_dernier ? <Text style={[styles.convDate, item.non_lu > 0 && styles.dateUnread]}>{dateRelative(item.date_dernier)}</Text> : null}
            </View>
            <View style={styles.convTop}>
              <Text style={[styles.convPreview, item.non_lu > 0 && styles.previewUnread]} numberOfLines={1}>{item.dernier_message || '...'}</Text>
              {item.non_lu > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{item.non_lu}</Text></View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View>
          <EmptyState icon="chatbubbles-outline" title="Aucune conversation" hint="Trouve un etudiant et envoie-lui ton premier message." />
          <PrimaryButton title="Trouver un etudiant" icon="search" onPress={() => navigation.navigate('Search')} style={styles.cta} />
        </View>
      }
    />
  );
}

// Texte avec le mot cherche en gras (orange)
function TexteSurligne({ texte, mot, style }) {
  const { colors } = useTheme();
  const i = (texte || '').toLowerCase().indexOf(mot);
  if (i < 0) return <Text style={style} numberOfLines={2}>{texte}</Text>;
  const debut = Math.max(0, i - 30); // montre le passage autour du mot
  return (
    <Text style={style} numberOfLines={2}>
      {debut ? '...' : ''}{texte.slice(debut, i)}
      <Text style={{ color: colors.primary, fontWeight: '800' }}>{texte.slice(i, i + mot.length)}</Text>
      {texte.slice(i + mot.length)}
    </Text>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.lg, marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border },
  rechercheChamp: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  section: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: 4 },
  verrou: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  verrouTexte: { fontSize: 16, fontWeight: '700', color: colors.textMuted },
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingVertical: spacing.sm, flexGrow: 1 },
  convItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.card, gap: spacing.md, marginHorizontal: spacing.md, marginVertical: 3, borderRadius: radius.lg },
  convInfo: { flex: 1, gap: 3 },
  convTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  convName: { fontWeight: '600', fontSize: 15, color: colors.text, flex: 1 },
  bold: { fontWeight: '800' },
  convDate: { fontSize: 11, color: colors.textFaint },
  dateUnread: { color: colors.primary, fontWeight: '700' },
  convPreview: { fontSize: 14, color: colors.textMuted, flex: 1 },
  previewUnread: { color: colors.text, fontWeight: '600' },
  badge: { backgroundColor: colors.primary, borderRadius: radius.pill, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  cta: { marginHorizontal: spacing.xl * 2, marginTop: -spacing.xl },
}));
