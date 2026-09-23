import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import PostCard from '../components/PostCard';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, PrimaryButton, pullToRefresh } from '../components/ui';
import { choisirPhoto } from '../photos';
import { colors, radius, spacing } from '../theme';

export default function FeedScreen() {
  const { data: posts, loading, refreshing, refresh, reload } = useApiList(() => api.getPosts());
  const [newPost, setNewPost] = useState('');
  const [photo, setPhoto] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const ajouterPhoto = async (source) => {
    try {
      const p = await choisirPhoto(source);
      if (p) setPhoto(p);
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };

  const handlePublish = async () => {
    if (!newPost.trim() && !photo) return;
    setPublishing(true);
    try {
      await api.createPost(newPost.trim(), photo?.base64);
      setNewPost('');
      setPhoto(null);
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

          {photo ? (
            <View style={styles.preview}>
              <Image source={{ uri: photo.uri }} style={styles.previewImage} />
              <TouchableOpacity style={styles.removePhoto} onPress={() => setPhoto(null)} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.toolbar}>
            <TouchableOpacity style={styles.tool} onPress={() => ajouterPhoto('galerie')}>
              <Ionicons name="image-outline" size={20} color={colors.accent} />
              <Text style={styles.toolText}>Galerie</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tool} onPress={() => ajouterPhoto('camera')}>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.toolText}>Photo</Text>
            </TouchableOpacity>
            {(newPost.trim() || photo) ? (
              <PrimaryButton title="Publier" icon="send" onPress={handlePublish} loading={publishing} style={styles.publish} />
            ) : null}
          </View>
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
  preview: { marginTop: spacing.md, alignSelf: 'flex-start' },
  previewImage: { width: 120, height: 120, borderRadius: radius.md },
  removePhoto: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.bg },
  toolText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  publish: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 18 },
});
