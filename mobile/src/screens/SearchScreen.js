import React, { useState, useRef } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { EmptyState } from '../components/ui';
import { colors, radius, spacing, shadow, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

export default function SearchScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const handleSearch = (q) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await api.searchAll(q.trim()));
      } catch (e) {}
      setLoading(false);
    }, 400);
  };

  // Chaque section : ou elle mene quand on touche un resultat
  const sections = results ? [
    { titre: 'Etudiants', data: results.users || [], icon: 'people' },
    { titre: 'Publications', data: results.posts || [], icon: 'newspaper', route: 'Home' },
    { titre: 'Bourses', data: results.bourses || [], icon: 'cash', route: 'Bourses' },
    { titre: 'Formations', data: results.formations || [], icon: 'school', route: 'Formations' },
  ].filter((s) => s.data.length > 0) : [];

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleSearch}
          placeholder="Etudiants, bourses, formations..."
          placeholderTextColor={colors.textFaint}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults(null); }} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </TouchableOpacity>
        )}
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />}

      {!loading && !results && (
        <EmptyState icon="search" title="Que cherches-tu ?" hint="Tape au moins 2 lettres : un nom, une bourse, une filiere..." />
      )}

      {!loading && results && sections.length === 0 && (
        <EmptyState icon="search-outline" title="Aucun resultat" hint={`Rien ne correspond a "${query}".`} />
      )}

      {!loading && sections.length > 0 && (
        <ScrollView contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
          {sections.map((section) => (
            <View key={section.titre} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name={section.icon} size={15} color={colors.primary} />
                <Text style={styles.sectionTitle}>{section.titre}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
              {section.data.map((row, i) => (
                <TouchableOpacity
                  key={row.id || i}
                  style={[styles.result, i > 0 && styles.resultBorder]}
                  onPress={() => section.titre === 'Etudiants'
                    ? navigation.navigate('ProfilEtudiant', { id: row.id })
                    : navigation.navigate(section.route)}
                  activeOpacity={0.7}
                >
                  {section.titre === 'Etudiants' ? <Avatar name={`${row.prenom} ${row.nom}`} size={38} index={row.id} avatar={row.avatar} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle} numberOfLines={2}>
                      {section.titre === 'Publications' ? row.contenu : row.titre || (row.prenom ? `${row.prenom} ${row.nom}` : row.nom)}
                    </Text>
                    <Text style={styles.resultSub} numberOfLines={1}>
                      {[row.organisme, row.filiere, row.universite, row.niveau, row.date_post && dateRelative(row.date_post)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, margin: spacing.md, marginBottom: 0, paddingHorizontal: spacing.lg, borderRadius: radius.pill, ...shadow },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: colors.text },
  section: { backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: spacing.md, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  sectionCount: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  result: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  resultBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  resultTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  resultSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
}));
