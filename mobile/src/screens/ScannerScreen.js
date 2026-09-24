// Scanner le QR code d'un camarade : ouvre directement son profil
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PrimaryButton } from '../components/ui';
import { spacing, radius, creerStyles, useTheme } from '../theme';

// QR de profil : https://linkci.onrender.com/profil/<id> (lisible aussi par l'appareil photo classique)
const MOTIF_PROFIL = /^https:\/\/linkci\.onrender\.com\/profil\/(\d+)$/;

export default function ScannerScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [permission, demanderPermission] = useCameraPermissions();
  const [message, setMessage] = useState('');
  const traite = useRef(false);

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centre]}>
        <Ionicons name="camera-outline" size={56} color={colors.textFaint} />
        <Text style={styles.texte}>LinkCI a besoin de l'appareil photo pour scanner le QR code d'un camarade.</Text>
        {permission.canAskAgain
          ? <PrimaryButton title="Autoriser l'appareil photo" icon="camera" onPress={demanderPermission} />
          : <PrimaryButton title="Ouvrir les reglages" icon="settings" onPress={() => Linking.openSettings()} />}
      </View>
    );
  }

  const surCode = ({ data }) => {
    if (traite.current) return;
    const m = MOTIF_PROFIL.exec(String(data || '').trim());
    if (!m) {
      setMessage("Ce QR code n'est pas un profil LinkCI.");
      return;
    }
    traite.current = true;
    navigation.replace('ProfilEtudiant', { id: Number(m[1]) });
  };

  return (
    <View style={styles.container}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={surCode} />
      <View style={styles.cadreZone} pointerEvents="none">
        <View style={styles.cadre} />
        <Text style={styles.consigne}>{message || 'Vise le QR code du profil de ton camarade'}</Text>
      </View>
      <TouchableOpacity style={styles.fermer} onPress={() => navigation.goBack()} hitSlop={10}>
        <Ionicons name="close" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: '#000' },
  centre: { alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.bg },
  texte: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  cadreZone: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  cadre: { width: 240, height: 240, borderRadius: radius.lg, borderWidth: 3, borderColor: '#fff' },
  consigne: { color: '#fff', fontSize: 15, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fermer: { position: 'absolute', top: 48, right: 20 },
}));
