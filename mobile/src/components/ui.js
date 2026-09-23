// Composants d'interface communs a tous les ecrans
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, font, shadow } from '../theme';

export function Card({ children, style, onPress, onLongPress }) {
  if (onPress || onLongPress) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={onPress} onLongPress={onLongPress} style={[styles.card, style]}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function EmptyState({ icon, title, hint }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

// Petite etiquette arrondie (type de bourse, niveau, J-12...)
export function Chip({ label, tone = 'primary', icon }) {
  const t = TONES[tone] || TONES.primary;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({ title, onPress, loading, icon, style }) {
  return (
    <TouchableOpacity style={[styles.btn, style]} onPress={onPress} disabled={loading} activeOpacity={0.85}>
      {loading ? <ActivityIndicator color={colors.white} /> : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={colors.white} /> : null}
          <Text style={styles.btnText}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Fab({ icon = 'add', onPress }) {
  return (
    <TouchableOpacity style={styles.fab} onPress={onPress} activeOpacity={0.85}>
      <Ionicons name={icon} size={28} color={colors.white} />
    </TouchableOpacity>
  );
}

// A passer en `refreshControl` d'une FlatList : actualisation en tirant vers le bas
export function pullToRefresh(refreshing, onRefresh) {
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />;
}

const TONES = {
  primary: { bg: colors.primarySoft, fg: colors.primary },
  accent: { bg: colors.accentSoft, fg: colors.accent },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  muted: { bg: colors.bg, fg: colors.textMuted },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { ...font.heading, textAlign: 'center' },
  emptyHint: { ...font.small, textAlign: 'center', marginTop: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '700' },
  btn: { flexDirection: 'row', gap: 8, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});
