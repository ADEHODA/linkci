// Photo d'une publication : garde ses proportions, s'ouvre en plein ecran au toucher
import React, { useState } from 'react';
import { View, Image, Modal, TouchableOpacity, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, creerStyles, useTheme } from '../theme';

export default function PostImage({ uri, style }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(false);
  const [pleinEcran, setPleinEcran] = useState(false);

  if (erreur) return null; // image introuvable : on n'affiche pas un cadre vide

  return (
    <>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setPleinEcran(true)} style={[styles.frame, style]}>
        <Image
          source={{ uri }}
          style={[styles.image, { aspectRatio: Math.max(ratio, 0.8) }]}
          resizeMode="cover"
          onLoad={(e) => {
            const { width, height } = e.nativeEvent.source;
            if (width && height) setRatio(width / height);
            setChargement(false);
          }}
          onError={() => setErreur(true)}
        />
        {chargement && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />}
      </TouchableOpacity>

      <Modal visible={pleinEcran} transparent animationType="fade" onRequestClose={() => setPleinEcran(false)}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.viewer}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" />
          <TouchableOpacity style={styles.close} onPress={() => setPleinEcran(false)} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  frame: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
  image: { width: '100%' },
  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 44, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
}));
