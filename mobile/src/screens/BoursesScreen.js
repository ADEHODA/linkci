import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Linking, TextInput, TouchableOpacity, ScrollView, ToastAndroid, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Chip, EmptyState, pullToRefresh, SkeletonList } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { lireFavoris, basculerFavori } from '../favoris';
import { partager } from '../partage';

function informer(texte) {
  if (Platform.OS === 'android') ToastAndroid.show(texte, ToastAndroid.SHORT);
  else Alert.alert('', texte);
}

export default function BoursesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: bourses, loading, refreshing, refresh } = useApiList(api.getBourses);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('Toutes');
  const [favoris, setFavoris] = useState({});

  useFocusEffect(useCallback(() => { lireFavoris().then(setFavoris); }, []));

  const types = useMemo(() => ['Toutes', 'Favoris', ...new Set(bourses.map((b) => b.type).filter(Boolean))], [bourses]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return bourses
      .filter((b) => filtre === 'Toutes' || (filtre === 'Favoris' ? String(b.id) in favoris : b.type === filtre))
      .filter((b) => !q || [b.titre, b.organisme, b.description, b.pays, b.cible].some((t) => (t || '').toLowerCase().includes(q)))
      // encore ouvertes d'abord, puis par date limite la plus proche
      .sort((a, b) => (Number(!!a.expiree) - Number(!!b.expiree)) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  }, [bourses, filtre, recherche, favoris]);

  const etoile = async (bourse) => {
    const { favori, rappel } = await basculerFavori(bourse);
    setFavoris(await lireFavoris());
    informer(favori ? (rappel || 'Ajoutee aux favoris') : 'Retiree des favoris');
  };

  const renderBourse = ({ item }) => {
    const expiree = item.expiree === 1 || item.expiree === true;
    const joursRestants = item.deadline ? Math.ceil((new Date(item.deadline) - new Date()) / 86400000) : null;
    const favori = String(item.id) in favoris;

    return (
      <Card style={expiree && styles.expired} onPress={() => api.lienSur(item.lien) && Linking.openURL(api.lienSur(item.lien))}>
        <View style={styles.haut}>
          <View style={styles.chips}>
            {item.type ? <Chip label={item.type} /> : null}
            {expiree ? <Chip label="Expiree" tone="muted" icon="close-circle" />
              : joursRestants !== null && joursRestants >= 0 && joursRestants <= 30 ? <Chip label={`J-${joursRestants}`} tone="danger" icon="time" />
              : null}
          </View>
          <TouchableOpacity onPress={() => partager(`Bourse : ${item.titre}${item.deadline ? ` (date limite ${item.deadline})` : ''}`, '/bourses')} hitSlop={12} style={{ marginRight: 14 }}>
            <Ionicons name="share-social-outline" size={21} color={colors.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => etoile(item)} hitSlop={12}>
            <Ionicons name={favori ? 'star' : 'star-outline'} size={22} color={favori ? '#F59E0B' : colors.textFaint} />
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{item.titre}</Text>
        <Text style={styles.org}>{item.organisme}</Text>
        {item.description ? <Text style={styles.desc} numberOfLines={3}>{item.description}</Text> : null}
        <View style={styles.meta}>
          {item.montant ? <Meta icon="wallet-outline" text={item.montant} /> : null}
          {item.deadline ? <Meta icon="calendar-outline" text={`Limite : ${item.deadline}`} /> : null}
          {api.lienSur(item.lien) ? <Meta icon="open-outline" text="Postuler" color={colors.primary} /> : null}
        </View>
      </Card>
    );
  };

  if (loading) return <SkeletonList />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={visibles}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderBourse}
      refreshControl={pullToRefresh(refreshing, refresh)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.entete}>
          <View style={styles.recherche}>
            <Ionicons name="search" size={17} color={colors.textFaint} />
            <TextInput style={styles.champ} value={recherche} onChangeText={setRecherche}
              placeholder="Rechercher une bourse, un pays..." placeholderTextColor={colors.textFaint} />
            {recherche ? <TouchableOpacity onPress={() => setRecherche('')} hitSlop={10}><Ionicons name="close-circle" size={18} color={colors.textFaint} /></TouchableOpacity> : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
            {types.map((t) => (
              <TouchableOpacity key={t} style={[styles.filtre, filtre === t && styles.filtreActif]} onPress={() => setFiltre(t)}>
                {t === 'Favoris' ? <Ionicons name="star" size={13} color={filtre === t ? colors.white : '#F59E0B'} /> : null}
                <Text style={[styles.filtreTexte, filtre === t && styles.filtreTexteActif]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={filtre === 'Favoris'
        ? <EmptyState icon="star-outline" title="Aucun favori" hint="Touche l'etoile d'une bourse : tu recevras un rappel avant la date limite." />
        : <EmptyState icon="cash-outline" title="Aucune bourse trouvee" hint="Essaie un autre mot-cle ou un autre filtre." />}
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
  entete: { marginBottom: spacing.md, gap: spacing.md },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.lg, ...shadow },
  champ: { flex: 1, paddingVertical: 11, fontSize: 15, color: colors.text },
  filtres: { gap: spacing.sm },
  filtre: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  expired: { opacity: 0.55 },
  haut: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm, flex: 1, flexWrap: 'wrap' },
  title: { ...font.heading },
  org: { fontSize: 14, color: colors.primary, fontWeight: '600', marginTop: 2, marginBottom: spacing.sm },
  desc: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontWeight: '500' },
}));
