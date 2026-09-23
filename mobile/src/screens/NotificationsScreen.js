import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, pullToRefresh } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { dateRelative } from '../utils';

const ICONS = {
  bourse: ['cash', '#FF6B35'], formation: ['school', '#009E60'], message: ['chatbubble', '#2563EB'],
  like: ['heart', '#E11D48'], commentaire: ['chatbox', '#7C3AED'], mention: ['at', '#7C3AED'],
  suivi: ['person-add', '#009E60'], document: ['document-text', '#2563EB'],
};

export default function NotificationsScreen() {
  const { data, loading, refreshing, refresh } = useApiList(async () => (await api.getNotifications()).notifications || []);

  if (loading) return <Loading />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={data}
      keyExtractor={(item) => String(item.id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => {
        const [icon, couleur] = ICONS[item.type] || ['notifications', colors.primary];
        return (
          <View style={[styles.item, !item.lu && styles.unread]}>
            <View style={[styles.iconBox, { backgroundColor: couleur + '1A' }]}>
              <Ionicons name={icon} size={20} color={couleur} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.message, !item.lu && styles.messageUnread]}>{item.message}</Text>
              <Text style={styles.time}>{dateRelative(item.date_notification)}</Text>
            </View>
            {!item.lu && <View style={styles.dot} />}
          </View>
        );
      }}
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="Aucune notification" hint="Tu seras prevenu des likes, messages et nouvelles bourses." />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, marginBottom: spacing.sm, gap: spacing.md },
  unread: { backgroundColor: colors.primarySoft },
  iconBox: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  message: { fontSize: 14, lineHeight: 19, color: colors.text },
  messageUnread: { fontWeight: '700' },
  time: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
});
