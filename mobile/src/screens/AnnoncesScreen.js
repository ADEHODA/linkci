// Petites annonces du campus : livres, electronique, colocations, services...
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ScrollView, Modal, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { EmptyState, Fab, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';
import { partager } from '../partage';

const CATEGORIES = [
  { cle: 'livres', label: 'Livres', icone: 'book' },
  { cle: 'electronique', label: 'Electronique', icone: 'phone-portrait' },
  { cle: 'logement', label: 'Logement', icone: 'home' },
  { cle: 'fournitures', label: 'Fournitures', icone: 'pencil' },
  { cle: 'services', label: 'Services', icone: 'hand-left' },
  { cle: 'autre', label: 'Autre', icone: 'pricetag' },
];
const CATEGORIE = Object.fromEntries(CATEGORIES.map((c) => [c.cle, c]));

export const prixLisible = (a) => (a.vendu ? 'Vendu' : a.prix ? `${String(a.prix).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA` : 'Gratuit');

export default function AnnoncesScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: annonces, loading, refreshing, refresh, reload } = useApiList(api.getAnnonces);
  const [categorie, setCategorie] = useState('');
  const [recherche, setRecherche] = useState('');
  const [detail, setDetail] = useState(null);
  const [publier, setPublier] = useState(false);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return annonces
      .filter((a) => !categorie || a.categorie === categorie)
      .filter((a) => !q || [a.titre, a.description, a.ville].some((t) => (t || '').toLowerCase().includes(q)));
  }, [annonces, categorie, recherche]);

  if (loading) return <SkeletonList />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visibles}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.sm }}
        keyExtractor={(a) => String(a.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={
          <>
            <View style={styles.recherche}>
              <Ionicons name="search" size={18} color={colors.textFaint} />
              <TextInput style={styles.rechercheTexte} placeholder="Que cherches-tu ?" placeholderTextColor={colors.textFaint}
                value={recherche} onChangeText={setRecherche} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
              {[{ cle: '', label: 'Tout', icone: 'apps' }, ...CATEGORIES].map((c) => (
                <TouchableOpacity key={c.cle} style={[styles.filtre, categorie === c.cle && styles.filtreActif]} onPress={() => setCategorie(c.cle)}>
                  <Ionicons name={c.icone} size={14} color={categorie === c.cle ? colors.white : colors.textMuted} />
                  <Text style={[styles.filtreTexte, categorie === c.cle && styles.filtreTexteActif]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.carte, item.vendu && { opacity: 0.55 }]} onPress={() => setDetail(item)} activeOpacity={0.85}>
            {item.image ? <Image source={{ uri: api.imageUrl(item.image) }} style={styles.photo} />
              : <View style={[styles.photo, styles.sansPhoto]}><Ionicons name={(CATEGORIE[item.categorie] || CATEGORIES[5]).icone} size={34} color={colors.textFaint} /></View>}
            <View style={styles.carteBas}>
              <Text style={styles.prix}>{prixLisible(item)}</Text>
              <Text style={styles.titre} numberOfLines={2}>{item.titre}</Text>
              <Text style={styles.meta} numberOfLines={1}>{[item.ville, dateRelative(item.date_publication)].filter(Boolean).join(' · ')}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<EmptyState icon="pricetags-outline" title="Aucune annonce" hint="Vends un livre ou une calculatrice avec le bouton +" />}
      />
      <Fab icon="add" onPress={() => setPublier(true)} />
      <DetailAnnonce annonce={detail} navigation={navigation} onFermer={() => setDetail(null)} onChange={() => { setDetail(null); reload(); }} />
      <PublierAnnonce visible={publier} onFermer={() => setPublier(false)} onPublie={() => { setPublier(false); reload(); }} />
    </View>
  );
}

function DetailAnnonce({ annonce, navigation, onFermer, onChange }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!annonce) return null;
  const a = annonce;

  const action = (promesse) => promesse.then(onChange).catch((e) => Alert.alert('Erreur', e.message));
  const supprimer = () => Alert.alert('Supprimer', 'Supprimer cette annonce ?', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => action(api.supprimerAnnonce(a.id)) },
  ]);
  const signaler = () => api.signalerAnnonce(a.id, 'arnaque ou contenu interdit')
    .then((r) => Alert.alert('Merci', r.message)).catch((e) => Alert.alert('Erreur', e.message));
  const contacter = () => {
    onFermer();
    navigation.navigate('Conversation', { autre_id: a.user_id, prenom: a.prenom, nom: a.nom, avatar: a.avatar });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView>
            {a.image ? <Image source={{ uri: api.imageUrl(a.image) }} style={styles.grandePhoto} resizeMode="cover" /> : null}
            <Text style={styles.grandPrix}>{prixLisible(a)}</Text>
            <Text style={styles.sheetTitre}>{a.titre}</Text>
            <Text style={styles.meta}>{[(CATEGORIE[a.categorie] || {}).label, a.ville, dateRelative(a.date_publication)].filter(Boolean).join(' · ')}</Text>
            {a.description ? <Text style={styles.description}>{a.description}</Text> : null}
            <Text style={styles.vendeur}><Ionicons name="person-circle-outline" size={15} /> {a.prenom} {a.nom}</Text>
            <Text style={styles.prudence}>Rencontrez-vous dans un lieu public du campus et ne payez jamais d'avance.</Text>
          </ScrollView>
          {a.est_auteur ? (
            <>
              <PrimaryButton title={a.vendu ? 'Remettre en vente' : 'Marquer comme vendu'} icon="checkmark-done" onPress={() => action(api.annonceVendue(a.id))} />
              <TouchableOpacity style={styles.annuler} onPress={supprimer}><Text style={[styles.annulerTexte, { color: colors.danger }]}>Supprimer l'annonce</Text></TouchableOpacity>
            </>
          ) : (
            <>
              {!a.vendu ? <PrimaryButton title={`Contacter ${a.prenom}`} icon="chatbubble-ellipses" onPress={contacter} /> : null}
              <TouchableOpacity style={styles.annuler} onPress={signaler}><Text style={styles.annulerTexte}>Signaler l'annonce</Text></TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.annuler} onPress={() => partager(`A vendre : ${a.titre} (${prixLisible(a)})`, '/annonces')}>
            <Text style={[styles.annulerTexte, { color: colors.primary }]}>Partager l'annonce</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const VIDE = { categorie: 'livres', titre: '', prix: '', ville: '', description: '' };

function PublierAnnonce({ visible, onFermer, onPublie }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [a, setA] = useState(VIDE);
  const [photo, setPhoto] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const champ = (cle, placeholder, extra = {}) => (
    <TextInput style={styles.champ} placeholder={placeholder} placeholderTextColor={colors.textFaint}
      value={a[cle]} onChangeText={(v) => setA({ ...a, [cle]: v })} {...extra} />
  );

  const ajouterPhoto = (source) => choisirPhoto(source).then((p) => p && setPhoto(p))
    .catch(() => Alert.alert('Erreur', "Impossible d'ouvrir la photo"));

  const publier = async () => {
    if (!a.titre.trim()) {
      Alert.alert('Presque !', 'Donne un titre a ton annonce.');
      return;
    }
    setEnvoi(true);
    try {
      await api.creerAnnonce({ ...a, prix: a.prix.replace(/\D/g, '') || '0', image: photo?.base64 });
      setA(VIDE);
      setPhoto(null);
      onPublie();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setEnvoi(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          <Text style={styles.sheetTitre}>Nouvelle annonce</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
            <View style={styles.photoZone}>
              {photo ? (
                <View>
                  <Image source={{ uri: photo.uri }} style={styles.apercu} />
                  <TouchableOpacity style={styles.retirer} onPress={() => setPhoto(null)}><Ionicons name="close" size={16} color="#fff" /></TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity style={styles.boutonPhoto} onPress={() => ajouterPhoto('galerie')}>
                    <Ionicons name="image-outline" size={20} color={colors.primary} /><Text style={styles.boutonPhotoTexte}>Galerie</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.boutonPhoto} onPress={() => ajouterPhoto('camera')}>
                    <Ionicons name="camera-outline" size={20} color={colors.primary} /><Text style={styles.boutonPhotoTexte}>Photo</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            <View style={styles.chipsChoix}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity key={c.cle} style={[styles.filtre, a.categorie === c.cle && styles.filtreActif]} onPress={() => setA({ ...a, categorie: c.cle })}>
                  <Text style={[styles.filtreTexte, a.categorie === c.cle && styles.filtreTexteActif]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {champ('titre', 'Titre (ex. Calculatrice Casio fx-92)', { maxLength: 120 })}
            {champ('prix', 'Prix en FCFA (vide = gratuit)', { keyboardType: 'number-pad', maxLength: 10 })}
            {champ('ville', 'Ville / campus', { maxLength: 80 })}
            {champ('description', 'Etat, details...', { multiline: true, maxLength: 2000, style: [styles.champ, { minHeight: 80, textAlignVertical: 'top' }] })}
          </ScrollView>
          <PrimaryButton title="Publier" icon="send" onPress={publier} loading={envoi} />
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 90, gap: spacing.sm },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  rechercheTexte: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  filtres: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipsChoix: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filtre: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  carte: { flex: 1, maxWidth: '50%', backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: colors.cardAlt },
  sansPhoto: { alignItems: 'center', justifyContent: 'center' },
  carteBas: { padding: spacing.sm },
  prix: { fontSize: 15, fontWeight: '900', color: colors.primary },
  titre: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.sm, maxHeight: '88%' },
  sheetTitre: { ...font.heading },
  grandePhoto: { width: '100%', height: 220, borderRadius: radius.lg, marginBottom: spacing.md, backgroundColor: colors.cardAlt },
  grandPrix: { fontSize: 22, fontWeight: '900', color: colors.primary },
  description: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: spacing.md },
  vendeur: { fontSize: 14, color: colors.textMuted, marginTop: spacing.md, fontWeight: '600' },
  prudence: { fontSize: 12, color: colors.textFaint, marginTop: spacing.md, fontStyle: 'italic' },
  photoZone: { flexDirection: 'row', gap: spacing.sm },
  boutonPhoto: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  boutonPhotoTexte: { color: colors.primary, fontWeight: '700' },
  apercu: { width: 110, height: 110, borderRadius: radius.md },
  retirer: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
