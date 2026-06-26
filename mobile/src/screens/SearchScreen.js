import React, { useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  const handleSearch = (q) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchAll(q.trim());
        setResults(data);
      } catch (e) {}
      setLoading(false);
    }, 400);
  };

  const sections = results ? [
    { title: 'Posts', data: results.posts || [], icon: 'newspaper', empty: 'Aucun post' },
    { title: 'Bourses', data: results.bourses || [], icon: 'cash', empty: 'Aucune bourse' },
    { title: 'Formations', data: results.formations || [], icon: 'school', empty: 'Aucune formation' },
    { title: 'Utilisateurs', data: results.users || [], icon: 'people', empty: 'Aucun utilisateur' },
  ].filter(s => s.data.length > 0) : [];

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#999" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={handleSearch}
          placeholder="Rechercher posts, bourses, formations, personnes..."
          placeholderTextColor="#999"
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults(null); }}>
            <Ionicons name="close-circle" size={20} color="#ccc" />
          </TouchableOpacity>
        )}
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} color="#FF6B35" />}

      {!loading && results && sections.length === 0 && (
        <View style={styles.center}>
          <Ionicons name="search-outline" size={48} color="#ccc" />
          <Text style={styles.empty}>Aucun resultat pour "{query}"</Text>
        </View>
      )}

      {!loading && results && sections.length > 0 && (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.title}
          renderItem={({ item }) => (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name={item.icon} size={16} color="#FF6B35" />
                <Text style={styles.sectionTitle}>{item.title} ({item.data.length})</Text>
              </View>
              {item.data.map((row, i) => (
                <TouchableOpacity key={row.id || i} style={styles.resultItem}>
                  {item.title === 'Utilisateurs' ? (
                    <Avatar name={`${row.prenom} ${row.nom}`} size={36} index={row.id} />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultTitle} numberOfLines={1}>{item.title === 'Posts' ? row.contenu : row.titre || row.nom || `${row.prenom} ${row.nom}`}</Text>
                    {row.organisme ? <Text style={styles.resultSub}>{row.organisme}</Text> : null}
                    {row.universite ? <Text style={styles.resultSub}>{row.universite}</Text> : null}
                    {row.filiere ? <Text style={styles.resultSub}>{row.filiere}</Text> : null}
                    {row.date_post ? <Text style={styles.resultSub}>{row.date_post?.slice(0, 10)}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
      )}

      {!results && !loading && (
        <View style={styles.center}>
          <Ionicons name="search" size={64} color="#eee" />
          <Text style={styles.hint}>Cherche des posts, bourses, formations ou personnes</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  hint: { color: '#ccc', fontSize: 14, marginTop: 12, textAlign: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', margin: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#EDEDEA' },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  section: { marginBottom: 8, backgroundColor: 'white', marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#EDEDEA' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, paddingBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#FF6B35', textTransform: 'uppercase' },
  resultItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: '#EDEDEA', gap: 10 },
  resultTitle: { fontSize: 14, fontWeight: '500' },
  resultSub: { fontSize: 12, color: '#999', marginTop: 1 },
});
