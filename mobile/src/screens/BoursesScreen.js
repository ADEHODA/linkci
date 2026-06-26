import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';

export default function BoursesScreen() {
  const [bourses, setBourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await api.getBourses();
        setBourses(data);
      } catch (e) {
        Alert.alert('Erreur', e.message);
      }
      setLoading(false);
    })();
  }, []));

  const renderBourse = ({ item }) => {
    const expiree = item.expiree === 1;
    const daysLeft = item.deadline ? Math.ceil((new Date(item.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;

    return (
      <TouchableOpacity
        style={[styles.card, expiree && styles.expired]}
        onPress={() => item.lien && Linking.openURL(item.lien)}
        activeOpacity={0.7}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{item.titre}</Text>
          {expiree ? (
            <View style={styles.badgeExpired}><Text style={styles.badgeText}>EXPIREE</Text></View>
          ) : daysLeft !== null && daysLeft <= 30 ? (
            <View style={styles.badgeUrgent}><Text style={styles.badgeText}>J-{daysLeft}</Text></View>
          ) : null}
        </View>
        <Text style={styles.org}>{item.organisme}</Text>
        {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
        <View style={styles.meta}>
          {item.montant ? <Text style={styles.metaText}>{item.montant}</Text> : null}
          {item.deadline ? <Text style={styles.metaText}>Limite: {item.deadline}</Text> : null}
          {item.type ? <View style={styles.typeBadge}><Text style={styles.typeText}>{item.type}</Text></View> : null}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={bourses}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderBourse}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="cash-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucune bourse disponible</Text>
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
  expired: { opacity: 0.6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  org: { fontSize: 13, color: '#666', marginBottom: 6 },
  desc: { fontSize: 13, color: '#333', marginBottom: 8, lineHeight: 18 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderTopColor: '#EDEDEA', paddingTop: 8 },
  metaText: { fontSize: 12, color: '#999' },
  badgeExpired: { backgroundColor: '#FEF2F2', borderRadius: 50, paddingHorizontal: 8, paddingVertical: 2 },
  badgeUrgent: { backgroundColor: '#FFF0E8', borderRadius: 50, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  typeBadge: { backgroundColor: '#FFF0E8', borderRadius: 50, paddingHorizontal: 8, paddingVertical: 2 },
  typeText: { fontSize: 11, fontWeight: '600', color: '#FF6B35' },
});
