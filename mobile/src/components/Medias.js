// Photos partagees dans une discussion ou un groupe (grille ; toucher une photo pour l'agrandir)
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, FlatList, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import PostImage from './PostImage';
import { Loading } from './ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';

// charger : () => Promise<[{ id, image }]>
export default function Medias({ visible, titre, charger, onFermer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [medias, setMedias] = useState(null);
  const cote = Math.floor((width - spacing.md * 2 - 8) / 3);

  useEffect(() => {
    if (!visible) return;
    setMedias(null);
    charger().then(setMedias).catch(() => setMedias([]));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer}>
      <View style={styles.container}>
        <View style={styles.entete}>
          <TouchableOpacity onPress={onFermer} hitSlop={10}><Ionicons name="chevron-back" size={26} color={colors.primary} /></TouchableOpacity>
          <Text style={styles.titre} numberOfLines={1}>{titre}</Text>
        </View>
        {!medias ? <Loading /> : (
          <FlatList
            data={medias}
            numColumns={3}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: spacing.md, gap: 4 }}
            columnWrapperStyle={{ gap: 4 }}
            renderItem={({ item }) => (
              <PostImage uri={api.imageUrl(item.image)} style={{ width: cote, height: cote, borderRadius: radius.sm }} carre />
            )}
            ListEmptyComponent={<Text style={styles.vide}>Aucune photo partagee pour l'instant.</Text>}
          />
        )}
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  entete: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingTop: 44, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  titre: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  vide: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
}));
