// Composants d'interface communs a tous les ecrans
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, RefreshControl, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, creerStyles, useTheme, themeActuel } from '../theme';

export function Card({ children, style, onPress, onLongPress }) {
  const styles = useStyles();
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
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function EmptyState({ icon, title, hint }) {
  const styles = useStyles();
  const { colors } = useTheme();
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
  const styles = useStyles();
  const { colors } = useTheme();
  const tons = {
    primary: { bg: colors.primarySoft, fg: colors.primary },
    accent: { bg: colors.accentSoft, fg: colors.accent },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    muted: { bg: colors.cardAlt, fg: colors.textMuted },
  };
  const t = tons[tone] || tons.primary;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({ title, onPress, loading, icon, style }) {
  const styles = useStyles();
  const { colors } = useTheme();
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
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.fab} onPress={onPress} activeOpacity={0.85}>
      <Ionicons name={icon} size={28} color={colors.white} />
    </TouchableOpacity>
  );
}

// Squelette de chargement : blocs qui "respirent" pendant que les donnees arrivent
export function SkeletonList({ lignes = 4, avatar = false, carte = false }) {
  const styles = useStyles();
  const opacite = React.useRef(new Animated.Value(0.45)).current;
  React.useEffect(() => {
    const boucle = Animated.loop(Animated.sequence([
      Animated.timing(opacite, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacite, { toValue: 0.45, duration: 700, useNativeDriver: true }),
    ]));
    boucle.start();
    return () => boucle.stop();
  }, [opacite]);
  return (
    <View style={styles.skeletonPage}>
      {Array.from({ length: lignes }).map((_, i) => (
        <Animated.View key={i} style={[styles.skeletonItem, { opacity: opacite }]}>
          {avatar ? <View style={styles.skeletonAvatar} /> : null}
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeletonBar, { width: '55%' }]} />
            <View style={[styles.skeletonBar, { width: '85%' }]} />
            {carte ? <View style={[styles.skeletonBar, { width: '100%', height: 120, marginTop: 4 }]} /> : null}
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

// A passer en `refreshControl` d'une FlatList : actualisation en tirant vers le bas
export function pullToRefresh(refreshing, onRefresh) {
  const { colors } = themeActuel();
  return (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]}
      tintColor={colors.primary} progressBackgroundColor={colors.card} />
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
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
  skeletonPage: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  skeletonItem: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  skeletonAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.cardAlt },
  skeletonBar: { height: 12, borderRadius: 6, backgroundColor: colors.cardAlt },
}));
