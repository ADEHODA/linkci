import React, { useState } from 'react';
import { View, TextInput, FlatList, Alert, StyleSheet } from 'react-native';
import * as api from '../api';
import PostCard from '../components/PostCard';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, PrimaryButton, pullToRefresh } from '../components/ui';
import { colors, radius, spacing } from '../theme';

export default function FeedScreen() {
  const { data: posts, loading, refreshing, refresh, reload } = useApiList(() => api.getPosts());
  const [newPost, setNewPost] = useState('');
  const [publishing, setPublishing] = useState(false);

  const handlePublish = async () => {
    if (!newPost.trim()) return;
    setPublishing(true);
    try {
      await api.createPost(newPost.trim());
      setNewPost('');
      await reload();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setPublishing(false);
  };

  if (loading) return <Loading />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} onRefresh={reload} />}
      refreshControl={pullToRefresh(refreshing, refresh)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <Card>
          <TextInput
            style={styles.textarea}
            value={newPost}
            onChangeText={setNewPost}
            placeholder="Quoi de neuf sur le campus ?"
            placeholderTextColor={colors.textFaint}
            multiline
          />
          {newPost.trim() ? (
            <PrimaryButton title="Publier" icon="send" onPress={handlePublish} loading={publishing} style={{ marginTop: spacing.md }} />
          ) : null}
        </Card>
      }
      ListEmptyComponent={<EmptyState icon="newspaper-outline" title="Aucune publication" hint="Sois le premier a partager quelque chose !" />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  textarea: { fontSize: 15, minHeight: 60, textAlignVertical: 'top', color: colors.text, backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md },
});
