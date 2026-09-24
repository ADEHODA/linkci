import React from 'react';
import { View, Text, FlatList, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Chip, Loading, EmptyState, pullToRefresh, SkeletonList } from '../components/ui';
import { colors, spacing, font, creerStyles, useTheme } from '../theme';

export default function BoursesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: bourses, loading, refreshing, refresh } = useApiList(api.getBourses);

  const renderBourse = ({ item }) => {
    const expiree = item.expiree === 1 || item.expiree === true;
    const joursRestants = item.deadline ? Math.ceil((new Date(item.deadline) - new Date()) / 86400000) : null;

    return (
      <Card style={expiree && styles.expired} onPress={() => api.lienSur(item.lien) && Linking.openURL(api.lienSur(item.lien))}>
        <View style={styles.chips}>
          {item.type ? <Chip label={item.type} /> : null}
          {expiree ? <Chip label="Expiree" tone="muted" icon="close-circle" />
            : joursRestants !== null && joursRestants <= 30 ? <Chip label={`J-${joursRestants}`} tone="danger" icon="time" />
            : null}
        </View>
        <Text style={styles.title}>{item.titre}</Text>
        <Text style={styles.org}>{item.organisme}</Text>
        {item.description ? <Text style={styles.desc} numberOfLines={3}>{item.description}</Text> : null}
        <View style={styles.meta}>
          {item.montant ? <Meta icon="wallet-outline" text={item.montant} /> : null}
          {item.deadline ? <Meta icon="calendar-outline" text={`Limite : ${item.deadline}`} /> : null}
          {item.lien ? <Meta icon="open-outline" text="Postuler" color={colors.primary} /> : null}
        </View>
      </Card>
    );
  };

  if (loading) return <SkeletonList />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={bourses}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderBourse}
      refreshControl={pullToRefresh(refreshing, refresh)}
      ListEmptyComponent={<EmptyState icon="cash-outline" title="Aucune bourse disponible" hint="Reviens bientot, de nouvelles offres arrivent regulierement." />}
    />
  );
}

function Meta({ icon, text, color: couleur }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = couleur || colors.textMuted;
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.metaText, { color }]}>{text}</Text>
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  expired: { opacity: 0.55 },
  chips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...font.heading },
  org: { fontSize: 14, color: colors.primary, fontWeight: '600', marginTop: 2, marginBottom: spacing.sm },
  desc: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontWeight: '500' },
}));
