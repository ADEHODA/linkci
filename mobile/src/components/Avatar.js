import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { API_BASE } from '../api';

// Memes couleurs que les avatars du site web
const COLORS = ['#FF6B35', '#7C3AED', '#009E60', '#DC2626', '#2563EB', '#D97706', '#DB2777', '#0891B2', '#65A30D', '#9333EA'];

// avatar : nom du fichier renvoye par l'API (users.avatar) ; sinon, initiales en couleur
// uri : image locale (apercu avant envoi)
export default function Avatar({ name, size = 40, index = 0, avatar, uri }) {
  const [erreur, setErreur] = useState(false);
  const source = uri || (avatar && avatar !== 'default.png' ? `${API_BASE}/static/avatars/${avatar}` : null);
  const rond = { width: size, height: size, borderRadius: size / 2 };

  if (source && !erreur) {
    return <Image source={{ uri: source }} style={[rond, styles.image]} onError={() => setErreur(true)} />;
  }

  const initials = name
    ? name.split(' ').filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  return (
    <View style={[styles.circle, rond, { backgroundColor: COLORS[Math.abs(index || 0) % COLORS.length] }]}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  image: { backgroundColor: '#E9E9EE' },
  text: { color: 'white', fontWeight: '700' },
});
