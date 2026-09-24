import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, font, shadow, creerStyles, useTheme } from '../theme';

const TUILES = [
  { route: 'Bourses', icon: 'cash', titre: 'Bourses', texte: 'Financements et aides', couleur: '#FF6B35' },
  { route: 'Opportunites', icon: 'briefcase', titre: 'Stages & emplois', texte: 'Stages, jobs, alternances', couleur: '#0891B2' },
  { route: 'Formations', icon: 'school', titre: 'Formations', texte: 'Filieres et universites', couleur: '#009E60' },
  { route: 'Documents', icon: 'folder-open', titre: 'Documents', texte: 'Cours et sujets partages', couleur: '#2563EB' },
  { route: 'Groupes', icon: 'people', titre: 'Groupes', texte: "Discute avec ta promo", couleur: '#7C3AED' },
  { route: 'Calendrier', icon: 'calendar', titre: 'Calendrier', texte: 'Examens et evenements', couleur: '#D97706' },
];

export default function ExploreScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.search} onPress={() => navigation.navigate('Search')} activeOpacity={0.8}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <Text style={styles.searchText}>Rechercher etudiants, bourses, cours...</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Explorer le campus</Text>
      <View style={styles.grid}>
        {TUILES.map((t) => (
          <TouchableOpacity key={t.route} style={styles.tile} onPress={() => navigation.navigate(t.route)} activeOpacity={0.8}>
            <View style={[styles.tileIcon, { backgroundColor: t.couleur + '22' }]}>
              <Ionicons name={t.icon} size={24} color={t.couleur} />
            </View>
            <Text style={styles.tileTitle}>{t.titre}</Text>
            <Text style={styles.tileText}>{t.texte}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 13, ...shadow },
  searchText: { color: colors.textFaint, fontSize: 15 },
  section: { ...font.heading, marginTop: spacing.xl, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '48%', backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadow },
  tileIcon: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  tileTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  tileText: { ...font.small, marginTop: 2 },
}));
