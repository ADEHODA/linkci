// Parametres (facon WhatsApp) : compte, confidentialite, securite, notifications, apparence, aide
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import QRCode from 'react-native-qrcode-svg';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { PrimaryButton, Loading } from '../components/ui';
import { verifierMaintenant } from '../misesAJour';
import { ChoixFondEcran } from '../components/FondEcran';
import { verrouActif, changerVerrou, verrouMessagesActif, changerVerrouMessages } from '../verrou';
import { radius, spacing, creerStyles, useTheme } from '../theme';

const NOTIFS = [
  ['messages', 'Messages prives', 'chatbubble-ellipses-outline'],
  ['reactions', "J'aime et reactions", 'heart-outline'],
  ['commentaires', 'Commentaires et mentions', 'chatbox-outline'],
  ['abonnes', 'Nouveaux abonnes', 'person-add-outline'],
  ['nouveautes', 'Bourses, formations, documents', 'sparkles-outline'],
  ['offres', 'Stages et emplois', 'briefcase-outline'],
  ['entraide', 'Entraide', 'help-buoy-outline'],
  ['annonces', "Annonces de l'administration", 'megaphone-outline'],
];

const FAQ = [
  ['Je ne recois pas les notifications', "Verifie dans Parametres > Notifications que le type est active, et autorise les notifications de LinkCI dans les reglages du telephone. Garde l'app a jour avec le dernier lien d'installation."],
  ['Comment changer mon mot de passe ?', 'Parametres > Compte > Changer le mot de passe. Tu restes connecte sur ce telephone, les autres appareils sont deconnectes.'],
  ["Quelqu'un me derange", "Ouvre son profil et touche Bloquer : vous ne verrez plus vos publications et ne pourrez plus vous ecrire. Tu peux aussi limiter qui peut t'ecrire dans Confidentialite."],
  ['Comment signaler un contenu ?', "Touche les ... sur une publication, ou Signaler sur une annonce : un administrateur l'examine rapidement."],
  ['Les stages proposes sont-ils fiables ?', "Les offres proposees par les etudiants sont verifiees par un administrateur. Ne paie jamais pour obtenir un stage ou un emploi."],
  ["J'ai oublie mon mot de passe", "Sur l'ecran de connexion du site linkci.onrender.com, choisis Mot de passe oublie : un lien t'est envoye par e-mail."],
];

export default function SettingsScreen({ navigation, onLogin, onLogout }) {
  const styles = useStyles();
  const { colors, preference, setPreference, taille, contraste, setAccessibilite } = useTheme();
  const [moi, setMoi] = useState(null);
  const [p, setP] = useState(null);
  const [verrou, setVerrou] = useState(false);
  const [verrouMsg, setVerrouMsg] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'mdp' | 'bloques' | 'qr' | 'faq'

  const charger = useCallback(async () => {
    try {
      const [me, params] = await Promise.all([api.getMe(), api.getParametres()]);
      setMoi(me);
      setP(params);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setVerrou(await verrouActif());
    setVerrouMsg(await verrouMessagesActif());
  }, []);
  useEffect(() => { charger(); }, [charger]);

  if (!moi || !p) return <Loading />;

  const enregistrer = async (changement) => {
    setP({ ...p, ...changement, notifications: { ...p.notifications, ...(changement.notifications || {}) } });
    try {
      setP(await api.setParametres(changement));
    } catch (e) {
      Alert.alert('Erreur', e.message);
      charger();
    }
  };

  const basculerVerrou = async (v) => {
    const erreur = await changerVerrou(v);
    if (erreur) Alert.alert('Verrouillage', erreur); else setVerrou(v);
  };
  const basculerVerrouMsg = async (v) => {
    const erreur = await changerVerrouMessages(v);
    if (erreur) Alert.alert('Discussions', erreur); else setVerrouMsg(v);
  };

  const deconnecterPartout = () => Alert.alert('Deconnecter les autres appareils ?', 'Tu restes connecte sur ce telephone.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Deconnecter', onPress: async () => {
      try {
        const r = await api.deconnecterPartout();
        await onLogin(r.token);
        Alert.alert('Fait', r.message);
      } catch (e) { Alert.alert('Erreur', e.message); }
    } },
  ]);

  const contacterAdmin = async () => {
    try {
      const a = await api.getContactAide();
      if (!a.id) { Alert.alert('Aide', "Aucun administrateur disponible pour l'instant."); return; }
      navigation.navigate('Conversation', { autre_id: a.id, prenom: a.prenom, nom: a.nom, avatar: a.avatar });
    } catch (e) { Alert.alert('Erreur', e.message); }
  };

  const [recherche, setRecherche] = useState(false);
  const rechercherMiseAJour = async () => {
    setRecherche(true);
    const resultat = await verifierMaintenant();
    setRecherche(false);
    const textes = {
      installee: ['Mise a jour trouvee 🎉', "LinkCI redemarre dans un instant avec la nouvelle version."],
      a_jour: ['Tout est a jour ✅', 'Tu as deja la derniere version de LinkCI.'],
      hors_ligne: ['Pas de connexion', 'Verifie ta connexion internet puis reessaie.'],
      indisponible: ['Indisponible', 'Les mises a jour ne sont pas disponibles dans ce mode.'],
    };
    Alert.alert(...textes[resultat]);
  };

  const version = `${Constants.expoConfig?.version || ''}${Updates.updateId ? ` · maj ${Updates.updateId.slice(0, 8)}` : ''}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.entete} onPress={() => navigation.navigate('ModifierProfil', { user: moi })} activeOpacity={0.8}>
        <Avatar name={`${moi.prenom} ${moi.nom}`} size={56} index={moi.id} avatar={moi.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nom}>{moi.prenom} {moi.nom}</Text>
          <Text style={styles.sous} numberOfLines={1}>{moi.email}</Text>
        </View>
        <TouchableOpacity onPress={() => setFenetre('qr')} hitSlop={10}>
          <Ionicons name="qr-code-outline" size={24} color={colors.primary} />
        </TouchableOpacity>
      </TouchableOpacity>

      <Section titre="Compte">
        <Ligne icone="create-outline" texte="Modifier le profil" onPress={() => navigation.navigate('ModifierProfil', { user: moi })} />
        <Ligne icone="key-outline" texte="Changer le mot de passe" onPress={() => setFenetre('mdp')} />
        <Ligne icone="phone-portrait-outline" texte="Deconnecter les autres appareils" onPress={deconnecterPartout} />
        <Ligne icone="log-out-outline" texte="Se deconnecter" danger onPress={onLogout} />
        <Ligne icone="trash-outline" texte="Supprimer mon compte" danger onPress={() => setFenetre('supprimer')} />
      </Section>

      <Section titre="Confidentialite">
        <Text style={styles.libelle}>Qui peut m'ecrire</Text>
        <View style={styles.segment}>
          {[['tous', 'Tout le monde'], ['abonnes', 'Personnes que je suis']].map(([cle, label]) => (
            <TouchableOpacity key={cle} style={[styles.segBtn, p.qui_peut_ecrire === cle && styles.segActif]} onPress={() => enregistrer({ qui_peut_ecrire: cle })}>
              <Text style={[styles.segTexte, p.qui_peut_ecrire === cle && { color: colors.white }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Interrupteur icone="checkmark-done-outline" texte="Accuses de lecture (Vu)" aide="Si tu les desactives, tu ne verras pas non plus ceux des autres."
          valeur={!p.masquer_vu} onChange={(v) => enregistrer({ masquer_vu: !v })} />
        <Interrupteur icone="eye-off-outline" texte="Visites de profil anonymes" aide="Tes visites ne sont pas enregistrees, et tu ne vois pas qui a vu ton profil."
          valeur={!!p.masquer_visites} onChange={(v) => enregistrer({ masquer_visites: v })} />
        <Ligne icone="ban-outline" texte="Comptes bloques" onPress={() => setFenetre('bloques')} />
      </Section>

      <Section titre="Securite">
        <Interrupteur icone="finger-print" texte="Verrouiller l'app" aide="Empreinte ou visage a l'ouverture (code du telephone en secours)."
          valeur={verrou} onChange={basculerVerrou} />
        <Interrupteur icone="lock-closed-outline" texte="Code sur les discussions" aide="L'onglet Messages demande ton empreinte avant de s'ouvrir."
          valeur={verrouMsg} onChange={basculerVerrouMsg} />
      </Section>

      <Section titre="Notifications">
        {NOTIFS.map(([cle, label, icone]) => (
          <Interrupteur key={cle} icone={icone} texte={label} valeur={p.notifications[cle] !== false}
            onChange={(v) => enregistrer({ notifications: { [cle]: v } })} />
        ))}
      </Section>

      <Section titre="Apparence">
        <View style={styles.segment}>
          {[['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([cle, label]) => (
            <TouchableOpacity key={cle} style={[styles.segBtn, preference === cle && styles.segActif]} onPress={() => setPreference(cle)}>
              <Text style={[styles.segTexte, preference === cle && { color: colors.white }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.sousTitre}>Taille du texte</Text>
        <View style={styles.segment}>
          {[['petit', 'A-'], ['normal', 'A'], ['grand', 'A+'], ['tres_grand', 'A++']].map(([cle, label]) => (
            <TouchableOpacity key={cle} style={[styles.segBtn, taille === cle && styles.segActif]} onPress={() => setAccessibilite({ taille: cle })}
              accessibilityLabel={`Taille du texte ${cle.replace('_', ' ')}`}>
              <Text style={[styles.segTexte, taille === cle && { color: colors.white }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Interrupteur icone="contrast-outline" texte="Contraste eleve" valeur={!!contraste}
          onChange={(v) => setAccessibilite({ contraste: v })} />
        <Ligne icone="color-palette-outline" texte="Fond d'ecran des discussions" onPress={() => setFenetre('fond')} />
      </Section>

      <Section titre="Aide">
        <Ligne icone="cloud-download-outline" texte={recherche ? 'Recherche en cours...' : 'Rechercher une mise a jour'}
          onPress={recherche ? undefined : rechercherMiseAJour} />
        <Ligne icone="help-circle-outline" texte="Questions frequentes" onPress={() => setFenetre('faq')} />
        <Ligne icone="chatbubbles-outline" texte="Contacter l'administrateur" onPress={contacterAdmin} />
        <Ligne icone="bug-outline" texte="Signaler un probleme" onPress={contacterAdmin} />
        <Ligne icone="shield-outline" texte="Politique de confidentialite" onPress={() => Linking.openURL(`${api.API_BASE}/confidentialite`)} />
        <Ligne icone="document-text-outline" texte="Conditions d'utilisation" onPress={() => Linking.openURL(`${api.API_BASE}/conditions`)} />
        <Text style={styles.version}>LinkCI {version}</Text>
      </Section>

      <MotDePasse visible={fenetre === 'mdp'} onFermer={() => setFenetre(null)} onChange={onLogin} />
      <Bloques visible={fenetre === 'bloques'} onFermer={() => setFenetre(null)} />
      <SupprimerCompte visible={fenetre === 'supprimer'} onFermer={() => setFenetre(null)} onSupprime={onLogout} />
      <Faq visible={fenetre === 'faq'} onFermer={() => setFenetre(null)} />
      <ChoixFondEcran visible={fenetre === 'fond'} onFermer={() => setFenetre(null)} />
      <Modal visible={fenetre === 'qr'} transparent animationType="fade" onRequestClose={() => setFenetre(null)}>
        <TouchableOpacity style={styles.fond} activeOpacity={1} onPress={() => setFenetre(null)}>
          <View style={styles.qrCarte}>
            <Text style={styles.nom}>{moi.prenom} {moi.nom}</Text>
            <View style={styles.qrCadre}><QRCode value={`https://linkci.onrender.com/profil/${moi.id}`} size={210} color="#111" backgroundColor="#fff" /></View>
            <Text style={styles.aide}>Fais scanner ce code : ton camarade ouvre ton profil (Explorer, icone QR).</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

function Section({ titre, children }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitre}>{titre}</Text>
      <View style={styles.carte}>{children}</View>
    </View>
  );
}

function Ligne({ icone, texte, onPress, danger }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.ligne} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icone} size={21} color={danger ? colors.danger : colors.primary} />
      <Text style={[styles.ligneTexte, danger && { color: colors.danger }]}>{texte}</Text>
      {!danger ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </TouchableOpacity>
  );
}

function Interrupteur({ icone, texte, aide, valeur, onChange }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.ligne}>
      <Ionicons name={icone} size={21} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.ligneTexte}>{texte}</Text>
        {aide ? <Text style={styles.aide}>{aide}</Text> : null}
      </View>
      <Switch value={valeur} onValueChange={onChange} trackColor={{ true: colors.primary }} thumbColor={colors.white} />
    </View>
  );
}

function MotDePasse({ visible, onFermer, onChange }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const valider = async () => {
    if (nouveau.length < 8) { Alert.alert('Mot de passe', 'Au moins 8 caracteres.'); return; }
    if (nouveau !== confirmation) { Alert.alert('Mot de passe', 'Les deux nouveaux mots de passe ne correspondent pas.'); return; }
    setEnvoi(true);
    try {
      const r = await api.changerMotDePasse(actuel, nouveau);
      await onChange(r.token);
      setActuel(''); setNouveau(''); setConfirmation('');
      onFermer();
      Alert.alert('Fait', 'Mot de passe modifie. Tes autres appareils ont ete deconnectes.');
    } catch (e) {
      Alert.alert('Mot de passe', e.message);
    }
    setEnvoi(false);
  };
  const champ = (valeur, set, placeholder) => (
    <TextInput style={styles.champ} value={valeur} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.textFaint}
      secureTextEntry autoCapitalize="none" />
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fondBas}>
        <View style={styles.feuille}>
          <Text style={styles.nom}>Changer le mot de passe</Text>
          {champ(actuel, setActuel, 'Mot de passe actuel')}
          {champ(nouveau, setNouveau, 'Nouveau mot de passe (8 caracteres min.)')}
          {champ(confirmation, setConfirmation, 'Confirme le nouveau mot de passe')}
          <PrimaryButton title="Enregistrer" icon="checkmark" onPress={valider} loading={envoi} />
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Suppression definitive du compte (exigee par Google Play et l'App Store)
function SupprimerCompte({ visible, onFermer, onSupprime }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [mdp, setMdp] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const supprimer = () => Alert.alert('Derniere confirmation', 'Ton compte et toutes tes donnees seront effaces definitivement.', [
    { text: 'Annuler', style: 'cancel' },
    {
      text: 'Supprimer',
      style: 'destructive',
      onPress: async () => {
        setEnvoi(true);
        try {
          const r = await api.supprimerCompte(mdp);
          setMdp('');
          onFermer();
          Alert.alert('Compte supprime', r.message);
          onSupprime();
        } catch (e) {
          Alert.alert('Suppression', e.message);
        }
        setEnvoi(false);
      },
    },
  ]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fondBas}>
        <View style={styles.feuille}>
          <Text style={[styles.nom, { color: colors.danger }]}>Supprimer mon compte</Text>
          <Text style={styles.aide}>Action definitive : ton profil, tes publications, messages (envoyes et recus), photos, notes vocales, documents, annonces, offres, questions et reponses seront effaces.</Text>
          <TextInput style={styles.champ} value={mdp} onChangeText={setMdp} placeholder="Confirme avec ton mot de passe" placeholderTextColor={colors.textFaint}
            secureTextEntry autoCapitalize="none" />
          <TouchableOpacity style={[styles.boutonDanger, (!mdp || envoi) && { opacity: 0.5 }]} onPress={supprimer} disabled={!mdp || envoi}>
            <Text style={styles.boutonDangerTexte}>{envoi ? 'Suppression...' : 'Supprimer definitivement'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Annuler</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Bloques({ visible, onFermer }) {
  const styles = useStyles();
  const [liste, setListe] = useState(null);
  const charger = () => api.getBloques().then(setListe).catch(() => setListe([]));
  useEffect(() => { if (visible) charger(); }, [visible]);
  const debloquer = (u) => api.debloquer(u.id).then(charger).catch((e) => Alert.alert('Erreur', e.message));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fondBas}>
        <View style={styles.feuille}>
          <Text style={styles.nom}>Comptes bloques</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {!liste ? <Loading /> : !liste.length ? <Text style={styles.aide}>Tu n'as bloque personne.</Text> : liste.map((u) => (
              <View key={u.id} style={styles.ligne}>
                <Avatar name={`${u.prenom} ${u.nom}`} size={36} index={u.id} avatar={u.avatar} />
                <Text style={styles.ligneTexte}>{u.prenom} {u.nom}</Text>
                <TouchableOpacity style={styles.petitBouton} onPress={() => debloquer(u)}><Text style={styles.petitBoutonTexte}>Debloquer</Text></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Faq({ visible, onFermer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [ouverte, setOuverte] = useState(null);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.fondBas}>
        <View style={[styles.feuille, { maxHeight: '85%' }]}>
          <Text style={styles.nom}>Questions frequentes</Text>
          <ScrollView>
            {FAQ.map(([q, r], k) => (
              <TouchableOpacity key={q} style={styles.faq} onPress={() => setOuverte(ouverte === k ? null : k)} activeOpacity={0.8}>
                <View style={styles.faqHaut}>
                  <Text style={styles.faqQ}>{q}</Text>
                  <Ionicons name={ouverte === k ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
                </View>
                {ouverte === k ? <Text style={styles.faqR}>{r}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.annuler} onPress={onFermer}><Text style={styles.annulerTexte}>Fermer</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = creerStyles(({ colors, font }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  nom: { fontSize: 17, fontWeight: '800', color: colors.text },
  sous: { fontSize: 13, color: colors.textMuted },
  section: { marginBottom: spacing.md },
  sectionTitre: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6, marginLeft: spacing.xs },
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  ligneTexte: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  aide: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  libelle: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
  segment: { flexDirection: 'row', gap: 6, marginVertical: spacing.sm },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.cardAlt },
  segActif: { backgroundColor: colors.primary },
  segTexte: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  sousTitre: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm },
  version: { fontSize: 12, color: colors.textFaint, textAlign: 'center', paddingVertical: spacing.md },
  fond: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  fondBas: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  feuille: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.md },
  qrCarte: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', gap: spacing.md },
  qrCadre: { padding: 14, backgroundColor: '#fff', borderRadius: radius.lg },
  champ: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text },
  annuler: { alignItems: 'center', paddingTop: spacing.xs },
  annulerTexte: { color: colors.textMuted, fontWeight: '600' },
  boutonDanger: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center' },
  boutonDangerTexte: { color: colors.white, fontWeight: '800', fontSize: 15 },
  petitBouton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  petitBoutonTexte: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  faq: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  faqHaut: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  faqQ: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  faqR: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginTop: 6 },
}));
