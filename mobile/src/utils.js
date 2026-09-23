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

export { MOIS };
