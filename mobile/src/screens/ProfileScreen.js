import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, pullToRefresh, SkeletonList } from '../components/ui';
import { colors, radius, spacing, font, shadow, creerStyles, useTheme } from '../theme';
import { dateRelative, parseDate, MOIS } from '../utils';

async function chargerProfil() {
  const me = await api.getMe();
  const profil = await api.getProfile(me.id);
  return { user: me, posts: profil.posts || [], badges: me.badges || profil.badges || [] };
}

export default function ProfileScreen({ navigation, onLogout }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, loading, refreshing, refresh } = useApiList(chargerProfil, null);

  const handleLogout = () => {
    Alert.alert('Deconnexion', 'Se deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Deconnecter', style: 'destructive', onPress: () => { api.setToken(null); if (onLogout) onLogout(); } },
    ]);
  };

  if (loading || !data) return <SkeletonList lignes={3} avatar />;
  const { user, posts, badges } = data;
  const inscrit = parseDate(user.date_inscription);
  const totalLikes = posts.reduce((n, p) => n + (p.nb_likes || 0), 0);

  return (
    <FlatList
      style={styles.container}
      refreshControl={pullToRefresh(refreshing, refresh)}
      ListHeaderComponent={
        <>
          <View style={styles.banner} />
          <View style={styles.header}>
            <View style={styles.avatarRing}>
              <Avatar name={`${user.prenom} ${user.nom}`} size={88} index={user.id} avatar={user.avatar} />
            </View>
            <Text style={styles.name}>{user.prenom} {user.nom}</Text>
            {(user.filiere || user.universite) ? (
              <Text style={styles.uni}>{[user.filiere, user.universite].filter(Boolean).join(' · ')}</Text>
            ) : null}
            {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
            {inscrit ? <Text style={styles.date}>Membre depuis {MOIS[inscrit.getMonth()]} {inscrit.getFullYear()}</Text> : null}

            <View style={styles.stats}>
              <Stat valeur={posts.length} label="Publications" />
              <View style={styles.statSep} />
              <Stat valeur={totalLikes} label="J'aime recus" />
              <View style={styles.statSep} />
              <Stat valeur={user.annee || '-'} label="Annee" />
            </View>

            {badges.length ? (
              <View style={styles.badges}>
                {badges.map((b) => (
                  <View key={b.id || b.nom} style={styles.badge}>
                    <Text style={styles.badgeIcon}>{b.icone}</Text>
                    <Text style={styles.badgeText}>{b.nom}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.boutons}>
              <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('ModifierProfil', { user })}>
                <Ionicons name="create-outline" size={16} color={colors.white} />
                <Text style={styles.editText}>Modifier le profil</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
          {user.est_admin ? (
            <TouchableOpacity style={styles.admin} onPress={() => navigation.navigate('Admin')} activeOpacity={0.85}>
              <Ionicons name="shield-checkmark" size={22} color={colors.white} />
              <View style={{ flex: 1 }}>
                <Text style={styles.adminTitre}>Administration</Text>
                <Text style={styles.adminTexte}>Statistiques, moderation, annonces</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.white} />
            </TouchableOpacity>
          ) : null}
          <Apparence />
          <Text style={styles.sectionTitle}>Mes publications</Text>
        </>
      }
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <Card style={styles.postCard}>
          {item.contenu ? <Text style={styles.postContent}>{item.contenu}</Text> : null}
          {item.image ? <PostImage uri={api.imageUrl(item.image)} style={{ marginBottom: spacing.md }} /> : null}
          <View style={styles.postMeta}>
            <View style={styles.metaItem}><Ionicons name="heart" size={14} color={colors.like} /><Text style={styles.metaText}>{item.nb_likes}</Text></View>
            <View style={styles.metaItem}><Ionicons name="chatbubble" size={13} color={colors.textFaint} /><Text style={styles.metaText}>{item.nb_commentaires}</Text></View>
            <Text style={styles.postDate}>{dateRelative(item.date_post)}</Text>
          </View>
        </Card>
      )}
      ListEmptyComponent={<EmptyState icon="create-outline" title="Aucune publication" hint="Tes publications apparaitront ici." />}
    />
  );
}

// Choix du theme : suit le telephone, ou force clair / sombre (memorise)
function Apparence() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useTheme();
  const options = [
    { cle: 'auto', label: 'Automatique', icone: 'phone-portrait-outline' },
    { cle: 'clair', label: 'Clair', icone: 'sunny-outline' },
    { cle: 'sombre', label: 'Sombre', icone: 'moon-outline' },
  ];
  return (
    <View style={styles.apparence}>
      <Text style={styles.apparenceTitre}>Apparence</Text>
      <View style={styles.segment}>
        {options.map((o) => {
          const actif = preference === o.cle;
          return (
            <TouchableOpacity key={o.cle} style={[styles.segBtn, actif && styles.segActif]} onPress={() => setPreference(o.cle)} activeOpacity={0.8}>
              <Ionicons name={o.icone} size={16} color={actif ? colors.white : colors.textMuted} />
              <Text style={[styles.segTexte, actif && { color: colors.white }]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Stat({ valeur, label }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{valeur}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  admin: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#7C3AED', borderRadius: radius.lg, padding: spacing.lg, marginHorizontal: spacing.md, marginBottom: spacing.md },
  adminTitre: { color: colors.white, fontWeight: '800', fontSize: 16 },
  adminTexte: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  container: { flex: 1, backgroundColor: colors.bg },
  banner: { height: 90, backgroundColor: colors.primary },
  header: { backgroundColor: colors.card, alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, ...shadow },
  avatarRing: { marginTop: -48, padding: 4, borderRadius: 52, backgroundColor: colors.card },
  name: { ...font.title, marginTop: spacing.sm },
  uni: { fontSize: 14, color: colors.primary, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  bio: { fontSize: 14, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },
  date: { ...font.tiny, marginTop: spacing.sm },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, backgroundColor: colors.bg, borderRadius: radius.lg, paddingVertical: spacing.md, alignSelf: 'stretch' },
  stat: { flex: 1, alignItems: 'center' },
  statSep: { width: 1, height: 28, backgroundColor: colors.border },
  statNum: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeIcon: { fontSize: 13 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  boutons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: colors.primary },
  editText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  logoutBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.dangerSoft },
  sectionTitle: { ...font.heading, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  postCard: { marginHorizontal: spacing.md },
  postContent: { ...font.body, marginBottom: spacing.md },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  postDate: { ...font.tiny, marginLeft: 'auto' },
  apparence: { backgroundColor: colors.card, marginHorizontal: spacing.md, marginTop: spacing.lg, borderRadius: radius.lg, padding: spacing.lg, ...shadow },
  apparenceTitre: { ...font.heading, fontSize: 15, marginBottom: spacing.md },
  segment: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: radius.pill },
  segActif: { backgroundColor: colors.primary },
  segTexte: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
}));
