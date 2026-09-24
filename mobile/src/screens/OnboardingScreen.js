// Ecrans de bienvenue, affiches une seule fois au premier lancement
import React, { useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { radius, spacing, creerStyles, useTheme } from '../theme';

export const CLE_ACCUEIL = 'linkci_accueil_vu';

const PAGES = [
  { icone: 'people', couleur: '#FF6B35', titre: 'Bienvenue sur LinkCI', texte: "Le reseau social des etudiants de Cote d'Ivoire : retrouve ta promo, echange et entraide-toi." },
  { icone: 'cash', couleur: '#009E60', titre: 'Bourses et formations', texte: 'Les bourses du moment, leurs dates limites, et un rappel sur ton telephone pour ne plus en rater.' },
  { icone: 'folder-open', couleur: '#2563EB', titre: 'Cours et documents', texte: "Partage et telecharge les cours, les TD et les sujets d'examen de ta filiere." },
  { icone: 'chatbubbles', couleur: '#7C3AED', titre: 'Discute en direct', texte: 'Messages prives, groupes de promo et notifications en temps reel, meme avec une petite connexion.' },
];

export default function OnboardingScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const liste = useRef(null);
  const derniere = page === PAGES.length - 1;

  const terminer = async (ecran) => {
    await AsyncStorage.setItem(CLE_ACCUEIL, '1').catch(() => {});
    navigation.replace(ecran);
  };

  const suivant = () => {
    if (derniere) terminer('Register');
    else liste.current?.scrollToIndex({ index: page + 1 });
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.passer} onPress={() => terminer('Login')} hitSlop={12}>
        <Text style={styles.passerTexte}>Passer</Text>
      </TouchableOpacity>

      <FlatList
        ref={liste}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.titre}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={[styles.page, { width }]}>
            <View style={[styles.halo, { backgroundColor: item.couleur + '1F' }]}>
              <View style={[styles.rond, { backgroundColor: item.couleur }]}>
                <Ionicons name={item.icone} size={56} color="#fff" />
              </View>
            </View>
            <Text style={styles.titre}>{item.titre}</Text>
            <Text style={styles.texte}>{item.texte}</Text>
          </View>
        )}
      />

      <View style={styles.bas}>
        <View style={styles.points}>
          {PAGES.map((p, i) => <View key={p.titre} style={[styles.point, i === page && [styles.pointActif, { backgroundColor: PAGES[page].couleur }]]} />)}
        </View>
        <TouchableOpacity style={[styles.bouton, { backgroundColor: PAGES[page].couleur }]} onPress={suivant} activeOpacity={0.85}>
          <Text style={styles.boutonTexte}>{derniere ? 'Creer mon compte' : 'Suivant'}</Text>
          <Ionicons name={derniere ? 'rocket' : 'arrow-forward'} size={18} color="#fff" />
        </TouchableOpacity>
        {derniere ? (
          <TouchableOpacity onPress={() => terminer('Login')} style={styles.lien}>
            <Text style={styles.lienTexte}>J'ai deja un compte</Text>
          </TouchableOpacity>
        ) : <View style={styles.lien} />}
      </View>
    </View>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  passer: { position: 'absolute', top: 54, right: 24, zIndex: 2 },
  passerTexte: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingTop: 40 },
  halo: { width: 200, height: 200, borderRadius: 100, alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
  rond: { width: 124, height: 124, borderRadius: 62, alignItems: 'center', justifyContent: 'center' },
  titre: { ...font.title, fontSize: 26, textAlign: 'center' },
  texte: { fontSize: 16, lineHeight: 24, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  bas: { paddingHorizontal: spacing.xl, paddingBottom: 40, gap: spacing.lg },
  points: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  point: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  pointActif: { width: 24 },
  bouton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: radius.pill },
  boutonTexte: { color: '#fff', fontWeight: '800', fontSize: 16 },
  lien: { alignItems: 'center', minHeight: 20 },
  lienTexte: { color: colors.primary, fontWeight: '700' },
}));
