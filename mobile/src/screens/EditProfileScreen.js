import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { PrimaryButton } from '../components/ui';
import { choisirPhoto } from '../photos';
import { colors, radius, spacing } from '../theme';

// Recoit l'utilisateur courant en parametre de navigation : navigate('ModifierProfil', { user })
export default function EditProfileScreen({ route, navigation }) {
  const user = route.params.user;
  const [form, setForm] = useState({
    prenom: user.prenom || '', nom: user.nom || '', universite: user.universite || '',
    filiere: user.filiere || '', annee: user.annee || '', bio: user.bio || '',
  });
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (champ) => (valeur) => setForm((f) => ({ ...f, [champ]: valeur }));

  const changerPhoto = () => {
    Alert.alert('Photo de profil', null, [
      { text: 'Choisir dans la galerie', onPress: () => prendre('galerie') },
      { text: 'Prendre une photo', onPress: () => prendre('camera') },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const prendre = async (source) => {
    try {
      const p = await choisirPhoto(source, { carre: true });
      if (p) setPhoto(p);
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };

  const enregistrer = async () => {
    if (!form.prenom.trim() || !form.nom.trim()) {
      Alert.alert('Erreur', 'Prenom et nom requis');
      return;
    }
    setSaving(true);
    try {
      await api.updateProfile({ ...form, ...(photo && { avatar: photo.base64 }) });
      navigation.goBack(); // le profil se recharge en revenant
    } catch (e) {
      Alert.alert('Erreur', e.message);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.avatarBox} onPress={changerPhoto} activeOpacity={0.8}>
          <View>
            <Avatar name={`${form.prenom} ${form.nom}`} size={104} index={user.id} avatar={user.avatar} uri={photo?.uri} />
            <View style={styles.cameraBadge}><Ionicons name="camera" size={16} color={colors.white} /></View>
          </View>
          <Text style={styles.changer}>Changer la photo</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <Champ label="Prenom" value={form.prenom} onChangeText={set('prenom')} style={{ flex: 1 }} />
          <Champ label="Nom" value={form.nom} onChangeText={set('nom')} style={{ flex: 1 }} />
        </View>
        <Champ label="Universite" value={form.universite} onChangeText={set('universite')} placeholder="ex. UFHB, UPB, INP-HB..." />
        <View style={styles.row}>
          <Champ label="Filiere" value={form.filiere} onChangeText={set('filiere')} placeholder="ex. MIAGE" style={{ flex: 2 }} />
          <Champ label="Annee" value={form.annee} onChangeText={set('annee')} placeholder="ex. L1" style={{ flex: 1 }} />
        </View>
        <Champ label="Bio" value={form.bio} onChangeText={set('bio')} placeholder="Parle un peu de toi..." multiline maxLength={500} inputStyle={{ minHeight: 90 }} />
        <Text style={styles.compteur}>{form.bio.length}/500</Text>

        <PrimaryButton title="Enregistrer" icon="checkmark" onPress={enregistrer} loading={saving} style={{ marginTop: spacing.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Champ({ label, style, inputStyle, ...props }) {
  return (
    <View style={[styles.champ, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, inputStyle]} placeholderTextColor={colors.textFaint} textAlignVertical="top" {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 40 },
  avatarBox: { alignItems: 'center', marginBottom: spacing.xl },
  cameraBadge: { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg },
  changer: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  champ: { marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginLeft: 4 },
  input: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text },
  compteur: { fontSize: 11, color: colors.textFaint, textAlign: 'right', marginTop: -6 },
});
