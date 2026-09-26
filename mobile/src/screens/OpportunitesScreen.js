// Stages, emplois, jobs etudiants et alternances
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ScrollView, Modal, Linking, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import useApiList from '../hooks/useApiList';
import { Card, Chip, EmptyState, Fab, PrimaryButton, pullToRefresh, SkeletonList } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';
import { partager } from '../partage';

const TYPES = [
  { cle: 'stage', label: 'Stage', icone: 'briefcase' },
  { cle: 'emploi', label: 'Emploi', icone: 'business' },
  { cle: 'job', label: 'Job etudiant', icone: 'cafe' },
  { cle: 'alternance', label: 'Alternance', icone: 'repeat' },
];
const LIBELLE = Object.fromEntries(TYPES.map((t) => [t.cle, t.label]));

// Lien pour postuler : site web, sinon e-mail ou telephone du contact
function lienPostuler(o) {
  const lien = api.lienSur(o.lien);
  if (lien) return lien;
  const contact = (o.contact || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}?subject=${encodeURIComponent('Candidature : ' + o.titre)}`;
  const tel = contact.replace(/[^\d+]/g, '');
  return tel.length >= 8 ? `tel:${tel}` : null;
}

export default function OpportunitesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: offres, loading, refreshing, refresh, reload } = useApiList(api.getOpportunites);
  const [type, setType] = useState('');
  const [recherche, setRecherche] = useState('');
  const [detail, setDetail] = useState(null);
  const [proposer, setProposer] = useState(false);
  const [alertes, setAlertes] = useState(false);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return offres
      .filter((o) => !type || o.type === type)
      .filter((o) => !q || [o.titre, o.entreprise, o.ville, o.domaine, o.description].some((t) => (t || '').toLowerCase().includes(q)));
  }, [offres, type, recherche]);

  if (loading) return <SkeletonList />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visibles}
        keyExtractor={(o) => String(o.id)}
        refreshControl={pullToRefresh(refreshing, refresh)}
        ListHeaderComponent={
          <>
            <View style={styles.barre}>
              <View style={styles.recherche}>
                <Ionicons name="search" size={18} color={colors.textFaint} />
                <TextInput style={styles.rechercheTexte} placeholder="Poste, entreprise, ville..." placeholderTextColor={colors.textFaint}
                  value={recherche} onChangeText={setRecherche} />
              </View>
              <TouchableOpacity style={styles.cloche} onPress={() => setAlertes(true)}>
                <Ionicons name="notifications-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtres}>
              {[{ cle: '', label: 'Toutes' }, ...TYPES].map((t) => (
                <TouchableOpacity key={t.cle} style={[styles.filtre, type === t.cle && styles.filtreActif]} onPress={() => setType(t.cle)}>
                  <Text style={[styles.filtreTexte, type === t.cle && styles.filtreTexteActif]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        }
        renderItem={({ item }) => <CarteOffre offre={item} onPress={() => setDetail(item)} />}
        ListEmptyComponent={<EmptyState icon="briefcase-outline" title="Aucune offre" hint="Partage un stage ou un job avec le bouton +" />}
      />
      <Fab icon="add" onPress={() => setProposer(true)} />
      <DetailOffre offre={detail} onFermer={() => setDetail(null)} />
      <ProposerOffre visible={proposer} onFermer={() => setProposer(false)} onEnvoye={() => { setProposer(false); reload(); }} />
      <AlertesOffres visible={alertes} onFermer={() => setAlertes(false)} />
    </View>
  );
}

function joursRestants(dateLimite) {
  return dateLimite ? Math.ceil((new Date(dateLimite) - new Date()) / 86400000) : null;
}

function CarteOffre({ offre, onPress }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const jours = joursRestants(offre.date_limite);
  const icone = (TYPES.find((t) => t.cle === offre.type) || TYPES[0]).icone;
  return (
    <Card style={styles.carte} onPress={onPress}>
      <View style={styles.icone}><Ionicons name={icone} size={22} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.titre} numberOfLines={2}>{offre.titre}</Text>
        <Text style={styles.entreprise} numberOfLines={1}>{[offre.entreprise, offre.ville].filter(Boolean).join(' · ')}</Text>
        <View style={styles.chips}>
          <Chip label={LIBELLE[offre.type] || offre.type} />
          {jours !== null && jours >= 0 && jours <= 14 ? <Chip label={`J-${jours}`} tone="danger" icon="time" /> : null}
          <Text style={styles.date}>{dateRelative(offre.date_publication)}</Text>
        </View>
      </View>
    </Card>
  );
}

function DetailOffre({ offre, onFermer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!offre) return null;
  const lien = lienPostuler(offre);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView>
            <Chip label={LIBELLE[offre.type] || offre.type} />
            <Text style={[styles.sheetTitre, { marginTop: spacing.sm }]}>{offre.titre}</Text>
            <Text style={styles.entreprise}>{[offre.entreprise, offre.ville, offre.domaine].filter(Boolean).join(' · ')}</Text>
            {offre.date_limite ? <Text style={styles.limite}><Ionicons name="hourglass-outline" size={13} /> Jusqu'au {offre.date_limite}</Text> : null}
            {offre.description ? <Text style={styles.description}>{offre.description}</Text> : null}
            {offre.contact ? <Text style={styles.contact}><Ionicons name="call-outline" size={14} color={colors.textMuted} /> {offre.contact}</Text> : null}
            <Text style={styles.prudence}>Ne paie jamais pour obtenir un stage ou un emploi. Signale toute offre suspecte a un administrateur.</Text>
          </ScrollView>
          {lien ? <PrimaryButton title="Postuler" icon="send" onPress={() => Linking.openURL(lien).catch(() => Alert.alert('Impossible', "Aucune application pour ouvrir ce lien."))} /> : null}
          <TouchableOpacity style={styles.annuler} onPress={() => partager(`${LIBELLE[offre.type] || 'Offre'} : ${offre.titre} chez ${offre.entreprise}`, '/opportunites')}>
            <Text style={[styles.annulerTexte, { color: colors.primary }]}>Partager l'offre</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const VIDE = { type: 'stage', titre: '', entreprise: '', ville: '', domaine: '', description: '', lien: '', contact: '', date_limite: '' };

function ProposerOffre({ visible, onFermer, onEnvoye }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [o, setO] = useState(VIDE);
  const [envoi, setEnvoi] = useState(false);
  const champ = (cle, placeholder, extra = {}) => (
    <TextInput style={styles.champ} placeholder={placeholder} placeholderTextColor={colors.textFaint}
      value={o[cle]} onChangeText={(v) => setO({ ...o, [cle]: v })} {...extra} />
  );

  const envoyer = async () => {
    setEnvoi(true);
    try {
      const r = await api.creerOpportunite(o);
      setO(VIDE);
      onEnvoye();
      Alert.alert('Merci !', r.message);
    } catch (e) {
      Alert.alert('Presque !', e.message);
    }
    setEnvoi(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { maxHeight: '92%' }]}>
          <Text style={styles.sheetTitre}>Proposer une offre</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
            <View style={styles.chipsChoix}>
              {TYPES.map((t) => (
                <TouchableOpacity key={t.cle} style={[styles.filtre, o.type === t.cle && styles.filtreActif]} onPress={() => setO({ ...o, type: t.cle })}>
                  <Text style={[styles.filtreTexte, o.type === t.cle && styles.filtreTexteActif]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {champ('titre', 'Intitule (ex. Stage assistant comptable)', { maxLength: 150 })}
            {champ('entreprise', 'Entreprise', { maxLength: 120 })}
            {champ('ville', 'Ville (ex. Abidjan)', { maxLength: 80 })}
            {champ('domaine', 'Domaine (ex. Finance, Informatique)', { maxLength: 100 })}
            {champ('description', 'Description, profil recherche...', { multiline: true, maxLength: 3000, style: [styles.champ, { minHeight: 90, textAlignVertical: 'top' }] })}
            {champ('lien', 'Lien pour postuler (https://...)', { autoCapitalize: 'none', keyboardType: 'url', maxLength: 500 })}
            {champ('contact', 'Ou contact : e-mail / telephone', { autoCapitalize: 'none', maxLength: 150 })}
            {champ('date_limite', 'Date limite AAAA-MM-JJ (optionnel)', { maxLength: 10 })}
            <Text style={styles.aide}>Les offres des etudiants sont verifiees par un administrateur avant d'etre publiees.</Text>
          </ScrollView>
          <PrimaryButton title="Envoyer" icon="send" onPress={envoyer} loading={envoi} />
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function AlertesOffres({ visible, onFermer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [types, setTypes] = useState(null);

  React.useEffect(() => {
    if (visible) api.getAlertesOpportunites().then((r) => setTypes(r.types)).catch(() => setTypes([]));
  }, [visible]);

  const basculer = async (cle, actif) => {
    const nouveaux = actif ? [...types, cle] : types.filter((t) => t !== cle);
    setTypes(nouveaux);
    try {
      setTypes((await api.setAlertesOpportunites(nouveaux)).types);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitre}>Alertes</Text>
          <Text style={styles.aide}>Recois une notification des qu'une nouvelle offre est publiee.</Text>
          {TYPES.map((t) => (
            <View key={t.cle} style={styles.ligneAlerte}>
              <Ionicons name={t.icone} size={20} color={colors.primary} />
              <Text style={styles.ligneTexte}>{t.label}</Text>
              <Switch value={!!types?.includes(t.cle)} disabled={!types} onValueChange={(v) => basculer(t.cle, v)}
                trackColor={{ true: colors.primary }} thumbColor={colors.white} />
            </View>
          ))}
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 90 },
  barre: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  recherche: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border },
  rechercheTexte: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  cloche: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  filtres: { gap: spacing.sm, paddingBottom: spacing.md },
  chipsChoix: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filtre: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  filtreActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  filtreTexteActif: { color: colors.white },
  carte: { flexDirection: 'row', gap: spacing.md },
  icone: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  titre: { fontSize: 15, fontWeight: '800', color: colors.text },
  entreprise: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  date: { fontSize: 12, color: colors.textFaint },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.md, maxHeight: '85%' },
  sheetTitre: { ...font.heading },
  limite: { fontSize: 13, color: colors.danger || '#DC2626', marginTop: spacing.sm, fontWeight: '700' },
  description: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: spacing.md },
  contact: { fontSize: 14, color: colors.textMuted, marginTop: spacing.md },
  prudence: { fontSize: 12, color: colors.textFaint, marginTop: spacing.lg, fontStyle: 'italic' },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  aide: { fontSize: 12, color: colors.textMuted },
  ligneAlerte: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  ligneTexte: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
}));
