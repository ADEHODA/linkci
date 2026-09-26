// Listes de publications : un #hashtag, ou mes publications enregistrees
import React from 'react';
import { FlatList } from 'react-native';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import PostCard from '../components/PostCard';
import { EmptyState, SkeletonList, pullToRefresh } from '../components/ui';
import { spacing, creerStyles } from '../theme';

function ListePosts({ charger, vide }) {
  const styles = useStyles();
  const { data: posts, loading, refreshing, refresh, reload } = useApiList(charger);
  if (loading) return <SkeletonList carte />;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: 40, flexGrow: 1 }}
      data={posts}
      keyExtractor={(p) => String(p.id)}
      renderItem={({ item }) => <PostCard post={item} onRefresh={reload} />}
      refreshControl={pullToRefresh(refreshing, refresh)}
      ListEmptyComponent={vide}
    />
  );
}

export function HashtagScreen({ route }) {
  const { tag } = route.params;
  return (
    <ListePosts charger={() => api.getPostsHashtag(tag)}
      vide={<EmptyState icon="pricetag-outline" title={`Aucune publication avec #${tag}`} hint="Utilise ce hashtag dans ta prochaine publication !" />} />
  );
}

export function EnregistresScreen() {
  return (
    <ListePosts charger={api.getPostsEnregistres}
      vide={<EmptyState icon="bookmark-outline" title="Rien d'enregistre" hint="Touche le signet sous une publication pour la garder ici." />} />
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
}));
