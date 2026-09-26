import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

export const API_BASE = 'https://linkci.onrender.com';

let _token = null;
// Version de l'app, envoyee au serveur : les anciennes versions (sans cet en-tete) sont prevenues
const VERSION_APP = Constants.expoConfig?.version || '';

export function setToken(token) {
  _token = token;
}

export function getToken() {
  return _token;
}

// Appele quand le serveur refuse la session (jeton expire, revoque, compte suspendu)
let _surSessionExpiree = null;
export function onSessionExpiree(fn) {
  _surSessionExpiree = fn;
}

// N'ouvre que des liens web (bloque javascript:, intent:, file:...)
export function lienSur(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;
}

// ---- Mode hors connexion
// Chaque lecture (GET) reussie est gardee sur le telephone. Sans reseau, on renvoie
// la derniere version connue et on le signale (bandeau "Hors connexion").
const PREFIXE_CACHE = 'linkci_cache:';
const PAS_EN_CACHE = [/\/lien$/, /^\/api\/compteurs/]; // liens temporaires, compteurs
let _horsLigne = false;
const _abonnesReseau = new Set();

function setHorsLigne(valeur) {
  if (valeur === _horsLigne) return;
  _horsLigne = valeur;
  _abonnesReseau.forEach((f) => f(valeur));
  if (!valeur) envoyerFile(); // le reseau revient : on envoie les messages en attente
}

// Derniere version connue d'une lecture (affichage immediat au demarrage), ou null
export async function lireCache(path) {
  try {
    const brut = await AsyncStorage.getItem(PREFIXE_CACHE + path);
    return brut ? JSON.parse(brut) : null;
  } catch (e) {
    return null;
  }
}

// ---- Messages ecrits sans reseau : gardes sur le telephone, envoyes au retour du reseau
const CLE_FILE = 'linkci_file_envoi';
const _abonnesFile = new Set();
let _envoiEnCours = false;

export async function lireFile() {
  try { return JSON.parse((await AsyncStorage.getItem(CLE_FILE)) || '[]'); } catch (e) { return []; }
}

export async function mettreEnFile(destinataire_id, contenu) {
  const file = await lireFile();
  const msg = { id: `file-${Date.now()}`, destinataire_id, contenu, date_envoi: new Date().toISOString().slice(0, 19).replace('T', ' ') };
  file.push(msg);
  await AsyncStorage.setItem(CLE_FILE, JSON.stringify(file)).catch(() => {});
  return msg;
}

// Previent les ecrans quand la file change (messages partis)
export function surFileEnvoi(f) {
  _abonnesFile.add(f);
  return () => _abonnesFile.delete(f);
}

export async function envoyerFile() {
  if (_envoiEnCours || !_token) return;
  _envoiEnCours = true;
  try {
    let file = await lireFile();
    while (file.length) {
      const m = file[0];
      try {
        await request('/api/messages', { method: 'POST', body: JSON.stringify({ destinataire_id: m.destinataire_id, contenu: m.contenu }) });
      } catch (e) {
        if (/connexion internet|serveur demarre/i.test(e.message)) break; // toujours hors ligne : on reessaiera
        // refuse par le serveur (bloque, trop long...) : on l'abandonne pour ne pas bloquer la file
      }
      file = file.slice(1);
      await AsyncStorage.setItem(CLE_FILE, JSON.stringify(file)).catch(() => {});
      _abonnesFile.forEach((f) => f(m));
    }
  } finally {
    _envoiEnCours = false;
  }
}

// Ecoute l'etat du reseau ; renvoie la fonction de desabonnement
export function surEtatReseau(f) {
  _abonnesReseau.add(f);
  f(_horsLigne);
  return () => _abonnesReseau.delete(f);
}

// A la deconnexion : les donnees du compte ne restent pas sur le telephone
export async function viderCache() {
  try {
    const cles = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIXE_CACHE) || k === CLE_FILE);
    if (cles.length) await AsyncStorage.multiRemove(cles);
  } catch (e) {}
}

async function depuisCache(path, messageErreur) {
  try {
    const brut = await AsyncStorage.getItem(PREFIXE_CACHE + path);
    if (brut) {
      setHorsLigne(true);
      return JSON.parse(brut);
    }
  } catch (e) {}
  throw new Error(messageErreur);
}

async function request(path, options = {}) {
  const url = API_BASE + path;
  const headers = { 'Content-Type': 'application/json', 'X-LinkCI-Version': VERSION_APP };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const lecture = !options.method || options.method === 'GET';
  const enCache = lecture && _token && !PAS_EN_CACHE.some((re) => re.test(path));

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (e) {
    if (enCache) return depuisCache(path, 'Pas de connexion internet');
    setHorsLigne(true);
    throw new Error('Pas de connexion internet');
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    // Render (offre gratuite) renvoie une page HTML pendant le reveil du serveur (~50 s)
    if (enCache) return depuisCache(path, 'Le serveur demarre, reessaie dans une minute');
    throw new Error('Le serveur demarre, reessaie dans une minute');
  }
  setHorsLigne(false);
  if (enCache && res.ok) AsyncStorage.setItem(PREFIXE_CACHE + path, JSON.stringify(data)).catch(() => {});
  if ((res.status === 401 || res.status === 403) && _token && path !== '/api/login' && _surSessionExpiree) {
    if (res.status === 401 || /suspendu/i.test(data.error || '')) _surSessionExpiree(data.error);
  }
  if (!res.ok) {
    const erreur = new Error(data.error || 'Erreur réseau');
    erreur.status = res.status;
    erreur.data = data; // ex. { a_verifier: true, email } a la connexion
    throw erreur;
  }
  return data;
}

// Auth
export const register = (data) =>
  request('/api/register', { method: 'POST', body: JSON.stringify(data) });

export const login = (data) =>
  request('/api/login', { method: 'POST', body: JSON.stringify(data) });

// Verification de l'adresse e-mail (code a 6 chiffres)
export const verifierEmail = (email, code) =>
  request('/api/verifier_email', { method: 'POST', body: JSON.stringify({ email, code }) });
export const renvoyerCode = (email) =>
  request('/api/renvoyer_code', { method: 'POST', body: JSON.stringify({ email }) });

// Signalements et blocages
export const signalerPost = (id, motif) =>
  request(`/api/posts/${id}/signaler`, { method: 'POST', body: JSON.stringify({ motif }) });
export const bloquer = (id) => request(`/api/utilisateurs/${id}/bloquer`, { method: 'POST' });
export const debloquer = (id) => request(`/api/utilisateurs/${id}/bloquer`, { method: 'DELETE' });
export const getBloques = () => request('/api/bloques');

export const getMe = () => request('/api/me');

// Feed
export const getPosts = (page = 1, fac = false) => request(`/api/posts?page=${page}${fac ? '&fac=1' : ''}`);

// image : photo encodee en base64 (JPEG), optionnelle
// sondage : liste de 2 a 4 choix, optionnelle
export const createPost = (contenu, image = null, sondage = null) =>
  request('/api/posts', { method: 'POST', body: JSON.stringify({ contenu, ...(image ? { image } : {}), ...(sondage ? { sondage } : {}) }) });
export const reagir = (id, emoji) => request(`/api/posts/${id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const voter = (id, option_id) => request(`/api/posts/${id}/vote`, { method: 'POST', body: JSON.stringify({ option_id }) });

// Entraide
export const getQuestions = ({ filtre = '', matiere = '' } = {}) =>
  request(`/api/questions?filtre=${encodeURIComponent(filtre)}&matiere=${encodeURIComponent(matiere)}`);
export const poserQuestion = (q) => request('/api/questions', { method: 'POST', body: JSON.stringify(q) });
export const getQuestion = (id) => request(`/api/questions/${id}`);
export const repondre = (id, contenu) => request(`/api/questions/${id}/reponses`, { method: 'POST', body: JSON.stringify({ contenu }) });
export const voterReponse = (id) => request(`/api/reponses/${id}/vote`, { method: 'POST' });
export const meilleureReponse = (id, reponse_id) => request(`/api/questions/${id}/meilleure`, { method: 'POST', body: JSON.stringify({ reponse_id }) });
export const supprimerQuestion = (id) => request(`/api/questions/${id}`, { method: 'DELETE' });
export const getClassementEntraide = () => request('/api/entraide/classement');

// Administration (reserve aux admins)
export const getAdminStats = () => request('/api/admin/stats');
export const getAdminModeration = () => request('/api/admin/moderation');
export const modererProposition = (genre, id, decision) => request(`/api/admin/moderation/${genre}/${id}/${decision}`, { method: 'POST' });
export const ignorerSignalement = (postId) => request(`/api/admin/signalements/${postId}`, { method: 'POST' });
export const supprimerPostSignale = (postId) => request(`/api/admin/signalements/${postId}`, { method: 'DELETE' });
export const envoyerAnnonce = (message) => request('/api/admin/annonce', { method: 'POST', body: JSON.stringify({ message }) });
export const getAdminUtilisateurs = (q = '') => request(`/api/admin/utilisateurs?q=${encodeURIComponent(q)}`);
export const bannirUtilisateur = (id) => request(`/api/admin/utilisateurs/${id}/bannir`, { method: 'POST' });

// Parametres
export const getParametres = () => request('/api/parametres');
export const setParametres = (changement) => request('/api/parametres', { method: 'PUT', body: JSON.stringify(changement) });
export const changerMotDePasse = (actuel, nouveau) => request('/api/mot_de_passe', { method: 'POST', body: JSON.stringify({ actuel, nouveau }) });
export const deconnecterPartout = () => request('/api/deconnecter_partout', { method: 'POST' });
export const effacerConversation = (autreId) => request(`/api/conversations/${autreId}/effacer`, { method: 'POST' });
export const getContactAide = () => request('/api/aide/contact');
export const supprimerCompte = (mot_de_passe) => request('/api/supprimer_compte', { method: 'POST', body: JSON.stringify({ mot_de_passe }) });

// Stories (24 h)
export const getStories = () => request('/api/stories');
export const creerStory = (image, texte, fond = '') =>
  request('/api/stories', { method: 'POST', body: JSON.stringify({ ...(image ? { image } : {}), texte, fond }) });
export const voirStory = (id) => request(`/api/stories/${id}/vue`, { method: 'POST' });
export const getVuesStory = (id) => request(`/api/stories/${id}/vues`);
export const supprimerStory = (id) => request(`/api/stories/${id}`, { method: 'DELETE' });

// Adresse d'une image envoyee sur le serveur (ex. post.image)
export const imageUrl = (nom, dossier = 'uploads') => `${API_BASE}/static/${dossier}/${nom}`;

export const likePost = (postId) =>
  request(`/api/posts/${postId}/like`, { method: 'POST' });

export const getComments = (postId) =>
  request(`/api/posts/${postId}/comments`);

export const addComment = (postId, contenu) =>
  request(`/api/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ contenu }),
  });

export const deletePost = (postId) =>
  request(`/api/posts/${postId}`, { method: 'DELETE' });

// Bourses
export const getBourses = () => request('/api/bourses');

// Stages et emplois
export const getOpportunites = () => request('/api/opportunites');
export const creerOpportunite = (offre) => request('/api/opportunites', { method: 'POST', body: JSON.stringify(offre) });
export const getAlertesOpportunites = () => request('/api/opportunites/alertes');
export const setAlertesOpportunites = (types) => request('/api/opportunites/alertes', { method: 'PUT', body: JSON.stringify({ types }) });

// Petites annonces
export const getAnnonces = () => request('/api/annonces');
export const creerAnnonce = (annonce) => request('/api/annonces', { method: 'POST', body: JSON.stringify(annonce) });
export const annonceVendue = (id) => request(`/api/annonces/${id}/vendu`, { method: 'POST' });
export const supprimerAnnonce = (id) => request(`/api/annonces/${id}`, { method: 'DELETE' });
export const signalerAnnonce = (id, motif) => request(`/api/annonces/${id}/signaler`, { method: 'POST', body: JSON.stringify({ motif }) });

// Formations
export const getFormations = () => request('/api/formations');

// Messages
export const getConversations = () => request('/api/conversations');

export const getMessages = (avec) => request(`/api/messages?avec=${avec}`);

export const sendMessage = (destinataire_id, contenu, image = null, reponse_a = null, story_id = null) =>
  request('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ destinataire_id, contenu, ...(image ? { image } : {}), ...(reponse_a ? { reponse_a } : {}), ...(story_id ? { story_id } : {}) }),
  });
// Reagir (le meme emoji une 2e fois retire la reaction), supprimer pour tous, transferer
export const reagirMessage = (id, emoji) => request(`/api/messages/${id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const supprimerMessage = (id) => request(`/api/messages/${id}`, { method: 'DELETE' });
export const modifierMessage = (id, contenu) => request(`/api/messages/${id}`, { method: 'PUT', body: JSON.stringify({ contenu }) });
export const vocalEcoute = (id) => request(`/api/messages/${id}/ecoute`, { method: 'POST' });
export const getPresence = (id) => request(`/api/presence/${id}`);
export const rechercherMessages = (q) => request(`/api/messages/recherche?q=${encodeURIComponent(q)}`);
export const getMediasConversation = (id) => request(`/api/messages/medias?avec=${id}`);
export const getMediasGroupe = (id) => request(`/api/groupes/${id}/medias`);
// Fil : publications enregistrees et hashtags
export const enregistrerPost = (id, oui = true) => request(`/api/posts/${id}/enregistrer`, { method: oui ? 'POST' : 'DELETE' });
export const getPostsEnregistres = () => request('/api/posts/enregistres');
export const getPostsHashtag = (tag) => request(`/api/posts?tag=${encodeURIComponent(tag)}`);
export const transfererMessage = (id, destinataires) =>
  request(`/api/messages/${id}/transferer`, { method: 'POST', body: JSON.stringify({ destinataires }) });

// Classement et defis de la semaine
export const getClassement = (periode = 'semaine', portee = 'tous') => request(`/api/classement?periode=${periode}&portee=${portee}`);
export const getDefis = () => request('/api/defis');

// Notifications
export const getNotifications = () => request('/api/notifications');
export const markNotificationsRead = () => request('/api/notifications/lire', { method: 'POST' });
// { messages, notifications } non lus (pastilles des onglets)
export const getCompteurs = () => request('/api/compteurs');
// Notifications push : jeton Expo de ce telephone
export const registerPushToken = (token) =>
  request('/api/expo_push_token', { method: 'POST', body: JSON.stringify({ token }) });
export const deletePushToken = (token) =>
  request('/api/expo_push_token', { method: 'DELETE', body: JSON.stringify({ token }) });

// Profil
export const getProfile = (userId) => request(`/api/profil/${userId}`);

// Calendrier
export const getEvenements = (filtres = {}) => {
  const q = Object.entries(filtres).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return request(`/api/evenements${q ? `?${q}` : ''}`);
};
export const participerEvenement = (id, oui = true) =>
  request(`/api/evenements/${id}/participer`, { method: oui ? 'POST' : 'DELETE' });
export const getParticipantsEvenement = (id) => request(`/api/evenements/${id}/participants`);
export const getMonActivite = () => request('/api/mon_activite');
export const createEvenement = (data) =>
  request('/api/evenements', { method: 'POST', body: JSON.stringify(data) });
export const deleteEvenement = (id) =>
  request(`/api/evenements/${id}`, { method: 'DELETE' });

// Groupes
export const getGroupes = () => request('/api/groupes');
export const createGroupe = (data) =>
  request('/api/groupes', { method: 'POST', body: JSON.stringify(data) });
export const rejoindreGroupe = (id) =>
  request(`/api/groupes/${id}/rejoindre`, { method: 'POST' });
export const getGroupeMessages = (id) =>
  request(`/api/groupes/${id}/messages`);
// extra : { reponse_a, sondage: ['choix 1', 'choix 2'] }
export const sendGroupeMessage = (id, contenu, image = null, extra = {}) =>
  request(`/api/groupes/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ contenu, ...(image ? { image } : {}), ...extra }),
  });
export const getMembresGroupe = (id) => request(`/api/groupes/${id}/membres`);
export const modifierGroupe = (id, nom, description) =>
  request(`/api/groupes/${id}`, { method: 'PUT', body: JSON.stringify({ nom, description }) });
export const gererMembre = (id, uid, action) => request(`/api/groupes/${id}/membres/${uid}/${action}`, { method: 'POST' });
export const supprimerMessageGroupe = (id, mid) => request(`/api/groupes/${id}/messages/${mid}`, { method: 'DELETE' });
export const reagirMessageGroupe = (id, mid, emoji) =>
  request(`/api/groupes/${id}/messages/${mid}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const voterSondageGroupe = (id, mid, option_id) =>
  request(`/api/groupes/${id}/messages/${mid}/vote`, { method: 'POST', body: JSON.stringify({ option_id }) });
export const modifierMessageGroupe = (id, mid, contenu) =>
  request(`/api/groupes/${id}/messages/${mid}`, { method: 'PUT', body: JSON.stringify({ contenu }) });
export const quitterGroupe = (id) =>
  request(`/api/groupes/${id}/quitter`, { method: 'POST' });

// Documents
export const getDocuments = (filtres = {}) => {
  const q = Object.entries(filtres).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return request(`/api/documents${q ? `?${q}` : ''}`);
};
export const getFiltresDocuments = () => request('/api/documents/filtres');
export const voterDocument = (id) => request(`/api/documents/${id}/vote`, { method: 'POST' });
// Partage d'un document : fichier = { uri, name, mimeType } (expo-document-picker)
export async function uploadDocument({ titre, matiere, description, fichier, universite, filiere, type_doc }) {
  const form = new FormData();
  form.append('titre', titre);
  form.append('matiere', matiere || '');
  form.append('description', description || '');
  form.append('universite', universite || '');
  form.append('filiere', filiere || '');
  form.append('type_doc', type_doc || 'cours');
  form.append('fichier', { uri: fichier.uri, name: fichier.name, type: fichier.mimeType || 'application/octet-stream' });
  let res;
  try {
    // pas de Content-Type : fetch ajoute lui-meme la bonne frontiere multipart
    res = await fetch(API_BASE + '/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${_token}`, 'X-LinkCI-Version': VERSION_APP }, body: form });
  } catch (e) {
    throw new Error('Pas de connexion internet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Echec de l'envoi");
  return data;
}

// Adresse de telechargement temporaire (5 min) a ouvrir dans le navigateur
export const getDocumentUrl = async (id) => API_BASE + (await request(`/api/documents/${id}/lien`)).chemin;

// Mon profil : { prenom, nom, universite, filiere, annee, bio, avatar? (base64) }
export const updateProfile = (data) =>
  request('/api/profil', { method: 'PUT', body: JSON.stringify(data) });

// Recherche
export const searchAll = (q) => request(`/api/recherche?q=${encodeURIComponent(q)}`);
export const getDecouverte = () => request('/api/decouverte');
export const getVuesProfil = () => request('/api/profil/vues');
export const getInvitations = () => request('/api/invitations');

// Emploi du temps et examens
export const getEmploiDuTemps = () => request('/api/emploi_du_temps');
export const ajouterCours = (c) => request('/api/emploi_du_temps', { method: 'POST', body: JSON.stringify(c) });
export const supprimerCours = (id) => request(`/api/emploi_du_temps/${id}`, { method: 'DELETE' });
export const getExamens = () => request('/api/examens');
export const ajouterExamen = (e) => request('/api/examens', { method: 'POST', body: JSON.stringify(e) });
export const supprimerExamen = (id) => request(`/api/examens/${id}`, { method: 'DELETE' });
export const SITE = 'https://linkci.onrender.com';
export const suivre = (id) => request(`/api/utilisateurs/${id}/suivre`, { method: 'POST' });
export const nePlusSuivre = (id) => request(`/api/utilisateurs/${id}/suivre`, { method: 'DELETE' });

// Note vocale (fichier .m4a enregistre par le telephone), duree en secondes
export const envoyerVocal = (destinataire_id, uri, duree, reponse_a = null) =>
  envoyerAudio('/api/messages/vocal', uri, duree, reponse_a ? { destinataire_id, reponse_a } : { destinataire_id });
export const envoyerVocalGroupe = (groupeId, uri, duree) => envoyerAudio(`/api/groupes/${groupeId}/vocal`, uri, duree);

async function envoyerAudio(chemin, uri, duree, champs = {}) {
  const form = new FormData();
  Object.entries(champs).forEach(([k, v]) => form.append(k, String(v)));
  form.append('duree', String(Math.max(1, Math.round(duree))));
  form.append('audio', { uri, name: 'note.m4a', type: 'audio/mp4' });
  let res;
  try {
    res = await fetch(API_BASE + chemin, { method: 'POST', headers: { Authorization: `Bearer ${_token}`, 'X-LinkCI-Version': VERSION_APP }, body: form });
  } catch (e) {
    throw new Error('Pas de connexion internet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Echec de l'envoi");
  return data;
}
