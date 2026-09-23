import React from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from './Avatar';
import PostImage from './PostImage';
import { Card } from './ui';
import * as api from '../api';
import { colors, radius, spacing, font } from '../theme';
import { dateRelative } from '../utils';

export default function PostCard({ post, onRefresh }) {
  const [showComments, setShowComments] = React.useState(false);
  const [comments, setComments] = React.useState([]);
  const [commentText, setCommentText] = React.useState('');
  const [liked, setLiked] = React.useState(!!post.a_like);
  const [nbLikes, setNbLikes] = React.useState(post.nb_likes);
  const [nbComments, setNbComments] = React.useState(post.nb_commentaires);

  const handleLike = async () => {
    // Reponse immediate a l'ecran, corrigee par la reponse du serveur
    setLiked(!liked);
    setNbLikes(nbLikes + (liked ? -1 : 1));
    try {
      const res = await api.likePost(post.id);
      setLiked(res.liked);
      setNbLikes(res.nb_likes);
    } catch (e) {
      setLiked(liked);
      setNbLikes(nbLikes);
      Alert.alert('Erreur', e.message);
    }
  };

  const toggleComments = async () => {
    if (!showComments) {
      try {
        setComments(await api.getComments(post.id));
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
      setNbComments(data.length);
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
    <Card>
      <View style={styles.header}>
        <Avatar name={`${post.prenom} ${post.nom}`} size={42} index={post.user_id} avatar={post.avatar} />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{post.prenom} {post.nom}</Text>
          <Text style={styles.date}>{dateRelative(post.date_post)}</Text>
        </View>
        {post.est_auteur ? (
          <TouchableOpacity onPress={handleDelete} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
      </View>

      {post.contenu ? <Text style={styles.content}>{post.contenu}</Text> : null}
      {post.image ? <PostImage uri={api.imageUrl(post.image)} style={styles.image} /> : null}

      <View style={styles.actions}>
        <TouchableOpacity onPress={handleLike} style={[styles.actionBtn, liked && { backgroundColor: colors.likeSoft }]}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={19} color={liked ? colors.like : colors.textMuted} />
          <Text style={[styles.actionText, liked && { color: colors.like }]}>{nbLikes}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleComments} style={[styles.actionBtn, showComments && { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={showComments ? 'chatbubble' : 'chatbubble-outline'} size={18} color={showComments ? colors.primary : colors.textMuted} />
          <Text style={[styles.actionText, showComments && { color: colors.primary }]}>{nbComments}</Text>
        </TouchableOpacity>
      </View>

      {showComments && (
        <View style={styles.commentsSection}>
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Avatar name={`${c.prenom} ${c.nom}`} size={28} index={c.user_id} avatar={c.avatar} />
              <View style={styles.commentBubble}>
                <Text style={styles.commentUser}>{c.prenom} {c.nom}</Text>
                <Text style={styles.commentText}>{c.contenu}</Text>
              </View>
            </View>
          ))}
          <View style={styles.commentForm}>
            <TextInput
              style={styles.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Ecrire un commentaire..."
              placeholderTextColor={colors.textFaint}
            />
            <TouchableOpacity onPress={handleComment} style={styles.commentBtn}>
              <Ionicons name="send" size={16} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  headerInfo: { marginLeft: spacing.md, flex: 1 },
  name: { fontWeight: '700', fontSize: 15, color: colors.text },
  date: { ...font.tiny, marginTop: 1 },
  content: { ...font.body, marginBottom: spacing.md },
  image: { marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.bg },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  commentsSection: { marginTop: spacing.md, gap: spacing.sm },
  comment: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  commentBubble: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  commentUser: { fontWeight: '700', fontSize: 12, color: colors.text },
  commentText: { fontSize: 14, color: colors.text, marginTop: 1 },
  commentForm: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, alignItems: 'center' },
  commentInput: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: colors.text },
  commentBtn: { backgroundColor: colors.primary, borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
