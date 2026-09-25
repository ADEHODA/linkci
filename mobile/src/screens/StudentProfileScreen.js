// Profil d'un autre etudiant : navigate('ProfilEtudiant', { id })
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import PostImage from '../components/PostImage';
import useApiList from '../hooks/useApiList';
import { Card, EmptyState, SkeletonList, pullToRefresh } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative, parseDate, MOIS } from '../utils';

export default function StudentProfileScreen({ route, navigation }) {
  const { id } = route.params;
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, loading, refreshing, refresh } = useApiList(async () => {
    const [profil, moi] = await Promise.all([api.getProfile(id), api.getMe()]);
    return { ...profil, estMoi: moi.id === id };
  }, null);

  if (loading || !data) return <SkeletonList lignes={3} avatar carte />;

  const basculerSuivi = () => (data.suivi ? api.nePlusSuivre(id) : api.suivre(id)).then(refresh).catch((e) => Alert.alert('Erreur', e.message));

  const changerBlocage = () => {
    const bloque = data.bloque;
    Alert.alert(
      bloque ? `Debloquer ${data.user.prenom} ?` : `Bloquer ${data.user.prenom} ?`,
      bloque ? 'Vous pourrez de nouveau voir vos publications et vous ecrire.' : 'Vous ne verrez plus vos publications et ne pourrez plus vous ecrire.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: bloque ? 'Debloquer' : 'Bloquer',
          style: bloque ? 'default' : 'destructive',
          onPress: () => (bloque ? api.debloquer(id) : api.bloquer(id)).then(refresh).catch((e) => Alert.alert('Erreur', e.message)),
        },
      ],
    );
  };
  const { user, posts = [], badges = [], estMoi } = data;
  const inscrit = parseDate(user.date_inscription);
  const totalLikes = posts.reduce((n, p) => n + (p.nb_likes || 0), 0);

  return (
    <FlatList
      style={styles.container}
      refreshControl={pullToRefresh(refreshing, refresh)}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={
        <>
          <View style={styles.banner} />
          <View style={styles.header}>
            <View style={styles.avatarRing}>
              <Avatar name={`${user.prenom} ${user.nom}`} size={92} index={user.id} avatar={user.avatar} />
            </View>
            <Text style={styles.name}>{user.prenom} {user.nom}</Text>
            {(user.filiere || user.universite) ? (
              <Text style={styles.uni}>{[user.filiere, user.annee, user.universite].filter(Boolean).join(' · ')}</Text>
            ) : null}
            {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
            {inscrit ? <Text style={styles.date}>Membre depuis {MOIS[inscrit.getMonth()]} {inscrit.getFullYear()}</Text> : null}

            <View style={styles.stats}>
              <Stat styles={styles} valeur={posts.length} label="Publications" />
              <View style={styles.statSep} />
              <Stat styles={styles} valeur={totalLikes} label="J'aime recus" />
              <View style={styles.statSep} />
              <Stat styles={styles} valeur={badges.length} label="Badges" />
            </View>

            {badges.length ? (
              <View style={styles.badges}>
                {badges.map((b) => (
                  <View key={b.id || b.nom} style={styles.badge}>
                    <Text>{b.icone}</Text>
                    <Text style={styles.badgeText}>{b.nom}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {estMoi ? (
              <TouchableOpacity style={styles.bouton} onPress={() => navigation.navigate('Home', { screen: 'Profil' })}>
                <Ionicons name="person-circle-outline" size={18} color={colors.white} />
                <Text style={styles.boutonTexte}>C'est ton profil</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.bouton}
                onPress={() => navigation.navigate('Conversation', { autre_id: user.id, prenom: user.prenom, nom: user.nom, avatar: user.avatar })}
              >
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.white} />
                <Text style={styles.boutonTexte}>Envoyer un message</Text>
              </TouchableOpacity>
            )}
            {!estMoi && !data.bloque ? (
              <TouchableOpacity style={[styles.suivre, data.suivi && styles.suivreActif]} onPress={basculerSuivi} activeOpacity={0.85}>
                <Ionicons name={data.suivi ? 'checkmark' : 'person-add-outline'} size={16} color={data.suivi ? colors.primary : colors.white} />
                <Text style={[styles.suivreTexte, data.suivi && { color: colors.primary }]}>{data.suivi ? 'Suivi' : 'Suivre'}</Text>
              </TouchableOpacity>
            ) : null}
            {!estMoi ? (
              <TouchableOpacity style={styles.bloquer} onPress={changerBlocage} hitSlop={8}>
                <Ionicons name={data.bloque ? 'lock-open-outline' : 'ban-outline'} size={15} color={colors.textMuted} />
                <Text style={styles.bloquerTexte}>{data.bloque ? `Debloquer ${user.prenom}` : `Bloquer ${user.prenom}`}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.sectionTitle}>Publications</Text>
        </>
      }
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
      ListEmptyComponent={<EmptyState icon="create-outline" title="Aucune publication" hint={`${user.prenom} n'a encore rien publie.`} />}
    />
  );
}

function Stat({ styles, valeur, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNum}>{valeur}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  suivre: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingHorizontal: 22, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.primary },
  suivreActif: { backgroundColor: 'transparent' },
  suivreTexte: { color: colors.white, fontWeight: '800' },
  bloquer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingVertical: 6 },
  bloquerTexte: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  container: { flex: 1, backgroundColor: colors.bg },
  banner: { height: 80, backgroundColor: colors.primary },
  header: { backgroundColor: colors.card, alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, ...shadow },
  avatarRing: { marginTop: -50, padding: 4, borderRadius: 54, backgroundColor: colors.card },
  name: { ...font.title, marginTop: spacing.sm, textAlign: 'center' },
  uni: { fontSize: 14, color: colors.primary, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  bio: { fontSize: 14, color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },
  date: { ...font.tiny, marginTop: spacing.sm },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, backgroundColor: colors.cardAlt, borderRadius: radius.lg, paddingVertical: spacing.md, alignSelf: 'stretch' },
  stat: { flex: 1, alignItems: 'center' },
  statSep: { width: 1, height: 28, backgroundColor: colors.border },
  statNum: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  bouton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.lg, paddingVertical: 12, borderRadius: radius.pill, backgroundColor: colors.primary, alignSelf: 'stretch' },
  boutonTexte: { color: colors.white, fontWeight: '800', fontSize: 15 },
  sectionTitle: { ...font.heading, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  postCard: { marginHorizontal: spacing.md },
  postContent: { ...font.body, marginBottom: spacing.md },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  postDate: { ...font.tiny, marginLeft: 'auto' },
}));
