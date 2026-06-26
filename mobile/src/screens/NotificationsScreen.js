import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as api from '../api';

export default function NotificationsScreen() {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const data = await api.getNotifications();
        setNotifs(data.notifications || []);
      } catch (e) {}
      setLoading(false);
    })();
  }, []));

  const icons = { bourse: 'cash', formation: 'school', message: 'chatbubble', like: 'heart', commentaire: 'chatbox' };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#FF6B35" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={notifs}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={[styles.item, !item.lu && styles.unread]}>
            <View style={styles.iconContainer}>
              <Ionicons name={icons[item.type] || 'notifications'} size={22} color="#FF6B35" />
            </View>
            <View style={styles.content}>
              <Text style={[styles.message, !item.lu && { fontWeight: '600' }]}>{item.message}</Text>
              <Text style={styles.time}>{item.date_notification?.slice(0, 16)}</Text>
            </View>
            {!item.lu && <View style={styles.dot} />}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="notifications-outline" size={48} color="#ccc" />
            <Text style={styles.empty}>Aucune notification</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F7F4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: '#999', fontSize: 14, marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderBottomWidth: 1, borderBottomColor: '#EDEDEA', backgroundColor: 'white', gap: 10 },
  unread: { backgroundColor: '#FFF0E8' },
  iconContainer: { marginTop: 2 },
  content: { flex: 1 },
  message: { fontSize: 14, lineHeight: 19 },
  time: { fontSize: 12, color: '#999', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF6B35', marginTop: 6 },
});
