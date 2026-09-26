// Fichier dans une discussion (PDF, Word...) : icone, nom, taille ; toucher pour l'ouvrir / le telecharger
import React from 'react';
import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as api from '../api';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const ICONES = { pdf: 'document-text', doc: 'document-text', docx: 'document-text', ppt: 'easel', pptx: 'easel', zip: 'archive', rar: 'archive', txt: 'document' };
export const FORMATS_FICHIER = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'application/zip', 'application/x-rar-compressed', 'application/vnd.rar'];
const TAILLE_MAX = 10 * 1024 * 1024; // limite du serveur

export const taille = (o) => (!o ? '' : o > 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

// Ouvre le selecteur de fichiers ; renvoie { uri, name, mimeType, size } ou null
export async function choisirFichier() {
  const r = await DocumentPicker.getDocumentAsync({ type: FORMATS_FICHIER, copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.length) return null;
  const f = r.assets[0];
  if (f.size && f.size > TAILLE_MAX) {
    Alert.alert('Fichier trop lourd', 'La limite est de 10 Mo par fichier.');
    return null;
  }
  return f;
}

export default function BulleFichier({ message, clair }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const nom = message.fichier_nom || message.fichierLocal?.name || 'Fichier';
  const ext = nom.split('.').pop().toLowerCase();
  const couleur = clair ? colors.white : colors.primary;
  const ouvrir = () => {
    if (!message.fichier) return; // encore en cours d'envoi
    Linking.openURL(`${api.API_BASE}/f/${message.fichier}?n=${encodeURIComponent(nom)}`).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir le fichier"));
  };
  return (
    <TouchableOpacity style={[styles.fichier, clair && styles.fichierClair]} onPress={ouvrir} activeOpacity={0.8}
      accessibilityLabel={`Fichier ${nom}, toucher pour l'ouvrir`}>
      <View style={[styles.icone, clair && { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
        <Ionicons name={ICONES[ext] || 'document-attach'} size={24} color={couleur} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.nom, clair && { color: colors.white }]} numberOfLines={2}>{nom}</Text>
        <Text style={[styles.meta, clair && { color: 'rgba(255,255,255,0.8)' }]}>{ext.toUpperCase()} · {taille(message.fichier_taille || message.fichierLocal?.size)}</Text>
      </View>
      {message.fichier ? <Ionicons name="download-outline" size={20} color={couleur} /> : null}
    </TouchableOpacity>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  fichier: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.sm, minWidth: 210, marginBottom: 4 },
  fichierClair: { backgroundColor: 'rgba(255,255,255,0.15)' },
  icone: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  nom: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
}));
