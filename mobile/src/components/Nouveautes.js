// Fenetre "Quoi de neuf ?" : affichee une fois apres une mise a jour qui apporte des nouveautes
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrimaryButton } from './ui';
import { radius, spacing, creerStyles } from '../theme';

// Changer ID a chaque nouvelle serie de nouveautes a annoncer
const ID = '2026-09-26';
const CLE = 'linkci_nouveautes_vues';
const LISTE = [
  ['⏰', 'Emploi du temps', 'Tes cours et tes examens, avec un rappel 15 min avant chaque cours (Explorer > Emploi du temps).'],
  ['🎟️', 'Invite tes camarades', 'Ton lien personnel dans ton profil : 3 camarades inscrits = badge Ambassadeur.'],
  ['🧑‍🎓', 'Profil enrichi', 'Photo de couverture, competences, parcours, liens LinkedIn et GitHub, et qui a vu ton profil.'],
  ['📶', 'Hors connexion', "L'app s'ouvre instantanement, et tes messages ecrits sans reseau partent tout seuls au retour."],
  ['📤', 'Partager', 'Envoie une bourse, une offre, une annonce ou une question a tes amis sur WhatsApp.'],
];

export default function Nouveautes() {
  const styles = useStyles();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CLE).then((vu) => { if (vu !== ID) setVisible(true); }).catch(() => {});
  }, []);

  const fermer = () => {
    setVisible(false);
    AsyncStorage.setItem(CLE, ID).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={fermer}>
      <View style={styles.fond}>
        <View style={styles.fenetre}>
          <Text style={styles.titre}>Quoi de neuf sur LinkCI ✨</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {LISTE.map(([icone, titre, texte]) => (
              <View key={titre} style={styles.ligne}>
                <Text style={styles.icone}>{icone}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneTitre}>{titre}</Text>
                  <Text style={styles.ligneTexte}>{texte}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <PrimaryButton title="C'est parti !" onPress={fermer} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  fond: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  fenetre: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, width: '100%', gap: spacing.md },
  titre: { ...font.heading, textAlign: 'center' },
  ligne: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  icone: { fontSize: 26 },
  ligneTitre: { fontSize: 15, fontWeight: '800', color: colors.text },
  ligneTexte: { fontSize: 13, lineHeight: 19, color: colors.textMuted, marginTop: 2 },
}));
