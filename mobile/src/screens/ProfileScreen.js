import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';
import Avatar from '../components/Avatar';

export default function ProfileScreen({ onLogout }) {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      setLoading(true);
      try {
        const me = await api.getMe();
        setUser(me);
        const profile = await api.getProfile(me.id);
        setPosts(profile.posts || []);
      } catch (e) {
        Alert.alert('Erreur', e.message);
      }
      setLoading(false);
    })();
  }, []));

  const handleLogout = () => {
    Alert.alert('Deconnexion', 'Se deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Deconnecter', style: 'destructive', onPress: () => { api.setToken(null); if (onLogout) onLogout(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;
  if (!user) return null;

  return (
    <FlatList
      ref={flatListRef}
      style={styles.container}
      ListHeaderComponent={
        <>
          <View style={styles.header}>
            <Avatar name={`${user.prenom} ${user.nom}`} size={72} index={user.id} />
            <Text style={styles.name}>{user.prenom} {user.nom}</Text>
            {user.universite ? <Text style={styles.uni}>{user.universite}</Text> : null}
            {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
            <Text style={styles.date}>Inscrit depuis {user.date_inscription?.slice(0, 10)}</Text>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={16} color="#DC2626" />
              <Text style={styles.logoutText}>Deconnexion</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}><Text style={styles.statNum}>{posts.length}</Text><Text style={styles.statLabel}>Posts</Text></View>
            <View style={styles.stat}><Text style={styles.statNum}>{user.annee || '-'}</Text><Text style={styles.statLabel}>Annee</Text></View>
          </View>

          <Text style={styles.sectionTitle}>Mes publications</Text>
        </>
      }
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.postCard}>
          <Text style={styles.postContent}>{item.contenu}</Text>
          <View style={styles.postMeta}>
            <Text>❤️ {item.nb_likes}</Text>
            <Text>💬 {item.nb_commentaires}</Text>
            <Text style={styles.postDate}>{item.date_post?.slice(0, 10)}</Text>
          </View>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>Aucune publication</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: '#999', padding: 20 },
  header: { backgroundColor: 'white', alignItems: 'center', padding: 24, borderBottomWidth: 1, borderBottomColor: '#EDEDEA' },
  name: { fontSize: 22, fontWeight: '800', marginTop: 12 },
  uni: { fontSize: 14, color: '#FF6B35', fontWeight: '600', marginTop: 4 },
  bio: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
  date: { fontSize: 12, color: '#999', marginTop: 8 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingVertical: 8, paddingHorizontal: 20, borderRadius: 50, backgroundColor: '#FEF2F2' },
  logoutText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },
  statsRow: { flexDirection: 'row', backgroundColor: 'white', padding: 16, marginTop: 1, borderBottomWidth: 1, borderBottomColor: '#EDEDEA' },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 12, color: '#999', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', padding: 16, paddingBottom: 8 },
  postCard: { backgroundColor: 'white', borderRadius: 12, padding: 14, marginHorizontal: 12, marginBottom: 10 },
  postContent: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  postMeta: { flexDirection: 'row', gap: 16, fontSize: 13, color: '#666' },
  postDate: { color: '#999', marginLeft: 'auto' },
});
