// Entraide : questions par matiere, poser une question, classement des meilleurs aidants
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ScrollView, Modal, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import useApiList from '../hooks/useApiList';
import { Card, Chip, EmptyState, Fab, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

const FILTRES = [['', 'Toutes'], ['sans_reponse', 'Sans reponse'], ['miennes', 'Mes questions']];
const MATIERES_COURANTES = ['Mathematiques', 'Informatique', 'Droit', 'Comptabilite', 'Economie', 'Physique', 'Anglais', 'Gestion'];

export default function EntraideScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [filtre, setFiltre] = useState('');
  const [matiere, setMatiere] = useState('');
  const [recherche, setRecherche] = useState('');
  const [poser, setPoser] = useState(false);
  const [classement, setClassement] = useState(false);
  const { data, loading, refreshing, refresh, reload } = useApiList(
    () => api.getQuestions({ filtre, matiere }), { questions: [], matieres: [] },
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setClassement(true)} hitSlop={10} style={{ marginRight: 4 }}>
          <Ionicons name="trophy" size={22} color="#F59E0B" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // filtre ou matiere changes : on recharge depuis le serveur
  React.useEffect(() => { reload(); }, [filtre, matiere]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (data.questions || []).filter((x) => !q || [x.titre, x.contenu, x.matiere].some((t) => (t || '').toLowerCase().includes(q)));
  }, [data, recherche]);

  if (loading) return <SkeletonList />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visibles}
        keyExtractor={(q) => String(q.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={
          <>
            <View style={styles.recherche}>
              <Ionicons name="search" size={18} color={colors.textFaint} />
              <TextInput style={styles.rechercheTexte} placeholder="Chercher une question..." placeholderTextColor={colors.textFaint}
                value={recherche} onChangeText={setRecherche} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
              {FILTRES.map(([cle, label]) => (
                <TouchableOpacity key={cle} style={[styles.filtre, filtre === cle && styles.filtreActif]} onPress={() => setFiltre(cle)}>
                  <Text style={[styles.filtreTexte, filtre === cle && styles.filtreTexteActif]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {(data.matieres || []).length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
                {['', ...data.matieres].map((m) => (
                  <TouchableOpacity key={m || 'toutes'} style={[styles.matiere, matiere === m && styles.matiereActive]} onPress={() => setMatiere(m)}>
                    <Text style={[styles.matiereTexte, matiere === m && { color: colors.white }]}>{m || 'Toutes les matieres'}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <Card onPress={() => navigation.navigate('Question', { id: item.id })}>
            <View style={styles.haut}>
              <Chip label={item.matiere} />
              {item.resolue ? <Chip label="Resolue" tone="accent" icon="checkmark-circle" /> : null}
            </View>
            <Text style={styles.titre}>{item.titre}</Text>
            {item.contenu ? <Text style={styles.extrait} numberOfLines={2}>{item.contenu}</Text> : null}
            <View style={styles.bas}>
              <Avatar name={`${item.prenom} ${item.nom}`} size={22} index={item.user_id} avatar={item.avatar} />
              <Text style={styles.meta}>{item.prenom} · {dateRelative(item.date_creation)}</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="chatbubbles-outline" size={15} color={item.nb_reponses ? colors.primary : colors.textFaint} />
              <Text style={[styles.meta, item.nb_reponses && { color: colors.primary, fontWeight: '700' }]}>{item.nb_reponses}</Text>
            </View>
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="help-buoy-outline" title="Aucune question" hint="Bloque sur un exercice ? Pose ta question avec le bouton +" />}
      />
      <Fab icon="add" onPress={() => setPoser(true)} />
      <PoserQuestion visible={poser} onFermer={() => setPoser(false)}
        onPosee={(id) => { setPoser(false); reload(); navigation.navigate('Question', { id }); }} />
      <Classement visible={classement} onFermer={() => setClassement(false)} />
    </View>
  );
}

function PoserQuestion({ visible, onFermer, onPosee }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [matiere, setMatiere] = useState('');
  const [titre, setTitre] = useState('');
  const [contenu, setContenu] = useState('');
  const [photo, setPhoto] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const envoyer = async () => {
    if (!matiere.trim() || titre.trim().length < 5) {
      Alert.alert('Presque !', 'Choisis une matiere et ecris ta question.');
      return;
    }
    setEnvoi(true);
    try {
      const r = await api.poserQuestion({ matiere: matiere.trim(), titre: titre.trim(), contenu: contenu.trim(), image: photo?.base64 });
      setMatiere(''); setTitre(''); setContenu(''); setPhoto(null);
      onPosee(r.id);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setEnvoi(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          <Text style={styles.sheetTitre}>Poser une question</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
            <View style={styles.puces}>
              {MATIERES_COURANTES.map((m) => (
                <TouchableOpacity key={m} style={[styles.matiere, matiere === m && styles.matiereActive]} onPress={() => setMatiere(m)}>
                  <Text style={[styles.matiereTexte, matiere === m && { color: colors.white }]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.champ} placeholder="Ou une autre matiere" placeholderTextColor={colors.textFaint}
              value={MATIERES_COURANTES.includes(matiere) ? '' : matiere} onChangeText={setMatiere} maxLength={60} />
            <TextInput style={styles.champ} placeholder="Ta question (ex. Comment calculer une derivee ?)" placeholderTextColor={colors.textFaint}
              value={titre} onChangeText={setTitre} maxLength={200} />
            <TextInput style={[styles.champ, { minHeight: 90, textAlignVertical: 'top' }]} placeholder="Details (optionnel)" placeholderTextColor={colors.textFaint}
              value={contenu} onChangeText={setContenu} multiline maxLength={3000} />
            {photo ? (
              <View>
                <Image source={{ uri: photo.uri }} style={styles.apercu} />
                <Text style={styles.retirer} onPress={() => setPhoto(null)}>Retirer la photo</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.boutonPhoto} onPress={() => choisirPhoto('galerie').then((p) => p && setPhoto(p)).catch(() => {})}>
                <Ionicons name="image-outline" size={18} color={colors.primary} />
                <Text style={styles.boutonPhotoTexte}>Ajouter une photo de l'exercice</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <PrimaryButton title="Publier la question" icon="send" onPress={envoyer} loading={envoi} />
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Classement({ visible, onFermer }) {
  const styles = useStyles();
  const [data, setData] = useState(null);
  React.useEffect(() => {
    if (visible) api.getClassementEntraide().then(setData).catch(() => setData({ classement: [], mes_points: 0 }));
  }, [visible]);
  const medailles = ['🥇', '🥈', '🥉'];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitre}>🏆 Meilleurs aidants</Text>
          <Text style={styles.aide}>1 point par reponse, 2 par 👍 recu, 10 par meilleure reponse. Tu as {data?.mes_points ?? '...'} points.</Text>
          <ScrollView>
            {(data?.classement || []).map((u, k) => (
              <View key={u.id} style={styles.ligne}>
                <Text style={styles.rang}>{medailles[k] || k + 1}</Text>
                <Avatar name={`${u.prenom} ${u.nom}`} size={36} index={u.id} avatar={u.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneNom}>{u.prenom} {u.nom}</Text>
                  {u.universite ? <Text style={styles.meta}>{u.universite}</Text> : null}
                </View>
                <Text style={styles.points}>{u.points} pts</Text>
              </View>
            ))}
            {data && !data.classement.length ? <Text style={styles.aide}>Personne n'a encore de points : reponds a une question pour etre le premier !</Text> : null}
          </ScrollView>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 90 },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  rechercheTexte: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  filtres: { gap: spacing.sm, paddingBottom: spacing.sm },
  filtre: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  matiere: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  matiereActive: { backgroundColor: '#7C3AED' },
  matiereTexte: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  haut: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  titre: { fontSize: 16, fontWeight: '800', color: colors.text },
  extrait: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  bas: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  meta: { fontSize: 12, color: colors.textFaint },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.md, maxHeight: '85%' },
  sheetTitre: { ...font.heading },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  apercu: { width: 120, height: 120, borderRadius: radius.md },
  retirer: { color: colors.textMuted, marginTop: 4, fontSize: 13 },
  boutonPhoto: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  boutonPhotoTexte: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  aide: { fontSize: 13, color: colors.textMuted },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  rang: { width: 28, fontSize: 18, fontWeight: '800', textAlign: 'center', color: colors.textMuted },
  ligneNom: { fontSize: 15, fontWeight: '700', color: colors.text },
  points: { fontSize: 15, fontWeight: '900', color: colors.primary },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
