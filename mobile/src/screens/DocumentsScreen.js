import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';

const DOC_ICONS = {
  pdf: 'document-text',
  doc: 'document-text',
  docx: 'document-text',
  ppt: 'easel',
  pptx: 'easel',
  xls: 'grid',
  xlsx: 'grid',
  zip: 'archive',
  rar: 'archive',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  txt: 'document',
};

export default function DocumentsScreen() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await api.getDocuments();
        setDocs(data);
      } catch (e) { Alert.alert('Erreur', e.message); }
      setLoading(false);
    })();
  }, []));

  const getIcon = (fichier) => {
    const ext = fichier?.split('.').pop()?.toLowerCase();
    return DOC_ICONS[ext] || 'document';
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={docs}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => Linking.openURL(api.API_BASE + '/documents/' + item.id + '/telecharger')}>
            <View style={styles.iconBox}>
              <Ionicons name={getIcon(item.fichier)} size={24} color="#FF6B35" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{item.titre}</Text>
              {item.matiere ? <Text style={styles.meta}>{item.matiere}</Text> : null}
              <View style={styles.row}>
                <Text style={styles.author}>{item.prenom} {item.nom}</Text>
                <Text style={styles.dl}>{item.telechargements} telech.</Text>
              </View>
            </View>
            <Ionicons name="download-outline" size={20} color="#999" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="folder-open-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucun document</Text>
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
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EDEDEA', gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF0E8', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  meta: { fontSize: 12, color: '#FF6B35', fontWeight: '600', marginBottom: 2 },
  row: { flexDirection: 'row', gap: 12 },
  author: { fontSize: 12, color: '#999' },
  dl: { fontSize: 12, color: '#999' },
});
