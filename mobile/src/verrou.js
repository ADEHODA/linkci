// Verrouillage de l'app par empreinte / visage (ou code du telephone en secours)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, AppState, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { spacing, radius, creerStyles, useTheme } from './theme';

const CLE = 'linkci_verrou_biometrique';
const DELAI_ARRIERE_PLAN = 30 * 1000; // reverrouille apres 30 s hors de l'app

export async function verrouActif() {
  try {
    return (await AsyncStorage.getItem(CLE)) === '1';
  } catch (e) {
    return false;
  }
}

// Renvoie null si c'est fait, sinon un message d'explication
export async function changerVerrou(activer) {
  if (activer) {
    const materiel = await LocalAuthentication.hasHardwareAsync();
    const enregistre = await LocalAuthentication.isEnrolledAsync();
    if (!materiel || !enregistre) return "Ajoute d'abord une empreinte ou un visage dans les reglages de ton telephone.";
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirme pour activer le verrouillage' });
    if (!r.success) return 'Verification annulee.';
  }
  await AsyncStorage.setItem(CLE, activer ? '1' : '0').catch(() => {});
  return null;
}

// ---- Code sur les discussions : l'onglet Messages demande l'empreinte
const CLE_MESSAGES = 'linkci_verrou_messages';
let messagesDeverrouilles = false; // jusqu'a la prochaine sortie de l'app
AppState.addEventListener('change', (etat) => { if (etat === 'background') messagesDeverrouilles = false; });

export async function verrouMessagesActif() {
  try {
    return (await AsyncStorage.getItem(CLE_MESSAGES)) === '1';
  } catch (e) {
    return false;
  }
}

export async function changerVerrouMessages(activer) {
  if (activer) {
    const materiel = await LocalAuthentication.hasHardwareAsync();
    const enregistre = await LocalAuthentication.isEnrolledAsync();
    if (!materiel || !enregistre) return "Ajoute d'abord une empreinte ou un visage dans les reglages de ton telephone.";
  }
  await AsyncStorage.setItem(CLE_MESSAGES, activer ? '1' : '0').catch(() => {});
  messagesDeverrouilles = activer; // pas de nouvelle demande juste apres l'activation
  return null;
}

// Renvoie true si les discussions peuvent s'afficher (deverrouillees ou verrou inactif)
export async function ouvrirMessages() {
  if (messagesDeverrouilles || !(await verrouMessagesActif())) return true;
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Ouvrir tes discussions', cancelLabel: 'Annuler' });
    messagesDeverrouilles = r.success;
    return r.success;
  } catch (e) {
    return false;
  }
}

// Ecran de verrouillage affiche par-dessus l'app tant que l'etudiant n'est pas reconnu
export function Verrou({ actif, children }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [verrouille, setVerrouille] = useState(false);
  const sortie = useRef(0);

  const deverrouiller = async () => {
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Deverrouiller LinkCI', cancelLabel: 'Annuler' });
      if (r.success) setVerrouille(false);
    } catch (e) {}
  };

  useEffect(() => {
    if (!actif) { setVerrouille(false); return undefined; }
    let annule = false;
    verrouActif().then((oui) => {
      if (oui && !annule) { setVerrouille(true); deverrouiller(); }
    });
    const abonnement = AppState.addEventListener('change', async (etat) => {
      if (etat === 'background') sortie.current = Date.now();
      if (etat === 'active' && sortie.current && Date.now() - sortie.current > DELAI_ARRIERE_PLAN && (await verrouActif())) {
        setVerrouille(true);
        deverrouiller();
      }
    });
    return () => { annule = true; abonnement.remove(); };
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1 }}>
      {children}
      {verrouille ? (
        <View style={styles.ecran}>
          <Image source={require('../assets/icon.png')} style={styles.logo} />
          <Text style={styles.titre}>LinkCI est verrouille</Text>
          <TouchableOpacity style={styles.bouton} onPress={deverrouiller} activeOpacity={0.85}>
            <Ionicons name="finger-print" size={22} color={colors.white} />
            <Text style={styles.boutonTexte}>Deverrouiller</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  ecran: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, zIndex: 100 },
  logo: { width: 96, height: 96, borderRadius: 24 },
  titre: { ...font.title, fontSize: 20 },
  bouton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: radius.pill },
  boutonTexte: { color: colors.white, fontWeight: '800', fontSize: 16 },
}));
