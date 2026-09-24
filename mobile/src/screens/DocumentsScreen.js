import React, { useMemo, useState } from 'react';
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

const extension = (nom) => (nom || '').split('.').pop().toLowerCase();
const taille = (octets) => (octets > 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(octets / 1024)} Ko`);

export default function DocumentsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: docs, loading, refreshing, refresh, reload } = useApiList(api.getDocuments);
  const [matiere, setMatiere] = useState('Toutes');
  const [partage, setPartage] = useState(false);

  const matieres = useMemo(() => ['Toutes', ...new Set(docs.map((d) => d.matiere).filter(Boolean))], [docs]);
  const visibles = matiere === 'Toutes' ? docs : docs.filter((d) => d.matiere === matiere);

  const telecharger = async (doc) => {
    try {
      await Linking.openURL(await api.getDocumentUrl(doc.id));
    } catch (e) {
      Alert.alert('Telechargement impossible', e.message);
    }
  };

  if (loading) return <SkeletonList />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visibles}
        keyExtractor={(item) => String(item.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={matieres.length > 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
            {matieres.map((m) => (
              <TouchableOpacity key={m} style={[styles.filtre, matiere === m && styles.filtreActif]} onPress={() => setMatiere(m)}>
                <Text style={[styles.filtreTexte, matiere === m && styles.filtreTexteActif]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => telecharger(item)}>
            <View style={styles.iconBox}>
              <Ionicons name={DOC_ICONS[extension(item.fichier)] || 'document'} size={24} color="#2563EB" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{item.titre}</Text>
              {item.matiere ? <Text style={styles.matiere}>{item.matiere}</Text> : null}
              <Text style={styles.meta}>{item.prenom} {item.nom} · {item.telechargements} telech.</Text>
            </View>
            <Ionicons name="download-outline" size={22} color={colors.primary} />
          </Card>
        )}
        ListEmptyComponent={<EmptyState icon="folder-open-outline" title="Aucun document" hint="Partage un cours ou un sujet d'examen avec +" />}
      />
      <Fab icon="cloud-upload" onPress={() => setPartage(true)} />
      <PartageDocument visible={partage} onFermer={() => setPartage(false)} onPartage={() => { setPartage(false); reload(); }} />
    </View>
  );
}

// Fenetre de partage : choisir un fichier sur le telephone, lui donner un titre et une matiere
function PartageDocument({ visible, onFermer, onPartage }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [fichier, setFichier] = useState(null);
  const [titre, setTitre] = useState('');
  const [matiere, setMatiere] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const fermer = () => { setFichier(null); setTitre(''); setMatiere(''); onFermer(); };

  const choisir = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: FORMATS, copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.length) return;
    const f = r.assets[0];
    if (f.size && f.size > TAILLE_MAX) {
      Alert.alert('Fichier trop lourd', 'La limite est de 16 Mo.');
      return;
    }
    setFichier(f);
    if (!titre) setTitre(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
  };

  const partager = async () => {
    if (!fichier || !titre.trim()) {
      Alert.alert('Presque !', 'Choisis un fichier et donne-lui un titre.');
      return;
    }
    setEnvoi(true);
    try {
      await api.uploadDocument({ titre: titre.trim(), matiere: matiere.trim(), fichier });
      setFichier(null); setTitre(''); setMatiere('');
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
          <Text style={styles.sheetTitre}>Partager un document</Text>
          <TouchableOpacity style={[styles.zoneFichier, fichier && styles.zoneFichierOk]} onPress={choisir} activeOpacity={0.8}>
            <Ionicons name={fichier ? (DOC_ICONS[extension(fichier.name)] || 'document') : 'cloud-upload-outline'} size={30} color={fichier ? colors.accent : colors.primary} />
            <Text style={styles.zoneTexte} numberOfLines={1}>{fichier ? fichier.name : 'Choisir un fichier'}</Text>
            <Text style={styles.zoneAide}>{fichier ? `${taille(fichier.size || 0)} · toucher pour changer` : 'PDF, Word, PowerPoint, TXT, ZIP, images · 16 Mo max'}</Text>
          </TouchableOpacity>
          <TextInput style={styles.champ} placeholder="Titre (ex. Cours d'algebre - chapitre 2)" placeholderTextColor={colors.textFaint} value={titre} onChangeText={setTitre} maxLength={200} />
          <TextInput style={styles.champ} placeholder="Matiere (ex. Mathematiques)" placeholderTextColor={colors.textFaint} value={matiere} onChangeText={setMatiere} maxLength={100} />
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
  filtres: { gap: spacing.sm, paddingBottom: spacing.md },
  filtre: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: '#2563EB22', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  matiere: { fontSize: 12, color: '#2563EB', fontWeight: '700', marginTop: 2 },
  meta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  sheetTitre: { ...font.heading },
  zoneFichier: { alignItems: 'center', gap: 4, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  zoneFichierOk: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  zoneTexte: { fontSize: 15, fontWeight: '700', color: colors.text, maxWidth: '100%' },
  zoneAide: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
