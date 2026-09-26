import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ouvrirMessages } from '../verrou';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
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

  return (
    <FlatList
      style={styles.container}
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

const useStyles = creerStyles(({ colors }) => ({
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
