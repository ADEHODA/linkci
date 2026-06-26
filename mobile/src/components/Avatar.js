import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

const COLORS = ['#FF6B35', '#E85D26', '#00A85A', '#FFCC00', '#1A1A2E'];

export default function Avatar({ name, size = 40, index = 0 }) {
  const initials = name
    ? name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: COLORS[index % COLORS.length],
        },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: 'white', fontWeight: '700' },
});
