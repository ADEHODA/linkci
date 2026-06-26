import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import PostCard from '../components/PostCard';

export default function FeedScreen() {
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [loading, setLoading] = useState(true);

  const loadPosts = async () => {
    try {
      const data = await api.getPosts();
      setPosts(data);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadPosts(); }, []));

  const handlePublish = async () => {
    if (!newPost.trim()) return;
    try {
      await api.createPost(newPost.trim());
      setNewPost('');
      loadPosts();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.postForm}>
        <TextInput
          style={styles.textarea}
          value={newPost}
          onChangeText={setNewPost}
          placeholder="Quoi de neuf sur le campus ?"
          placeholderTextColor="#999"
          multiline
        />
        <TouchableOpacity style={styles.publishBtn} onPress={handlePublish}>
          <Text style={styles.publishText}>Publier</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PostCard post={item} onRefresh={loadPosts} />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="newspaper-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucun post pour le moment</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4', padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  postForm: { backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2, borderWidth: 1, borderColor: '#EDEDEA' },
  textarea: { borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 10, padding: 12, fontSize: 15, minHeight: 80, textAlignVertical: 'top', backgroundColor: '#FAFAF8' },
  publishBtn: { backgroundColor: '#FF6B35', borderRadius: 50, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  publishText: { color: 'white', fontWeight: '700', fontSize: 15 },
});
