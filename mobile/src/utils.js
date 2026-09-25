const MOIS = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];

// Le serveur stocke les dates en UTC au format 'AAAA-MM-JJ HH:MM:SS'
export function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : ''));
  return isNaN(d) ? null : d;
}

// "a l'instant", "il y a 5 min", "il y a 3 h", "hier", "12 sept.", "12 sept. 2025"
export function dateRelative(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return "a l'instant";
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
  if (sec < 172800) return 'hier';
  const annee = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MOIS[d.getMonth()]}${annee}`;
}

// "14:05"
export function heure(s) {
  const d = parseDate(s);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Meme jour calendaire (heure locale du telephone)
export function memeJour(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  return !!da && !!db && da.toDateString() === db.toDateString();
}

// Separateur de discussion : "Aujourd'hui", "Hier", "12 sept.", "12 sept. 2025"
export function jourLisible(s) {
  const d = parseDate(s);
  if (!d) return '';
  const auj = new Date();
  const hier = new Date(auj.getTime() - 86400000);
  if (d.toDateString() === auj.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  const annee = d.getFullYear() !== auj.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MOIS[d.getMonth()]}${annee}`;
}

// "Bonjour", "Bon apres-midi", "Bonsoir" selon l'heure
export function salutation() {
  const h = new Date().getHours();
  return h < 12 ? 'Bonjour' : h < 18 ? 'Bon apres-midi' : 'Bonsoir';
}

// Ecran a ouvrir pour une notification ({ type, lien }) : [nomEcran, parametres] ou null
export function destinationNotification(n) {
  const profil = /\/profil\/(\d+)/.exec((n && n.lien) || '');
  if (profil) return ['ProfilEtudiant', { id: Number(profil[1]) }];
  const groupe = /\/groupes\/(\d+)/.exec((n && n.lien) || '');
  if (groupe) return ['Groupes', { ouvrir: Number(groupe[1]) }];
  const question = /\/entraide\/(\d+)/.exec((n && n.lien) || '');
  if (question) return ['Question', { id: Number(question[1]) }];
  const cibles = {
    message: ['Home', { screen: 'Messages' }], like: ['Home', { screen: 'Accueil' }],
    commentaire: ['Home', { screen: 'Accueil' }], mention: ['Home', { screen: 'Accueil' }],
    bourse: ['Bourses'], formation: ['Formations'], document: ['Documents'], opportunite: ['Opportunites'],
  };
  return (n && cibles[n.type]) || null;
}

export { MOIS };
