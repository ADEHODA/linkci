import React from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from './Avatar';
import * as api from '../api';

export default function PostCard({ post, onRefresh }) {
  const [showComments, setShowComments] = React.useState(false);
  const [comments, setComments] = React.useState([]);
  const [commentText, setCommentText] = React.useState('');
  const [liked, setLiked] = React.useState(post.a_like);
  const [nbLikes, setNbLikes] = React.useState(post.nb_likes);
  const [loading, setLoading] = React.useState(false);

  const handleLike = async () => {
    try {
      const res = await api.likePost(post.id);
      setLiked(res.liked);
      setNbLikes(res.nb_likes);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  const toggleComments = async () => {
    if (!showComments) {
      try {
        const data = await api.getComments(post.id);
        setComments(data);
      } catch (e) {}
    }
    setShowComments(!showComments);
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    try {
      await api.addComment(post.id, commentText.trim());
      setCommentText('');
      const data = await api.getComments(post.id);
      setComments(data);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  const handleDelete = () => {
    Alert.alert('Supprimer', 'Supprimer cette publication ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePost(post.id);
            if (onRefresh) onRefresh();
          } catch (e) {
            Alert.alert('Erreur', e.message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar name={`${post.prenom} ${post.nom}`} size={36} index={post.user_id} />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{post.prenom} {post.nom}</Text>
          <Text style={styles.date}>{post.date_post?.slice(0, 10)}</Text>
        </View>
      </View>

      <Text style={styles.content}>{post.contenu}</Text>

      <View style={styles.actions}>
        <TouchableOpacity onPress={handleLike} style={[styles.actionBtn, liked && styles.likedBtn]}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? '#E91E63' : '#666'} />
          <Text style={[styles.actionText, liked && { color: '#E91E63' }]}>{nbLikes}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleComments} style={styles.actionBtn}>
          <Ionicons name="chatbubble-outline" size={18} color="#666" />
          <Text style={styles.actionText}>{post.nb_commentaires}</Text>
        </TouchableOpacity>
      </View>

      {showComments && (
        <View style={styles.commentsSection}>
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Text style={styles.commentUser}>{c.prenom} {c.nom}</Text>
              <Text style={styles.commentText}>{c.contenu}</Text>
            </View>
          ))}
          <View style={styles.commentForm}>
            <TextInput
              style={styles.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Ecrire un commentaire..."
              placeholderTextColor="#999"
            />
            <TouchableOpacity onPress={handleComment} style={styles.commentBtn}>
              <Ionicons name="send" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: '#EDEDEA',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerInfo: { marginLeft: 10, flex: 1 },
  name: { fontWeight: '600', fontSize: 14 },
  date: { fontSize: 12, color: '#9CA3AF' },
  content: { fontSize: 15, lineHeight: 22, marginBottom: 10 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#EDEDEA', paddingTop: 8, gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8 },
  likedBtn: { backgroundColor: '#FFF0F0' },
  actionText: { fontSize: 13, color: '#666' },
  commentsSection: { borderTopWidth: 1, borderTopColor: '#EDEDEA', paddingTop: 10, marginTop: 10 },
  comment: { marginBottom: 6 },
  commentUser: { fontWeight: '600', fontSize: 12 },
  commentText: { fontSize: 13, color: '#333' },
  commentForm: { flexDirection: 'row', gap: 8, marginTop: 8 },
  commentInput: { flex: 1, borderWidth: 1, borderColor: '#EDEDEA', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13 },
  commentBtn: { backgroundColor: '#FF6B35', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
