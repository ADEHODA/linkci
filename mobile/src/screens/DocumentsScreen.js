import React from 'react';
import { View, Text, FlatList, Linking, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Loading, EmptyState, pullToRefresh } from '../components/ui';
import { colors, radius, spacing } from '../theme';

const DOC_ICONS = {
  pdf: 'document-text', doc: 'document-text', docx: 'document-text',
  ppt: 'easel', pptx: 'easel', xls: 'grid', xlsx: 'grid',
  zip: 'archive', rar: 'archive', png: 'image', jpg: 'image', jpeg: 'image', txt: 'document',
};

export default function DocumentsScreen() {
  const { data: docs, loading, refreshing, refresh } = useApiList(api.getDocuments);

  const telecharger = async (doc) => {
    try {
      await Linking.openURL(await api.getDocumentUrl(doc.id));
    } catch (e) {
      Alert.alert('Telechargement impossible', e.message);
    }
  };

  const getIcon = (fichier) => DOC_ICONS[fichier?.split('.').pop()?.toLowerCase()] || 'document';

  if (loading) return <Loading />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={docs}
      keyExtractor={(item) => String(item.id)}
      refreshControl={pullToRefresh(refreshing, refresh)}
      renderItem={({ item }) => (
        <Card style={styles.card} onPress={() => telecharger(item)}>
          <View style={styles.iconBox}>
            <Ionicons name={getIcon(item.fichier)} size={24} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={2}>{item.titre}</Text>
            {item.matiere ? <Text style={styles.matiere}>{item.matiere}</Text> : null}
            <Text style={styles.meta}>{item.prenom} {item.nom} · {item.telechargements} telech.</Text>
          </View>
          <Ionicons name="download-outline" size={22} color={colors.primary} />
        </Card>
      )}
      ListEmptyComponent={<EmptyState icon="folder-open-outline" title="Aucun document" hint="Les cours et sujets partages apparaitront ici." />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: '#EAF1FF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  matiere: { fontSize: 12, color: '#2563EB', fontWeight: '700', marginTop: 2 },
  meta: { fontSize: 12, color: colors.textFaint, marginTop: 3 },
});
