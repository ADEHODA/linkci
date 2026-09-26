import React from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from './Avatar';
import PostImage from './PostImage';
import { Card } from './ui';
import * as api from '../api';
import { colors, radius, spacing, font, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';
import { partager } from '../partage';

// Texte d'une publication : les #hashtags deviennent touchables
function TexteAvecHashtags({ texte, style, styleTag, onTag }) {
  const morceaux = texte.split(/(#[A-Za-z0-9_À-ÖØ-öø-ÿ]{2,40})/);
  return (
    <Text style={style}>
      {morceaux.map((m, k) => (m.startsWith('#') && k % 2 === 1
        ? <Text key={k} style={styleTag} onPress={() => onTag(m.slice(1))}>{m}</Text>
        : m))}
    </Text>
  );
}

export default function PostCard({ post, onRefresh }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [showComments, setShowComments] = React.useState(false);
  const [comments, setComments] = React.useState([]);
  const [commentText, setCommentText] = React.useState('');
  const [liked, setLiked] = React.useState(!!post.a_like);
  const [nbLikes, setNbLikes] = React.useState(post.nb_likes);
  const [nbComments, setNbComments] = React.useState(post.nb_commentaires);
  const [extra, setExtra] = React.useState({ reactions: post.reactions || {}, ma_reaction: post.ma_reaction, sondage: post.sondage || [], mon_vote: post.mon_vote });
  const [choixReaction, setChoixReaction] = React.useState(false);
  const [enregistre, setEnregistre] = React.useState(!!post.enregistre);

  const basculerEnregistre = async () => {
    const oui = !enregistre;
    setEnregistre(oui);
    try { await api.enregistrerPost(post.id, oui); }
    catch (e) { setEnregistre(!oui); Alert.alert('Erreur', e.message); }
  };
  const partagerPost = () => {
    const extrait = (post.contenu || 'Une photo').slice(0, 200);
    partager(`${post.prenom} ${post.nom} sur LinkCI :\n\n${extrait}`, `/fil#post-${post.id}`);
  };
  const navigation = useNavigation();
  const echelleCoeur = React.useRef(new Animated.Value(1)).current;
  const voirProfil = (id) => navigation.navigate('ProfilEtudiant', { id });

  const handleLike = async () => {
    // petit rebond du coeur
    Animated.sequence([
      Animated.spring(echelleCoeur, { toValue: 1.35, speed: 50, bounciness: 12, useNativeDriver: true }),
      Animated.spring(echelleCoeur, { toValue: 1, speed: 30, bounciness: 8, useNativeDriver: true }),
    ]).start();
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

  // Reactions : appui long sur le coeur ; la meme reaction une 2e fois l'enleve
  const reagir = async (emoji) => {
    setChoixReaction(false);
    try {
      const r = await api.reagir(post.id, emoji);
      setExtra((e) => ({ ...e, reactions: r.reactions, ma_reaction: r.ma_reaction }));
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  const voter = async (optionId) => {
    try {
      const r = await api.voter(post.id, optionId);
      setExtra((e) => ({ ...e, sondage: r.sondage, mon_vote: r.mon_vote }));
    } catch (e) {
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

  // Publication d'un autre etudiant : signaler ou bloquer l'auteur
  const signaler = (motif) => {
    api.signalerPost(post.id, motif)
      .then((r) => Alert.alert('Merci', r.message))
      .catch((e) => Alert.alert('Erreur', e.message));
  };

  const ouvrirMenu = () => {
    Alert.alert(`${post.prenom} ${post.nom}`, 'Que veux-tu faire ?', [
      {
        text: 'Signaler la publication',
        onPress: () => Alert.alert('Signaler', 'Pourquoi ?', [
          { text: 'Spam ou arnaque', onPress: () => signaler('Spam ou arnaque') },
          { text: 'Contenu choquant ou haineux', onPress: () => signaler('Contenu choquant ou haineux') },
          { text: 'Annuler', style: 'cancel' },
        ]),
      },
      {
        text: `Bloquer ${post.prenom}`,
        style: 'destructive',
        onPress: () => Alert.alert(`Bloquer ${post.prenom} ?`, "Vous ne verrez plus vos publications et ne pourrez plus vous ecrire. Tu pourras le debloquer depuis son profil.", [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Bloquer',
            style: 'destructive',
            onPress: () => api.bloquer(post.user_id).then(() => onRefresh && onRefresh()).catch((e) => Alert.alert('Erreur', e.message)),
          },
        ]),
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  return (
    <Card>
      <View style={styles.header}>
        <TouchableOpacity style={styles.auteur} onPress={() => voirProfil(post.user_id)} activeOpacity={0.7}>
          <Avatar name={`${post.prenom} ${post.nom}`} size={42} index={post.user_id} avatar={post.avatar} />
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{post.prenom} {post.nom}</Text>
            <Text style={styles.date}>{[post.universite, dateRelative(post.date_post)].filter(Boolean).join(' · ')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={post.est_auteur ? handleDelete : ouvrirMenu} hitSlop={10}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textFaint} />
        </TouchableOpacity>
      </View>

      {post.contenu ? (
        <TexteAvecHashtags texte={post.contenu} style={styles.content} styleTag={styles.hashtag}
          onTag={(tag) => navigation.push('Hashtag', { tag })} />
      ) : null}
      {post.image ? <PostImage uri={api.imageUrl(post.image)} style={styles.image} /> : null}

      {extra.sondage.length ? (() => {
        const total = extra.sondage.reduce((n, o) => n + o.votes, 0);
        return (
          <View style={styles.sondage}>
            {extra.sondage.map((o) => {
              const pct = total ? Math.round((o.votes * 100) / total) : 0;
              const moi = extra.mon_vote === o.id;
              return (
                <TouchableOpacity key={o.id} style={[styles.option, moi && styles.optionMoi]} onPress={() => voter(o.id)} activeOpacity={0.8}>
                  {extra.mon_vote ? <View style={[styles.optionBarre, { width: `${pct}%` }, moi && styles.optionBarreMoi]} /> : null}
                  <Text style={[styles.optionTexte, moi && { fontWeight: '800' }]} numberOfLines={2}>{moi ? '✓ ' : ''}{o.texte}</Text>
                  {extra.mon_vote ? <Text style={styles.optionPct}>{pct} %</Text> : null}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.sondageTotal}>{total} vote{total > 1 ? 's' : ''}{extra.mon_vote ? '' : ' · touche un choix pour voter'}</Text>
          </View>
        );
      })() : null}

      {Object.keys(extra.reactions).length ? (
        <View style={styles.reactionsResume}>
          {Object.entries(extra.reactions).map(([emoji, nb]) => (
            <TouchableOpacity key={emoji} style={[styles.reactionPastille, extra.ma_reaction === emoji && styles.reactionMoi]} onPress={() => reagir(emoji)}>
              <Text style={styles.reactionTexte}>{emoji} {nb}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {choixReaction ? (
        <View style={styles.choixReaction}>
          {['🔥', '😂', '👏', '😮', '😢'].map((e) => (
            <TouchableOpacity key={e} onPress={() => reagir(e)} hitSlop={6}><Text style={styles.choixEmoji}>{e}</Text></TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity onPress={handleLike} onLongPress={() => setChoixReaction(!choixReaction)} delayLongPress={300}
          style={[styles.actionBtn, liked && { backgroundColor: colors.likeSoft }]}>
          <Animated.View style={{ transform: [{ scale: echelleCoeur }] }}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={19} color={liked ? colors.like : colors.textMuted} />
          </Animated.View>
          <Text style={[styles.actionText, liked && { color: colors.like }]}>{nbLikes}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setChoixReaction(!choixReaction)} style={styles.actionBtn}>
          <Text style={{ fontSize: 16 }}>{extra.ma_reaction || '😊'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleComments} style={[styles.actionBtn, showComments && { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={showComments ? 'chatbubble' : 'chatbubble-outline'} size={18} color={showComments ? colors.primary : colors.textMuted} />
          <Text style={[styles.actionText, showComments && { color: colors.primary }]}>{nbComments}</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={partagerPost} style={styles.actionBtn} accessibilityLabel="Partager">
          <Ionicons name="share-social-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={basculerEnregistre} style={[styles.actionBtn, enregistre && { backgroundColor: colors.primarySoft }]}
          accessibilityLabel={enregistre ? 'Retirer des enregistrements' : 'Enregistrer'}>
          <Ionicons name={enregistre ? 'bookmark' : 'bookmark-outline'} size={18} color={enregistre ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </View>

      {showComments && (
        <View style={styles.commentsSection}>
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <TouchableOpacity onPress={() => voirProfil(c.user_id)}>
                <Avatar name={`${c.prenom} ${c.nom}`} size={28} index={c.user_id} avatar={c.avatar} />
              </TouchableOpacity>
              <View style={styles.commentBubble}>
                <Text style={styles.commentUser} onPress={() => voirProfil(c.user_id)}>{c.prenom} {c.nom}</Text>
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

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  sondage: { marginTop: spacing.sm, gap: 6 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  optionMoi: { borderColor: colors.primary },
  optionBarre: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.cardAlt },
  optionBarreMoi: { backgroundColor: colors.primarySoft },
  optionTexte: { flex: 1, fontSize: 14, color: colors.text },
  optionPct: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginLeft: spacing.sm },
  sondageTotal: { fontSize: 12, color: colors.textFaint },
  reactionsResume: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  reactionPastille: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: 'transparent' },
  reactionMoi: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reactionTexte: { fontSize: 13, color: colors.text },
  choixReaction: { flexDirection: 'row', alignSelf: 'flex-start', gap: 14, marginTop: spacing.sm, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  choixEmoji: { fontSize: 26 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  auteur: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerInfo: { marginLeft: spacing.md, flex: 1 },
  name: { fontWeight: '700', fontSize: 15, color: colors.text },
  date: { ...font.tiny, marginTop: 1 },
  content: { ...font.body, marginBottom: spacing.md },
  hashtag: { color: colors.primary, fontWeight: '700' },
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
}));
