import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import PostCard from '../components/PostCard';
import Avatar from '../components/Avatar';
import CompleterProfil from '../components/CompleterProfil';
import StoriesBar from '../components/Stories';
import { Card, EmptyState, PrimaryButton, SkeletonList, pullToRefresh } from '../components/ui';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { salutation } from '../utils';

const PAR_PAGE = 20; // taille des pages renvoyees par /api/posts

export default function FeedScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [posts, setPosts] = useState([]);
  const [moi, setMoi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chargementSuite, setChargementSuite] = useState(false);
  const page = useRef(1);
  const fin = useRef(false);
  const [newPost, setNewPost] = useState('');
  const [photo, setPhoto] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [fac, setFac] = useState(false); // fil "Ma fac" : etudiants de mon universite
  const facRef = useRef(false); // valeur lue par recharger() (appele aussi au retour sur l'ecran)
  const [choix, setChoix] = useState(null); // sondage en preparation : ['', ''] ou null
  const [tour, setTour] = useState(0); // recharge les stories a chaque actualisation

  // Recharge depuis la premiere page (ouverture, actualisation, apres publication)
  const recharger = useCallback(async (facChoisi = facRef.current) => {
    try {
      const [premiere, me] = await Promise.all([api.getPosts(1, facChoisi), api.getMe()]); // profil a jour (carte "Complete ton profil")
      setPosts(premiere);
      setMoi(me);
      page.current = 1;
      fin.current = premiere.length < PAR_PAGE;
    } catch (e) {
      if (!/connexion internet|serveur demarre/i.test(e.message)) Alert.alert('Erreur', e.message);
    }
    setLoading(false);
  }, []);

  // ouverture instantanee : dernier fil connu, remplace des que le serveur repond
  const premierChargement = useRef(true);
  React.useEffect(() => {
    Promise.all([api.lireCache('/api/posts?page=1'), api.lireCache('/api/me')]).then(([p, me]) => {
      if (premierChargement.current && Array.isArray(p) && p.length) {
        setPosts(p);
        if (me) setMoi(me);
        setLoading(false);
      }
    });
  }, []);

  useFocusEffect(useCallback(() => { recharger().then(() => { premierChargement.current = false; }); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  const changerFil = (valeur) => {
    if (valeur === fac) return;
    setFac(valeur);
    facRef.current = valeur;
    recharger(valeur);
  };

  const actualiser = async () => {
    setTour((t) => t + 1);
    setRefreshing(true);
    await recharger();
    setRefreshing(false);
  };

  // Defilement infini : page suivante quand on approche du bas
  const chargerSuite = async () => {
    if (fin.current || chargementSuite || loading) return;
    setChargementSuite(true);
    try {
      const suivante = await api.getPosts(page.current + 1, fac);
      page.current += 1;
      fin.current = suivante.length < PAR_PAGE;
      setPosts((p) => [...p, ...suivante.filter((n) => !p.some((x) => x.id === n.id))]);
    } catch (e) {}
    setChargementSuite(false);
  };

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
    const options = choix ? choix.map((c) => c.trim()).filter(Boolean) : null;
    if (choix && options.length < 2) {
      Alert.alert('Sondage', 'Ecris au moins 2 choix (ou retire le sondage).');
      return;
    }
    setPublishing(true);
    try {
      await api.createPost(newPost.trim(), photo?.base64, options);
      setNewPost('');
      setPhoto(null);
      setChoix(null);
      await recharger();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setPublishing(false);
  };

  if (loading) return <SkeletonList lignes={3} avatar carte />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} onRefresh={recharger} />}
      refreshControl={pullToRefresh(refreshing, actualiser)}
      onEndReached={chargerSuite}
      onEndReachedThreshold={0.4}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <>
          {moi ? (
            <View style={styles.accueil}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bonjour}>{salutation()}, {moi.prenom} 👋</Text>
                <Text style={styles.sousTitre}>Quoi de neuf sur le campus ?</Text>
              </View>
              <Avatar name={`${moi.prenom} ${moi.nom}`} size={44} index={moi.id} avatar={moi.avatar} />
            </View>
          ) : null}
          <StoriesBar moi={moi} rechargement={tour} />
          <View style={styles.onglets}>
            {[[false, 'Pour toi'], [true, 'Ma fac']].map(([v, label]) => (
              <TouchableOpacity key={label} style={[styles.onglet, fac === v && styles.ongletActif]} onPress={() => changerFil(v)}>
                <Text style={[styles.ongletTexte, fac === v && styles.ongletTexteActif]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {fac && moi && !moi.universite ? <Text style={styles.aideFac}>Indique ton universite dans ton profil pour voir le fil de ta fac.</Text> : null}
          <CompleterProfil moi={moi} />
          <Card>
            <TextInput
              style={styles.textarea}
              value={newPost}
              onChangeText={setNewPost}
              placeholder="Partage une info, une question, une photo..."
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

            {choix ? (
              <View style={styles.sondage}>
                {choix.map((c, k) => (
                  <TextInput key={k} style={styles.choix} value={c} maxLength={80} placeholder={`Choix ${k + 1}`} placeholderTextColor={colors.textFaint}
                    onChangeText={(v) => setChoix(choix.map((x, j) => (j === k ? v : x)))} />
                ))}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  {choix.length < 4 ? <Text style={styles.lienSondage} onPress={() => setChoix([...choix, ''])}>+ Ajouter un choix</Text> : null}
                  <Text style={[styles.lienSondage, { color: colors.textMuted }]} onPress={() => setChoix(null)}>Retirer le sondage</Text>
                </View>
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
              {!choix ? (
                <TouchableOpacity style={styles.tool} onPress={() => setChoix(['', ''])}>
                  <Ionicons name="stats-chart-outline" size={18} color="#7C3AED" />
                  <Text style={styles.toolText}>Sondage</Text>
                </TouchableOpacity>
              ) : null}
              {(newPost.trim() || photo) ? (
                <PrimaryButton title="Publier" icon="send" onPress={handlePublish} loading={publishing} style={styles.publish} />
              ) : null}
            </View>
          </Card>
        </>
      }
      ListFooterComponent={
        chargementSuite ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          : posts.length && fin.current ? <Text style={styles.finFil}>Tu es a jour ✨</Text> : null
      }
      ListEmptyComponent={<EmptyState icon="newspaper-outline" title="Aucune publication" hint="Sois le premier a partager quelque chose !" />}
    />
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  accueil: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, paddingTop: spacing.xs, paddingBottom: spacing.md },
  bonjour: { ...font.title, fontSize: 21 },
  sousTitre: { ...font.small, marginTop: 2 },
  textarea: { fontSize: 15, minHeight: 60, textAlignVertical: 'top', color: colors.text, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.md },
  preview: { marginTop: spacing.md, alignSelf: 'flex-start' },
  previewImage: { width: 120, height: 120, borderRadius: radius.md },
  removePhoto: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  toolText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  publish: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 18 },
  onglets: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  onglet: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  ongletActif: { backgroundColor: colors.text, borderColor: colors.text },
  ongletTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  ongletTexteActif: { color: colors.bg },
  aideFac: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, paddingHorizontal: spacing.xs },
  sondage: { marginTop: spacing.md, gap: spacing.sm },
  choix: { backgroundColor: colors.cardAlt, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border },
  lienSondage: { fontSize: 13, fontWeight: '700', color: colors.primary },
  finFil: { textAlign: 'center', color: colors.textFaint, fontSize: 13, marginVertical: spacing.lg },
}));
