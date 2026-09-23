import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, pullToRefresh } from '../components/ui';
import { colors, radius, spacing, font, shadow } from '../theme';
import { dateRelative, parseDate, MOIS } from '../utils';

async function chargerProfil() {
  const me = await api.getMe();
  const profil = await api.getProfile(me.id);
  return { user: me, posts: profil.posts || [], badges: me.badges || profil.badges || [] };
}

export default function ProfileScreen({ onLogout }) {
  const { data, loading, refreshing, refresh } = useApiList(chargerProfil, null);

  const handleLogout = () => {
    Alert.alert('Deconnexion', 'Se deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Deconnecter', style: 'destructive', onPress: () => { api.setToken(null); if (onLogout) onLogout(); } },
    ]);
  };

  if (loading || !data) return <Loading />;
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
              <Avatar name={`${user.prenom} ${user.nom}`} size={88} index={user.id} />
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

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={16} color={colors.danger} />
              <Text style={styles.logoutText}>Deconnexion</Text>
            </TouchableOpacity>
          </View>
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

function Stat({ valeur, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{valeur}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg, paddingVertical: 8, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.dangerSoft },
  logoutText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  sectionTitle: { ...font.heading, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  postCard: { marginHorizontal: spacing.md },
  postContent: { ...font.body, marginBottom: spacing.md },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  postDate: { ...font.tiny, marginLeft: 'auto' },
});
