// Photo d'une publication : garde ses proportions, s'ouvre en plein ecran au toucher
import React, { useState } from 'react';
import { View, Text, Image, Modal, TouchableOpacity, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
import { useEconomie } from '../donnees';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, creerStyles, useTheme } from '../theme';

export default function PostImage({ uri, mini, style, carre = false }) {
  const economie = useEconomie();
  const [demandee, setDemandee] = useState(false);
  const styles = useStyles();
  const { colors } = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(false);
  const [pleinEcran, setPleinEcran] = useState(false);

  if (erreur) return null; // image introuvable : on n'affiche pas un cadre vide
  if (economie && !demandee && /^https?:/.test(uri)) {
    return (
      <TouchableOpacity style={[styles.frame, style, styles.aDemande, carre && { aspectRatio: 1 }]} onPress={() => setDemandee(true)} activeOpacity={0.8}
        accessibilityLabel="Afficher la photo">
        <Ionicons name="image-outline" size={26} color={colors.textMuted} />
        <Text style={styles.aDemandeTexte}>Toucher pour afficher la photo</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setPleinEcran(true)} style={[styles.frame, style]}>
        <Image
          source={{ uri: mini || uri }}
          style={[styles.image, { aspectRatio: carre ? 1 : Math.max(ratio, 0.8) }]}
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
  aDemande: { alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 28, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  aDemandeTexte: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  image: { width: '100%' },
  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 44, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
}));
