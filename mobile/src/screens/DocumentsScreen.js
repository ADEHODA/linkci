// Documents de cours : cours, TD, anciens sujets... classes par type, matiere, fac et filiere, avec votes "utile"
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Linking, Alert, Modal, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, EmptyState, Fab, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const DOC_ICONS = {
  pdf: 'document-text', doc: 'document-text', docx: 'document-text',
  ppt: 'easel', pptx: 'easel', xls: 'grid', xlsx: 'grid',
  zip: 'archive', rar: 'archive', png: 'image', jpg: 'image', jpeg: 'image', txt: 'document',
};
const FORMATS = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'application/zip', 'application/x-rar-compressed', 'application/vnd.rar', 'image/png', 'image/jpeg'];
const TAILLE_MAX = 16 * 1024 * 1024; // limite du serveur
const TYPES = [['cours', '📘 Cours'], ['td', '✏️ TD'], ['examen', '📝 Sujets'], ['resume', '🗒️ Resumes'], ['autre', '📎 Autre']];
const LIBELLE_TYPE = Object.fromEntries(TYPES);
const TRIS = [['', 'Recents'], ['utiles', 'Plus utiles'], ['telecharges', 'Plus telecharges']];

const extension = (nom) => (nom || '').split('.').pop().toLowerCase();
const taille = (octets) => (octets > 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

export default function DocumentsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [moi, setMoi] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [tri, setTri] = useState('');
  const [maFiliere, setMaFiliere] = useState(false);
  const [matiere, setMatiere] = useState('');
  const [matieres, setMatieres] = useState([]);
  const [partage, setPartage] = useState(false);
  const filtres = { q, type, tri, matiere, ...(maFiliere && moi?.filiere ? { filiere: moi.filiere } : {}) };
  const { data: docs, setData, loading, refreshing, refresh, reload } = useApiList(() => api.getDocuments(filtres));

  useEffect(() => {
    api.getMe().then(setMoi).catch(() => {});
    api.getFiltresDocuments().then((f) => setMatieres(f.matiere || [])).catch(() => {});
  }, []);

  // recherche : on attend que l'etudiant arrete de taper
  const minuterie = useRef(null);
  const surRecherche = (t) => {
    setRecherche(t);
    clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setQ(t.trim()), 450);
  };
  const premier = useRef(true);
  useEffect(() => {
    if (premier.current) { premier.current = false; return; }
    reload();
  }, [q, type, tri, maFiliere, matiere]); // eslint-disable-line react-hooks/exhaustive-deps

  const telecharger = async (doc) => {
    try {
      await Linking.openURL(await api.getDocumentUrl(doc.id));
    } catch (e) {
      Alert.alert('Telechargement impossible', e.message);
    }
  };

  const voter = async (doc) => {
    try {
      const r = await api.voterDocument(doc.id);
      setData((liste) => liste.map((d) => (d.id === doc.id ? { ...d, ...r } : d)));
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const puce = (actif, label, onPress, cle) => (
    <TouchableOpacity key={cle || label} style={[styles.filtre, actif && styles.filtreActif]} onPress={onPress}>
      <Text style={[styles.filtreTexte, actif && styles.filtreTexteActif]}>{label}</Text>
    </TouchableOpacity>
  );

  const entete = (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      <View style={styles.recherche}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput style={styles.rechercheChamp} placeholder="Chercher un cours, un sujet, une matiere..." placeholderTextColor={colors.textFaint}
          value={recherche} onChangeText={surRecherche} returnKeyType="search" />
        {recherche ? <TouchableOpacity onPress={() => surRecherche('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textFaint} /></TouchableOpacity> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
        {puce(!type, 'Tout', () => setType(''))}
        {TYPES.map(([cle, label]) => puce(type === cle, label, () => setType(type === cle ? '' : cle), cle))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
        {moi?.filiere ? puce(maFiliere, `🎓 ${moi.filiere}`, () => setMaFiliere(!maFiliere), 'filiere') : null}
        {matieres.map((m) => puce(matiere === m, m, () => setMatiere(matiere === m ? '' : m), `m-${m}`))}
      </ScrollView>
      <View style={styles.tris}>
        {TRIS.map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.tri, tri === cle && styles.triActif]} onPress={() => setTri(cle)}>
            <Text style={[styles.triTexte, tri === cle && { color: colors.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={loading ? [] : docs}
        keyExtractor={(item) => String(item.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={entete}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => telecharger(item)}>
            <View style={styles.iconBox}>
              <Ionicons name={DOC_ICONS[extension(item.fichier)] || 'document'} size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.type}>{LIBELLE_TYPE[item.type_doc] || LIBELLE_TYPE.cours}{item.matiere ? ` · ${item.matiere}` : ''}</Text>
              <Text style={styles.title} numberOfLines={2}>{item.titre}</Text>
              {item.universite || item.filiere ? <Text style={styles.meta} numberOfLines={1}>{[item.universite, item.filiere].filter(Boolean).join(' · ')}</Text> : null}
              <Text style={styles.meta}>{item.prenom} {item.nom} · ⬇️ {item.telechargements}</Text>
            </View>
            <TouchableOpacity style={[styles.vote, item.mon_vote && styles.voteActif]} onPress={() => voter(item)} hitSlop={6}
              accessibilityLabel={item.mon_vote ? 'Retirer mon vote utile' : 'Marquer comme utile'}>
              <Ionicons name={item.mon_vote ? 'thumbs-up' : 'thumbs-up-outline'} size={17} color={item.mon_vote ? colors.white : colors.primary} />
              <Text style={[styles.voteTexte, item.mon_vote && { color: colors.white }]}>{item.nb_votes || 0}</Text>
            </TouchableOpacity>
          </Card>
        )}
        ListEmptyComponent={loading ? <SkeletonList /> : (
          <EmptyState icon="folder-open-outline" title={q || type || matiere || maFiliere ? 'Aucun document trouve' : 'Aucun document'}
            hint="Partage un cours, un TD ou un ancien sujet avec le bouton en bas" />
        )}
      />
      <Fab icon="cloud-upload" onPress={() => setPartage(true)} />
      <PartageDocument visible={partage} moi={moi} onFermer={() => setPartage(false)}
        onPartage={() => { setPartage(false); reload(); api.getFiltresDocuments().then((f) => setMatieres(f.matiere || [])).catch(() => {}); }} />
    </View>
  );
}

// Fenetre de partage : fichier, titre, type, matiere, fac et filiere (pre-remplies avec le profil)
function PartageDocument({ visible, moi, onFermer, onPartage }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const vide = { titre: '', matiere: '', type_doc: 'cours', universite: '', filiere: '' };
  const [fichier, setFichier] = useState(null);
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);
  const maj = (cle) => (v) => setF((x) => ({ ...x, [cle]: v }));

  useEffect(() => {
    if (visible && moi) setF((x) => ({ ...x, universite: x.universite || moi.universite || '', filiere: x.filiere || moi.filiere || '' }));
  }, [visible, moi]);

  const fermer = () => { setFichier(null); setF(vide); onFermer(); };

  const choisir = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: FORMATS, copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.length) return;
    const doc = r.assets[0];
    if (doc.size && doc.size > TAILLE_MAX) {
      Alert.alert('Fichier trop lourd', 'La limite est de 16 Mo.');
      return;
    }
    setFichier(doc);
    if (!f.titre) maj('titre')(doc.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
  };

  const partager = async () => {
    if (!fichier || !f.titre.trim()) {
      Alert.alert('Presque !', 'Choisis un fichier et donne-lui un titre.');
      return;
    }
    setEnvoi(true);
    try {
      await api.uploadDocument({ ...f, titre: f.titre.trim(), matiere: f.matiere.trim(), fichier });
      setFichier(null); setF(vide);
      onPartage();
      Alert.alert('Merci !', 'Ton document est partage avec les autres etudiants.');
    } catch (e) {
      Alert.alert('Envoi impossible', e.message);
    }
    setEnvoi(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={fermer}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
            <Text style={styles.sheetTitre}>Partager un document</Text>
            <TouchableOpacity style={[styles.zoneFichier, fichier && styles.zoneFichierOk]} onPress={choisir} activeOpacity={0.8}>
              <Ionicons name={fichier ? (DOC_ICONS[extension(fichier.name)] || 'document') : 'cloud-upload-outline'} size={30} color={fichier ? colors.accent : colors.primary} />
              <Text style={styles.zoneTexte} numberOfLines={1}>{fichier ? fichier.name : 'Choisir un fichier'}</Text>
              <Text style={styles.zoneAide}>{fichier ? `${taille(fichier.size || 0)} · toucher pour changer` : 'PDF, Word, PowerPoint, TXT, ZIP, images · 16 Mo max'}</Text>
            </TouchableOpacity>
            <View style={styles.filtres}>
              {TYPES.map(([cle, label]) => (
                <TouchableOpacity key={cle} style={[styles.filtre, f.type_doc === cle && styles.filtreActif]} onPress={() => maj('type_doc')(cle)}>
                  <Text style={[styles.filtreTexte, f.type_doc === cle && styles.filtreTexteActif]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.champ} placeholder="Titre (ex. Sujet d'examen algebre 2025)" placeholderTextColor={colors.textFaint} value={f.titre} onChangeText={maj('titre')} maxLength={200} />
            <TextInput style={styles.champ} placeholder="Matiere (ex. Mathematiques)" placeholderTextColor={colors.textFaint} value={f.matiere} onChangeText={maj('matiere')} maxLength={100} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput style={[styles.champ, { flex: 1 }]} placeholder="Universite" placeholderTextColor={colors.textFaint} value={f.universite} onChangeText={maj('universite')} maxLength={100} />
              <TextInput style={[styles.champ, { flex: 1 }]} placeholder="Filiere" placeholderTextColor={colors.textFaint} value={f.filiere} onChangeText={maj('filiere')} maxLength={100} />
            </View>
          </ScrollView>
          <PrimaryButton title="Partager" icon="send" onPress={partager} loading={envoi} />
          <TouchableOpacity style={styles.annuler} onPress={fermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 90 },
  recherche: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border },
  rechercheChamp: { flex: 1, paddingVertical: 11, fontSize: 15, color: colors.text },
  filtres: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filtre: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  tris: { flexDirection: 'row', gap: 6 },
  tri: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.cardAlt },
  triActif: { backgroundColor: colors.text },
  triTexte: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  type: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  vote: { alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary },
  voteActif: { backgroundColor: colors.primary },
  voteTexte: { fontSize: 12, fontWeight: '800', color: colors.primary },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 30, gap: spacing.md, maxHeight: '92%' },
  sheetTitre: { ...font.heading },
  zoneFichier: { alignItems: 'center', gap: 4, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  zoneFichierOk: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  zoneTexte: { fontSize: 15, fontWeight: '700', color: colors.text, maxWidth: '100%' },
  zoneAide: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
