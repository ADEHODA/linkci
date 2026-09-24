import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ouvrirMessages } from '../verrou';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import * as api from '../api';
import Avatar from '../components/Avatar';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, PrimaryButton, SkeletonList, pullToRefresh } from '../components/ui';
import { radius, spacing, creerStyles } from '../theme';
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
  const { data: conversations, loading, refreshing, refresh, reload } = useApiList(api.getConversations);

  // un nouveau message met a jour la liste des conversations
  useEvenement('message_recu', () => reload());

  if (loading) return <SkeletonList lignes={6} avatar />;

  const ouvrir = (c) => navigation.navigate('Conversation', { autre_id: c.autre_id, prenom: c.prenom, nom: c.nom, avatar: c.avatar });

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.listContent}
      data={conversations}
      keyExtractor={(item) => String(item.autre_id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.convItem} onPress={() => ouvrir(item)} activeOpacity={0.7}>
          <Avatar name={`${item.prenom} ${item.nom}`} size={52} index={item.autre_id} avatar={item.avatar} />
          <View style={styles.convInfo}>
            <View style={styles.convTop}>
              <Text style={[styles.convName, item.non_lu > 0 && styles.bold]} numberOfLines={1}>{item.prenom} {item.nom}</Text>
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
