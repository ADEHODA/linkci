// Recherche globale et decouverte (etudiants de ta filiere, tendances, publications populaires)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';
import Avatar from '../components/Avatar';
import { EmptyState } from '../components/ui';
import { radius, spacing, creerStyles, useTheme } from '../theme';
import { dateRelative } from '../utils';

const LIBELLE_OFFRE = { stage: 'Stage', emploi: 'Emploi', job: 'Job etudiant', alternance: 'Alternance' };
const prix = (a) => (a.vendu ? 'Vendu' : a.prix ? `${String(a.prix).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA` : 'Gratuit');

export default function SearchScreen({ navigation, route }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState(route?.params?.q || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [decouverte, setDecouverte] = useState(null);
  const [suivis, setSuivis] = useState({});
  const timer = useRef(null);

  useEffect(() => { api.getDecouverte().then(setDecouverte).catch(() => {}); }, []);
  useEffect(() => { if (route?.params?.q) chercher(route.params.q); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chercher = (q) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { setResults(await api.searchAll(q.trim())); } catch (e) {}
      setLoading(false);
    }, 350);
  };

  const suivre = async (u) => {
    const deja = suivis[u.id];
    setSuivis({ ...suivis, [u.id]: !deja });
    try {
      if (deja) await api.nePlusSuivre(u.id); else await api.suivre(u.id);
    } catch (e) {
      setSuivis({ ...suivis, [u.id]: deja });
      Alert.alert('Erreur', e.message);
    }
  };

  const profil = (id) => navigation.navigate('ProfilEtudiant', { id });
  const total = results ? Object.values(results).reduce((n, l) => n + l.length, 0) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.barre}>
        <Ionicons name="search" size={20} color={colors.textFaint} />
        <TextInput style={styles.saisie} value={query} onChangeText={chercher} autoFocus={!route?.params?.q}
          placeholder="Etudiants, cours, questions, annonces, offres..." placeholderTextColor={colors.textFaint} returnKeyType="search" />
        {query ? <TouchableOpacity onPress={() => chercher('')} hitSlop={10}><Ionicons name="close-circle" size={20} color={colors.textFaint} /></TouchableOpacity> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}

        {results && !loading ? (
          total === 0 ? <EmptyState icon="search-outline" title="Aucun resultat" hint={`Rien pour « ${query} ». Essaie un autre mot.`} /> : (
            <>
              <Section titre="Etudiants" liste={results.users} rendu={(u) => (
                <Ligne key={u.id} gauche={<Avatar name={`${u.prenom} ${u.nom}`} size={40} index={u.id} avatar={u.avatar} />}
                  titre={`${u.prenom} ${u.nom}`} sous={[u.filiere, u.universite].filter(Boolean).join(' · ')} onPress={() => profil(u.id)} />
              )} />
              <Section titre="Publications" liste={results.posts} rendu={(p) => (
                <Ligne key={p.id} gauche={<Avatar name={`${p.prenom} ${p.nom}`} size={40} index={p.user_id} avatar={p.avatar} />}
                  titre={p.contenu || 'Photo'} sous={`${p.prenom} ${p.nom} · ${dateRelative(p.date_post)}`} onPress={() => profil(p.user_id)} />
              )} />
              <Section titre="Questions d'entraide" liste={results.questions} rendu={(q) => (
                <Ligne key={q.id} icone="help-buoy" couleur="#7C3AED" titre={q.titre}
                  sous={`${q.matiere} · ${q.nb_reponses} reponse${q.nb_reponses > 1 ? 's' : ''}${q.resolue ? ' · resolue' : ''}`}
                  onPress={() => navigation.navigate('Question', { id: q.id })} />
              )} />
              <Section titre="Petites annonces" liste={results.annonces} rendu={(a) => (
                <Ligne key={a.id} gauche={a.image ? <Image source={{ uri: api.imageUrl(a.image) }} style={styles.vignette} /> : null}
                  icone="pricetags" couleur="#DB2777" titre={a.titre} sous={[prix(a), a.ville].filter(Boolean).join(' · ')}
                  onPress={() => navigation.navigate('Annonces')} />
              )} />
              <Section titre="Stages et emplois" liste={results.offres} rendu={(o) => (
                <Ligne key={o.id} icone="briefcase" couleur="#0891B2" titre={o.titre}
                  sous={[LIBELLE_OFFRE[o.type], o.entreprise, o.ville].filter(Boolean).join(' · ')} onPress={() => navigation.navigate('Opportunites')} />
              )} />
              <Section titre="Bourses" liste={results.bourses} rendu={(b) => (
                <Ligne key={b.id} icone="cash" couleur="#FF6B35" titre={b.titre} sous={[b.organisme, b.type].filter(Boolean).join(' · ')}
                  onPress={() => navigation.navigate('Bourses')} />
              )} />
              <Section titre="Formations" liste={results.formations} rendu={(f) => (
                <Ligne key={f.id} icone="school" couleur="#009E60" titre={f.nom} sous={[f.universite, f.niveau].filter(Boolean).join(' · ')}
                  onPress={() => navigation.navigate('Formations')} />
              )} />
              <Section titre="Groupes" liste={results.groupes} rendu={(g) => (
                <Ligne key={g.id} gauche={<Avatar name={g.nom} size={40} index={g.id} />} titre={g.nom}
                  sous={`${g.nb_membres} membre${g.nb_membres > 1 ? 's' : ''}${g.membre ? ' · tu es membre' : ''}`}
                  onPress={() => navigation.navigate('Groupes', g.membre ? { ouvrir: g.id } : undefined)} />
              )} />
              <Section titre="Documents" liste={results.documents} rendu={(d) => (
                <Ligne key={d.id} icone="document-text" couleur="#2563EB" titre={d.titre} sous={d.matiere || ''} onPress={() => navigation.navigate('Documents')} />
              )} />
            </>
          )
        ) : null}

        {!results && !loading && decouverte ? (
          <>
            {decouverte.etudiants.length ? (
              <>
                <Text style={styles.titreSection}>Etudiants a decouvrir</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
                  {decouverte.etudiants.map((u) => (
                    <TouchableOpacity key={u.id} style={styles.carteEtudiant} onPress={() => profil(u.id)} activeOpacity={0.85}>
                      <Avatar name={`${u.prenom} ${u.nom}`} size={58} index={u.id} avatar={u.avatar} />
                      <Text style={styles.carteNom} numberOfLines={1}>{u.prenom} {u.nom}</Text>
                      <Text style={styles.carteRaison} numberOfLines={1}>{u.raison}</Text>
                      <TouchableOpacity style={[styles.suivre, suivis[u.id] && styles.suivreActif]} onPress={() => suivre(u)}>
                        <Text style={[styles.suivreTexte, suivis[u.id] && { color: colors.primary }]}>{suivis[u.id] ? 'Suivi' : 'Suivre'}</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {decouverte.tendances.length ? (
              <>
                <Text style={styles.titreSection}>Tendances du campus</Text>
                <View style={styles.tags}>
                  {decouverte.tendances.map((t) => (
                    <TouchableOpacity key={t.tag} style={styles.tag} onPress={() => chercher(`#${t.tag}`)}>
                      <Text style={styles.tagTexte}>#{t.tag}</Text>
                      <Text style={styles.tagNb}>{t.nb}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            {decouverte.populaires.length ? (
              <>
                <Text style={styles.titreSection}>Populaire cette semaine</Text>
                {decouverte.populaires.map((p) => (
                  <Ligne key={p.id} gauche={<Avatar name={`${p.prenom} ${p.nom}`} size={40} index={p.user_id} avatar={p.avatar} />}
                    titre={p.contenu || 'Photo'} sous={`${p.prenom} ${p.nom} · ${dateRelative(p.date_post)}`} onPress={() => profil(p.user_id)} />
                ))}
              </>
            ) : null}

            {!decouverte.etudiants.length && !decouverte.tendances.length && !decouverte.populaires.length ? (
              <EmptyState icon="compass-outline" title="Cherche sur LinkCI" hint="Un camarade, un cours, une question, une annonce... Utilise #mots dans tes publications pour creer des tendances." />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Section({ titre, liste, rendu }) {
  const styles = useStyles();
  if (!liste || !liste.length) return null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.titreSection}>{titre}</Text>
      <View style={styles.carte}>{liste.map(rendu)}</View>
    </View>
  );
}

function Ligne({ gauche, icone, couleur, titre, sous, onPress }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.ligne} onPress={onPress} activeOpacity={0.7}>
      {gauche || (icone ? <View style={[styles.icone, { backgroundColor: `${couleur}22` }]}><Ionicons name={icone} size={20} color={couleur} /></View> : null)}
      <View style={{ flex: 1 }}>
        <Text style={styles.ligneTitre} numberOfLines={2}>{titre}</Text>
        {sous ? <Text style={styles.ligneSous} numberOfLines={1}>{sous}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  barre: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  saisie: { flex: 1, paddingVertical: 11, fontSize: 15, color: colors.text },
  content: { paddingHorizontal: spacing.md, paddingBottom: 40 },
  titreSection: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6, marginTop: spacing.sm },
  carte: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  icone: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  vignette: { width: 40, height: 40, borderRadius: radius.md },
  ligneTitre: { fontSize: 15, fontWeight: '600', color: colors.text },
  ligneSous: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  carteEtudiant: { width: 130, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  carteNom: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 4 },
  carteRaison: { fontSize: 11, color: colors.textMuted },
  suivre: { marginTop: 6, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: colors.primary },
  suivreActif: { backgroundColor: 'transparent' },
  suivreTexte: { color: colors.white, fontWeight: '800', fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  tagTexte: { color: colors.primary, fontWeight: '800' },
  tagNb: { fontSize: 11, color: colors.textFaint },
}));
