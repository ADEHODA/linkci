// Bandeau discret affiche quand l'app fonctionne sans reseau (donnees en memoire)
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { surEtatReseau } from '../api';

export default function BanniereReseau() {
  const [horsLigne, setHorsLigne] = useState(false);
  const apparition = useRef(new Animated.Value(0)).current;
  const marges = useSafeAreaInsets();

  useEffect(() => surEtatReseau(setHorsLigne), []);
  useEffect(() => {
    Animated.timing(apparition, { toValue: horsLigne ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [horsLigne, apparition]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bandeau, { top: marges.top + 8, opacity: apparition,
        transform: [{ translateY: apparition.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}
    >
      <Ionicons name="cloud-offline" size={15} color="#fff" />
      <Text style={styles.texte}>Hors connexion · dernieres donnees affichees</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(30,30,36,0.92)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, elevation: 6,
  },
  texte: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
