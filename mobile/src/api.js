import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE = 'https://linkci.onrender.com';

let _token = null;

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
    const cles = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIXE_CACHE));
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
  const headers = { 'Content-Type': 'application/json' };
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
export const getPosts = (page = 1) => request(`/api/posts?page=${page}`);

// image : photo encodee en base64 (JPEG), optionnelle
export const createPost = (contenu, image = null) =>
  request('/api/posts', { method: 'POST', body: JSON.stringify(image ? { contenu, image } : { contenu }) });

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

// Formations
export const getFormations = () => request('/api/formations');

// Messages
export const getConversations = () => request('/api/conversations');

export const getMessages = (avec) => request(`/api/messages?avec=${avec}`);

export const sendMessage = (destinataire_id, contenu) =>
  request('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ destinataire_id, contenu }),
  });

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
export const getEvenements = () => request('/api/evenements');
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
export const sendGroupeMessage = (id, contenu) =>
  request(`/api/groupes/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ contenu }),
  });
export const quitterGroupe = (id) =>
  request(`/api/groupes/${id}/quitter`, { method: 'POST' });

// Documents
export const getDocuments = () => request('/api/documents');
// Partage d'un document : fichier = { uri, name, mimeType } (expo-document-picker)
export async function uploadDocument({ titre, matiere, description, fichier }) {
  const form = new FormData();
  form.append('titre', titre);
  form.append('matiere', matiere || '');
  form.append('description', description || '');
  form.append('fichier', { uri: fichier.uri, name: fichier.name, type: fichier.mimeType || 'application/octet-stream' });
  let res;
  try {
    // pas de Content-Type : fetch ajoute lui-meme la bonne frontiere multipart
    res = await fetch(API_BASE + '/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${_token}` }, body: form });
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
