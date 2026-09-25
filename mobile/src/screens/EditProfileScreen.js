import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { PrimaryButton } from '../components/ui';
import { choisirPhoto } from '../photos';
import { colors, radius, spacing, creerStyles, useTheme } from '../theme';

// Recoit l'utilisateur courant en parametre de navigation : navigate('ModifierProfil', { user })
export default function EditProfileScreen({ route, navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const user = route.params.user;
  const [form, setForm] = useState({
    prenom: user.prenom || '', nom: user.nom || '', universite: user.universite || '',
    filiere: user.filiere || '', annee: user.annee || '', bio: user.bio || '',
  });
  const [photo, setPhoto] = useState(null);
  const [couverture, setCouverture] = useState(null); // nouvelle photo, ou '' pour la retirer
  const [competences, setCompetences] = useState(user.competences || []);
  const [nouvelle, setNouvelle] = useState('');
  const [parcours, setParcours] = useState(user.parcours || []);
  const [liens, setLiens] = useState({ lien_linkedin: user.lien_linkedin || '', lien_github: user.lien_github || '', lien_site: user.lien_site || '' });

  const ajouterCompetence = () => {
    const c = nouvelle.trim();
    if (c && !competences.includes(c) && competences.length < 15) setCompetences([...competences, c]);
    setNouvelle('');
  };
  const changerEtape = (k, champ, v) => setParcours(parcours.map((e, j) => (j === k ? { ...e, [champ]: v } : e)));
  const choisirCouverture = async () => {
    try {
      const c = await choisirPhoto('galerie');
      if (c) setCouverture(c);
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'ouvrir la photo");
    }
  };
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
      await api.updateProfile({
        ...form, ...(photo && { avatar: photo.base64 }), competences, parcours: parcours.filter((e) => (e.titre || '').trim()), ...liens,
        ...(couverture ? { couverture: couverture.base64 } : couverture === '' ? { couverture: '' } : {}),
      });
      navigation.goBack(); // le profil se recharge en revenant
    } catch (e) {
      Alert.alert('Erreur', e.message);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.couverture} onPress={choisirCouverture} activeOpacity={0.85}>
          {couverture?.uri || (couverture !== '' && user.couverture)
            ? <Image source={{ uri: couverture?.uri || api.imageUrl(user.couverture) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : null}
          <View style={styles.couvertureBouton}><Ionicons name="image-outline" size={16} color={colors.white} /><Text style={styles.couvertureTexte}>Photo de couverture</Text></View>
        </TouchableOpacity>
        {couverture?.uri || (couverture !== '' && user.couverture)
          ? <Text style={styles.retirer} onPress={() => setCouverture('')}>Retirer la couverture</Text> : null}

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

        <Text style={styles.section}>Competences ({competences.length}/15)</Text>
        <View style={styles.puces}>
          {competences.map((c) => (
            <TouchableOpacity key={c} style={styles.puce} onPress={() => setCompetences(competences.filter((x) => x !== c))}>
              <Text style={styles.puceTexte}>{c}</Text><Ionicons name="close" size={14} color={colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} value={nouvelle} onChangeText={setNouvelle} placeholder="ex. Python, Excel, Prise de parole"
            placeholderTextColor={colors.textFaint} maxLength={30} onSubmitEditing={ajouterCompetence} returnKeyType="done" />
          <TouchableOpacity style={styles.ajouter} onPress={ajouterCompetence}><Ionicons name="add" size={22} color={colors.white} /></TouchableOpacity>
        </View>

        <Text style={styles.section}>Parcours (etudes, stages, experiences)</Text>
        {parcours.map((e, k) => (
          <View key={k} style={styles.etape}>
            <TextInput style={styles.input} value={e.titre} onChangeText={(v) => changerEtape(k, 'titre', v)} placeholder="Titre (ex. Licence Informatique, Stage chez Orange)" placeholderTextColor={colors.textFaint} maxLength={80} />
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 2 }]} value={e.lieu} onChangeText={(v) => changerEtape(k, 'lieu', v)} placeholder="Lieu (ex. UFHB)" placeholderTextColor={colors.textFaint} maxLength={80} />
              <TextInput style={[styles.input, { flex: 1 }]} value={e.periode} onChangeText={(v) => changerEtape(k, 'periode', v)} placeholder="2023-2026" placeholderTextColor={colors.textFaint} maxLength={40} />
            </View>
            <Text style={styles.retirer} onPress={() => setParcours(parcours.filter((_, j) => j !== k))}>Retirer</Text>
          </View>
        ))}
        {parcours.length < 10 ? (
          <TouchableOpacity style={styles.ajouterLigne} onPress={() => setParcours([...parcours, { titre: '', lieu: '', periode: '' }])}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} /><Text style={styles.ajouterTexte}>Ajouter une etape</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.section}>Liens</Text>
        <Champ label="LinkedIn" value={liens.lien_linkedin} onChangeText={(v) => setLiens({ ...liens, lien_linkedin: v })} placeholder="https://www.linkedin.com/in/..." autoCapitalize="none" keyboardType="url" />
        <Champ label="GitHub" value={liens.lien_github} onChangeText={(v) => setLiens({ ...liens, lien_github: v })} placeholder="https://github.com/..." autoCapitalize="none" keyboardType="url" />
        <Champ label="Site web" value={liens.lien_site} onChangeText={(v) => setLiens({ ...liens, lien_site: v })} placeholder="https://..." autoCapitalize="none" keyboardType="url" />

        <PrimaryButton title="Enregistrer" icon="checkmark" onPress={enregistrer} loading={saving} style={{ marginTop: spacing.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Champ({ label, style, inputStyle, ...props }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.champ, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, inputStyle]} placeholderTextColor={colors.textFaint} textAlignVertical="top" {...props} />
    </View>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
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
  couverture: { height: 120, borderRadius: radius.lg, backgroundColor: colors.primary, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'flex-end', padding: spacing.sm, marginBottom: spacing.xs },
  couvertureBouton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  couvertureTexte: { color: colors.white, fontWeight: '700', fontSize: 12 },
  retirer: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginBottom: spacing.sm },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  puce: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, paddingHorizontal: 11, paddingVertical: 5, borderRadius: radius.pill },
  puceTexte: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  ajouter: { width: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  etape: { gap: spacing.sm, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  ajouterLigne: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  ajouterTexte: { color: colors.primary, fontWeight: '700' },
}));
