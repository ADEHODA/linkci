// Partager un contenu LinkCI (WhatsApp, SMS...) avec un lien vers le site
import { Share } from 'react-native';
import { SITE } from './api';

export function partager(titre, chemin) {
  const lien = `${SITE}${chemin}`;
  return Share.share({ message: `${titre}\n\nSur LinkCI, le reseau des etudiants de Cote d'Ivoire : ${lien}`, url: lien }).catch(() => {});
}
