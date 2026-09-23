// Test d'integration : le client socket.io de l'app recoit les messages du serveur Flask.
// Usage : node test_temps_reel.mjs http://127.0.0.1:5055
import { io } from 'socket.io-client';

const BASE = process.argv[2] || 'http://127.0.0.1:5055';
const api = async (path, opts = {}, token) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  });
  return res.json();
};
const inscrire = async (email) =>
  (await api('/api/register', { method: 'POST', body: JSON.stringify({ nom: 'Test', prenom: email.split('@')[0], email, mot_de_passe: 'password123' }) })).token;

const suffixe = Date.now();
const tokA = await inscrire(`a${suffixe}@test.ci`);
const tokB = await inscrire(`b${suffixe}@test.ci`);
const idB = (await api('/api/me', {}, tokB)).id;

const socketB = io(BASE, { auth: { token: tokB } });
const recus = [];
socketB.onAny((evt, data) => recus.push([evt, data]));
await new Promise((ok, ko) => { socketB.on('connected', ok); setTimeout(() => ko(new Error('pas de connexion')), 8000); });
console.log('B connecte, transport :', socketB.io.engine.transport.name);

const avant = await api('/api/compteurs', {}, tokB);
await api('/api/messages', { method: 'POST', body: JSON.stringify({ destinataire_id: idB, contenu: 'Bonjour B !' }) }, tokA);
await new Promise((ok) => setTimeout(ok, 1500));
const apres = await api('/api/compteurs', {}, tokB);

const msg = recus.find(([e]) => e === 'message_recu');
console.log('message_recu :', msg ? msg[1].contenu : 'AUCUN');
console.log('notification_update :', recus.some(([e]) => e === 'notification_update'));
console.log('compteurs avant', avant, 'apres', apres);
socketB.disconnect();
process.exit(msg && apres.messages === avant.messages + 1 ? 0 : 1);
