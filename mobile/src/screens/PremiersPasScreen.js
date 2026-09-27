// Premiers pas apres l'inscription : 1. ma fac et ma filiere  2. rejoindre ma promo  3. suivre des etudiants
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { PrimaryButton } from '../components/ui';
import { choisirPhoto } from '../photos';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const UNIVERSITES = ['UFHB (Cocody)', 'INP-HB (Yamoussoukro)', 'UAO (Bouake)', 'UJLoG (Daloa)', 'UPGC (Korhogo)', 'UNA (Abobo-Adjame)', 'ESATIC', 'ENSEA'];

export default function PremiersPasScreen({ navigation }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [etape, setEtape] = useState(0);
  const [moi, setMoi] = useState(null);
  const [f, setF] = useState({ universite: '', filiere: '', annee: '' });
  const [photo, setPhoto] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [groupes, setGroupes] = useState(null);
  const [etudiants, setEtudiants] = useState(null);
  const [rejoints, setRejoints] = useState([]);
  const [suivis, setSuivis] = useState([]);

  useEffect(() => {
    api.getMe().then((m) => { setMoi(m); setF({ universite: m.universite || '', filiere: m.filiere || '', annee: m.annee || '' }); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (etape === 1) api.getGroupes().then(setGroupes).catch(() => setGroupes({ tous_groupes: [], mes_groupes: [] }));
    if (etape === 2) api.getDecouverte().then((d) => setEtudiants(d.etudiants || [])).catch(() => setEtudiants([]));
  }, [etape]);

  const terminer = async () => {
    try { await api.premiersPasFini(); } catch (e) {}
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const enregistrerProfil = async () => {
    if (!f.universite.trim() || !f.filiere.trim()) {
      Alert.alert('Presque !', 'Indique ton universite et ta filiere : c\'est ce qui permet de trouver ta promo.');
      return;
    }
    setEnvoi(true);
    try {
      await api.updateProfile({ prenom: moi.prenom, nom: moi.nom, bio: moi.bio || '', ...f, ...(photo ? { avatar: photo.base64 } : {}) });
      setEtape(1);
    } catch (e) { Alert.alert('Erreur', e.message); }
    setEnvoi(false);
  };

  const rejoindre = async (g) => {
    try { await api.rejoindreGroupe(g.id); setRejoints((r) => [...r, g.id]); } catch (e) { Alert.alert('Erreur', e.message); }
  };
  const creerPromo = async () => {
    try {
      const a = groupes.a_creer;
      await api.createGroupe({ nom: a.nom, description: `Groupe de la promo ${a.filiere} a ${a.universite}`, universite: a.universite, filiere: a.filiere });
      setGroupes(await api.getGroupes());
      Alert.alert('Groupe cree 🎉', 'Invite tes camarades avec le bouton ➕👤 dans le groupe.');
    } catch (e) { Alert.alert('Erreur', e.message); }
  };
  const suivre = async (u) => {
    try { await api.suivre(u.id); setSuivis((s) => [...s, u.id]); } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const maj = (cle) => (v) => setF((x) => ({ ...x, [cle]: v }));
  const suggeres = (groupes?.tous_groupes || []).filter((g) => g.suggere).concat((groupes?.tous_groupes || []).filter((g) => !g.suggere)).slice(0, 8);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.entete}>
        <View style={styles.points}>
          {[0, 1, 2].map((k) => <View key={k} style={[styles.point, k <= etape && styles.pointActif]} />)}
        </View>
        <TouchableOpacity onPress={terminer} hitSlop={10}><Text style={styles.passer}>Passer</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.contenu} keyboardShouldPersistTaps="handled">
        {etape === 0 ? (
          <>
            <Text style={styles.titre}>Bienvenue {moi?.prenom} 👋</Text>
            <Text style={styles.texte}>Dis-nous ou tu etudies : on te montrera ta promo et les etudiants de ta filiere.</Text>
            <TouchableOpacity style={styles.photo} onPress={async () => { try { const p = await choisirPhoto('galerie', { carre: true }); if (p) setPhoto(p); } catch (e) {} }}>
              {moi ? <Avatar name={`${moi.prenom} ${moi.nom}`} size={84} index={moi.id} avatar={moi.avatar} uri={photo?.uri} /> : null}
              <Text style={styles.photoTexte}>{photo ? 'Changer la photo' : 'Ajouter une photo (facultatif)'}</Text>
            </TouchableOpacity>
            <Text style={styles.libelle}>Universite ou ecole</Text>
            <TextInput style={styles.champ} value={f.universite} onChangeText={maj('universite')} placeholder="ex. UFHB" placeholderTextColor={colors.textFaint} maxLength={100} />
            <View style={styles.puces}>
              {UNIVERSITES.map((u) => (
                <TouchableOpacity key={u} style={[styles.puce, f.universite === u && styles.puceActive]} onPress={() => maj('universite')(u)}>
                  <Text style={[styles.puceTexte, f.universite === u && { color: colors.white }]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.libelle}>Filiere</Text>
            <TextInput style={styles.champ} value={f.filiere} onChangeText={maj('filiere')} placeholder="ex. Informatique, Droit, Medecine..." placeholderTextColor={colors.textFaint} maxLength={100} />
            <Text style={styles.libelle}>Annee (facultatif)</Text>
            <TextInput style={styles.champ} value={f.annee} onChangeText={maj('annee')} placeholder="ex. Licence 2, Master 1..." placeholderTextColor={colors.textFaint} maxLength={20} />
            <PrimaryButton title="Continuer" onPress={enregistrerProfil} loading={envoi} />
          </>
        ) : null}

        {etape === 1 ? (
          <>
            <Text style={styles.titre}>Rejoins ta promo 👥</Text>
            <Text style={styles.texte}>Les groupes de discussion de ta fac et de ta filiere : cours, infos, entraide.</Text>
            {groupes?.a_creer ? (
              <TouchableOpacity style={styles.creer} onPress={creerPromo} activeOpacity={0.85}>
                <Ionicons name="add-circle" size={26} color={colors.white} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.creerTitre}>Creer le groupe « {groupes.a_creer.nom} »</Text>
                  <Text style={styles.creerTexte}>Il n'existe pas encore : sois le premier et invite ta promo !</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {(groupes?.mes_groupes || []).map((g) => (
              <View key={`m${g.id}`} style={styles.ligne}>
                <Avatar name={g.nom} size={44} index={g.id} />
                <Text style={styles.nom} numberOfLines={2}>{g.nom}</Text>
                <Text style={styles.ok}>✓ Membre</Text>
              </View>
            ))}
            {suggeres.map((g) => (
              <View key={g.id} style={styles.ligne}>
                <Avatar name={g.nom} size={44} index={g.id} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nom} numberOfLines={2}>{g.nom}</Text>
                  <Text style={styles.petit}>{g.nb_membres} membre{g.nb_membres > 1 ? 's' : ''}{g.suggere ? ' · pour toi' : ''}</Text>
                </View>
                {rejoints.includes(g.id) ? <Text style={styles.ok}>✓</Text> : (
                  <TouchableOpacity style={styles.bouton} onPress={() => rejoindre(g)}><Text style={styles.boutonTexte}>Rejoindre</Text></TouchableOpacity>
                )}
              </View>
            ))}
            {groupes && !suggeres.length && !groupes.a_creer ? <Text style={styles.texte}>Aucun groupe pour l'instant : tu pourras en creer un dans l'onglet Groupes.</Text> : null}
            <PrimaryButton title="Continuer" onPress={() => setEtape(2)} style={{ marginTop: spacing.lg }} />
          </>
        ) : null}

        {etape === 2 ? (
          <>
            <Text style={styles.titre}>Suis des etudiants ✨</Text>
            <Text style={styles.texte}>Leurs publications apparaitront dans ton fil. Tu peux en suivre autant que tu veux.</Text>
            {(etudiants || []).map((u) => (
              <View key={u.id} style={styles.ligne}>
                <Avatar name={`${u.prenom} ${u.nom}`} size={44} index={u.id} avatar={u.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nom}>{u.prenom} {u.nom}</Text>
                  <Text style={styles.petit} numberOfLines={1}>{[u.raison, u.filiere, u.universite].filter(Boolean).join(' · ')}</Text>
                </View>
                {suivis.includes(u.id) ? <Text style={styles.ok}>✓ Suivi</Text> : (
                  <TouchableOpacity style={styles.bouton} onPress={() => suivre(u)}><Text style={styles.boutonTexte}>Suivre</Text></TouchableOpacity>
                )}
              </View>
            ))}
            {etudiants && !etudiants.length ? <Text style={styles.texte}>Tu es parmi les premiers ! Invite tes camarades depuis ton profil 🎟️</Text> : null}
            <PrimaryButton title="C'est parti ! 🚀" onPress={terminer} style={{ marginTop: spacing.lg }} />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: 50, paddingBottom: spacing.sm },
  points: { flexDirection: 'row', gap: 6 },
  point: { width: 26, height: 6, borderRadius: 3, backgroundColor: colors.border },
  pointActif: { backgroundColor: colors.primary },
  passer: { color: colors.textMuted, fontWeight: '700' },
  contenu: { padding: spacing.xl, paddingBottom: 40 },
  titre: { fontSize: 26, fontWeight: '900', color: colors.text },
  texte: { fontSize: 15, color: colors.textMuted, marginTop: 6, marginBottom: spacing.lg, lineHeight: 21 },
  photo: { alignItems: 'center', gap: 8, marginBottom: spacing.lg },
  photoTexte: { color: colors.primary, fontWeight: '700' },
  libelle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  champ: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border },
  puces: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm, marginBottom: spacing.sm },
  puce: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  puceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  puceTexte: { fontSize: 12, fontWeight: '700', color: colors.text },
  creer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.accent, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  creerTitre: { color: colors.white, fontWeight: '800', fontSize: 15 },
  creerTexte: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 2 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  nom: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  petit: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bouton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  boutonTexte: { color: colors.white, fontWeight: '800', fontSize: 13 },
  ok: { color: colors.accent, fontWeight: '800' },
}));
