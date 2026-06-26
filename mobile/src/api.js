const API_BASE = 'https://qasade.pythonanywhere.com';

let _token = null;

export function setToken(token) {
  _token = token;
}

export function getToken() {
  return _token;
}

async function request(path, options = {}) {
  const url = API_BASE + path;
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur réseau');
  return data;
}

// Auth
export const register = (data) =>
  request('/api/register', { method: 'POST', body: JSON.stringify(data) });

export const login = (data) =>
  request('/api/login', { method: 'POST', body: JSON.stringify(data) });

export const getMe = () => request('/api/me');

// Feed
export const getPosts = (page = 1) => request(`/api/posts?page=${page}`);

export const createPost = (contenu) =>
  request('/api/posts', { method: 'POST', body: JSON.stringify({ contenu }) });

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

// Recherche
export const searchAll = (q) => request(`/api/recherche?q=${encodeURIComponent(q)}`);
