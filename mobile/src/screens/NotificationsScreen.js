import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Loading, EmptyState, pullToRefresh, SkeletonList } from '../components/ui';
import { colors, radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';
import { useFocusEffect } from '@react-navigation/native';
import { useEvenement, useRealtime } from '../realtime';

const ICONS = {
  bourse: ['cash', '#FF6B35'], formation: ['school', '#009E60'], message: ['chatbubble', '#2563EB'],
  like: ['heart', '#E11D48'], commentaire: ['chatbox', '#7C3AED'], mention: ['at', '#7C3AED'],
  suivi: ['person-add', '#009E60'], document: ['document-text', '#2563EB'],
};

// Ou mene une notification quand on la touche
function destination(n) {
  const profil = /\/profil\/(\d+)/.exec(n.lien || '');
  if (profil) return ['ProfilEtudiant', { id: Number(profil[1]) }];
  const cibles = {
    message: ['Home', { screen: 'Messages' }], like: ['Home', { screen: 'Accueil' }],
    commentaire: ['Home', { screen: 'Accueil' }], mention: ['Home', { screen: 'Accueil' }],
    bourse: ['Bourses'], formation: ['Formations'], document: ['Documents'],
  };
  return cibles[n.type] || null;
}

export default function NotificationsScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, loading, refreshing, refresh, reload } = useApiList(async () => (await api.getNotifications()).notifications || []);
  const { rafraichirCompteurs } = useRealtime();

  // A l'ouverture : on affiche les non lues en surbrillance, puis on les marque comme lues
  // (avec un delai, pour que la liste soit chargee avant d'etre marquee lue)
  useFocusEffect(useCallback(() => {
    const t = setTimeout(() => api.markNotificationsRead().then(rafraichirCompteurs).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [rafraichirCompteurs]));
  useEvenement('notification_update', () => reload());

  if (loading) return <SkeletonList />;

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
          <TouchableOpacity style={[styles.item, !item.lu && styles.unread]} activeOpacity={0.7}
            onPress={() => { const d = destination(item); if (d) navigation.navigate(...d); }}>
            <View style={[styles.iconBox, { backgroundColor: couleur + '1A' }]}>
              <Ionicons name={icon} size={20} color={couleur} />
            </View>
            <View style={styles.body}>
              <Text style={[styles.message, !item.lu && styles.messageUnread]}>{item.message}</Text>
              <Text style={styles.time}>{dateRelative(item.date_notification)}</Text>
            </View>
            {!item.lu && <View style={styles.dot} />}
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="Aucune notification" hint="Tu seras prevenu des likes, messages et nouvelles bourses." />}
    />
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
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
}));
