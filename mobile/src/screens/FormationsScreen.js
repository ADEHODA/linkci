import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';

export default function FormationsScreen() {
  const [formations, setFormations] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await api.getFormations();
        setFormations(data);
      } catch (e) {
        Alert.alert('Erreur', e.message);
      }
      setLoading(false);
    })();
  }, []));

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => item.site_web && Linking.openURL(item.site_web)}
      activeOpacity={0.7}
    >
      <View style={styles.badgeRow}>
        <View style={styles.niveauBadge}><Text style={styles.niveauText}>{item.niveau}</Text></View>
      </View>
      <Text style={styles.nom}>{item.nom}</Text>
      <Text style={styles.uni}>{item.universite}</Text>
      {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
      <View style={styles.meta}>
        {item.duree ? <Text style={styles.metaText}>Duree: {item.duree}</Text> : null}
        {item.frais ? <Text style={styles.metaText}>Frais: {item.frais}</Text> : null}
      </View>
    </TouchableOpacity>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={formations}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="school-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucune formation</Text>
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
  card: { backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#EDEDEA' },
  badgeRow: { flexDirection: 'row', marginBottom: 6 },
  niveauBadge: { backgroundColor: '#FFF0E8', borderRadius: 50, paddingHorizontal: 8, paddingVertical: 2 },
  niveauText: { fontSize: 11, fontWeight: '600', color: '#FF6B35' },
  nom: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  uni: { fontSize: 13, color: '#666', marginBottom: 6 },
  desc: { fontSize: 13, color: '#333', marginBottom: 8, lineHeight: 18 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: 1, borderTopColor: '#EDEDEA', paddingTop: 8 },
  metaText: { fontSize: 12, color: '#999' },
});
