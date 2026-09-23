import React from 'react';
import { View, Text, FlatList, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Chip, Loading, EmptyState, pullToRefresh } from '../components/ui';
import { colors, spacing, font } from '../theme';

export default function FormationsScreen() {
  const { data: formations, loading, refreshing, refresh } = useApiList(api.getFormations);

  if (loading) return <Loading />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={formations}
      keyExtractor={(item) => String(item.id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => (
        <Card onPress={() => item.site_web && Linking.openURL(item.site_web)}>
          {item.niveau ? <Chip label={item.niveau} tone="accent" icon="school" /> : null}
          <Text style={styles.nom}>{item.nom}</Text>
          <View style={styles.uniRow}>
            <Ionicons name="business-outline" size={14} color={colors.textMuted} />
            <Text style={styles.uni}>{item.universite}</Text>
          </View>
          {item.description ? <Text style={styles.desc} numberOfLines={3}>{item.description}</Text> : null}
          {(item.duree || item.frais) ? (
            <View style={styles.meta}>
              {item.duree ? <Text style={styles.metaText}><Text style={styles.metaLabel}>Duree </Text>{item.duree}</Text> : null}
              {item.frais ? <Text style={styles.metaText}><Text style={styles.metaLabel}>Frais </Text>{item.frais}</Text> : null}
            </View>
          ) : null}
        </Card>
      )}
      ListEmptyComponent={<EmptyState icon="school-outline" title="Aucune formation" />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  nom: { ...font.heading, marginTop: spacing.sm },
  uniRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginBottom: spacing.sm },
  uni: { fontSize: 14, color: colors.textMuted },
  desc: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  metaText: { fontSize: 13, color: colors.text },
  metaLabel: { color: colors.textFaint, fontWeight: '600' },
});
