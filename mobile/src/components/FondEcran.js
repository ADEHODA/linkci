// Fond d'ecran des discussions (comme WhatsApp) : couleur ou photo, pour toutes les discussions
// ou une seule. Garde sur le telephone uniquement.
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Alert, ImageBackground } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const CLE = 'linkci_fonds_ecran';
export const COULEURS_FOND = [
  ['sable', '#EFE7DD'], ['menthe', '#DDF3E4'], ['ciel', '#DCEBFA'], ['lavande', '#E9E1F7'], ['peche', '#FDE3D6'],
  ['citron', '#F6F3C9'], ['nuit', '#0B141A'], ['foret', '#10261C'], ['ardoise', '#1E2733'], ['prune', '#2A1B2E'],
];

let memoire = null; // { global, conversations: { [autreId]: fond } }
const abonnes = new Set();

async function lire() {
  if (!memoire) {
    try { memoire = JSON.parse((await AsyncStorage.getItem(CLE)) || 'null'); } catch (e) {}
    memoire = memoire || { global: null, conversations: {} };
  }
  return memoire;
}

async function ecrire(n) {
  memoire = n;
  abonnes.forEach((f) => f(n));
  try { await AsyncStorage.setItem(CLE, JSON.stringify(n)); } catch (e) {
    Alert.alert('Fond d\'ecran', "Impossible d'enregistrer cette image (trop lourde ?). Essaie une autre photo.");
  }
}

// fond : null (par defaut) | { couleur: '#...' } | { photo: 'data:image/jpeg;base64,...' }
export async function changerFond(fond, autreId = null) {
  const m = await lire();
  const n = { ...m, conversations: { ...m.conversations } };
  if (autreId) {
    if (fond === undefined) delete n.conversations[autreId]; // revient au fond general
    else n.conversations[autreId] = fond;
  } else n.global = fond;
  await ecrire(n);
}

export function useFondEcran(autreId) {
  const [m, setM] = useState(memoire);
  useEffect(() => {
    lire().then(setM);
    abonnes.add(setM);
    return () => abonnes.delete(setM);
  }, []);
  if (!m) return { fond: null, propre: false };
  const propre = autreId != null && Object.prototype.hasOwnProperty.call(m.conversations, autreId);
  return { fond: propre ? m.conversations[autreId] : m.global, propre };
}

// Arriere-plan d'une discussion
export function Fond({ fond, style, children }) {
  if (fond?.photo) {
    return <ImageBackground source={{ uri: fond.photo }} style={style} resizeMode="cover">{children}</ImageBackground>;
  }
  return <View style={[style, fond?.couleur ? { backgroundColor: fond.couleur } : null]}>{children}</View>;
}

// Fenetre de choix. autreId : discussion ouverte (propose "cette discussion seulement"), sinon reglage general.
export function ChoixFondEcran({ visible, onFermer, autreId = null, nom = '' }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { fond: fondActuel, propre } = useFondEcran(autreId);
  const [portee, setPortee] = useState('toutes');
  useEffect(() => { if (visible) setPortee(autreId != null && propre ? 'celle-ci' : 'toutes'); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const cible = portee === 'celle-ci' ? autreId : null;

  const appliquer = async (fond) => {
    await changerFond(fond, cible);
    if (portee === 'toutes' && autreId != null && propre) await changerFond(undefined, autreId); // la discussion suit le fond general
    onFermer();
  };

  const photo = async () => {
    try {
      const p = await choisirPhoto('galerie');
      if (p) await appliquer({ photo: `data:image/jpeg;base64,${p.base64}` });
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };

  const actif = (f) => JSON.stringify(f || null) === JSON.stringify(fondActuel || null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fond}>
        <View style={styles.feuille}>
          <Text style={styles.titre}>Fond d'ecran des discussions</Text>
          {autreId != null ? (
            <View style={styles.segment}>
              {[['toutes', 'Toutes les discussions'], ['celle-ci', `Avec ${nom || 'cette personne'}`]].map(([cle, label]) => (
                <TouchableOpacity key={cle} style={[styles.segBtn, portee === cle && styles.segActif]} onPress={() => setPortee(cle)}>
                  <Text style={[styles.segTexte, portee === cle && { color: colors.white }]} numberOfLines={1}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.grille}>
            <TouchableOpacity style={[styles.case, { backgroundColor: colors.bg }, actif(null) && styles.caseActive]} onPress={() => appliquer(null)}>
              <Text style={styles.caseTexte}>Par defaut</Text>
            </TouchableOpacity>
            {COULEURS_FOND.map(([cle, couleur]) => (
              <TouchableOpacity key={cle} style={[styles.case, { backgroundColor: couleur }, actif({ couleur }) && styles.caseActive]}
                onPress={() => appliquer({ couleur })} accessibilityLabel={`Fond ${cle}`} />
            ))}
            <TouchableOpacity style={[styles.case, styles.casePhoto, fondActuel?.photo && styles.caseActive]} onPress={photo}>
              <Ionicons name="image-outline" size={26} color={colors.primary} />
              <Text style={styles.caseTexte}>Ma photo</Text>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity onPress={onFermer} style={{ alignItems: 'center', paddingTop: spacing.md }}>
            <Text style={styles.annuler}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  fond: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  feuille: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 28 },
  titre: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  segment: { flexDirection: 'row', gap: 6, marginBottom: spacing.md },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.cardAlt },
  segActif: { backgroundColor: colors.primary },
  segTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  case: { width: 72, height: 100, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  caseActive: { borderWidth: 3, borderColor: colors.primary },
  casePhoto: { backgroundColor: colors.primarySoft, gap: 4 },
  caseTexte: { fontSize: 11, fontWeight: '700', color: colors.text, textAlign: 'center' },
  annuler: { color: colors.textMuted, fontWeight: '600' },
}));
