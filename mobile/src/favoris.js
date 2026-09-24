// Bourses favorites, gardees sur le telephone, avec un rappel avant la date limite.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { programmerRappel, annulerRappel } from './notifications';

const CLE = 'linkci_favoris_bourses'; // { [idBourse]: idRappel | null }

export async function lireFavoris() {
  try {
    return JSON.parse((await AsyncStorage.getItem(CLE)) || '{}');
  } catch (e) {
    return {};
  }
}

async function ecrire(favoris) {
  await AsyncStorage.setItem(CLE, JSON.stringify(favoris)).catch(() => {});
}

// Rappel a 9 h, 3 jours avant la date limite (ou la veille si c'est trop proche)
function dateDuRappel(deadline) {
  const limite = new Date(`${deadline}T09:00:00`);
  if (isNaN(limite)) return null;
  for (const joursAvant of [3, 1]) {
    const d = new Date(limite.getTime() - joursAvant * 86400000);
    if (d > new Date()) return { date: d, joursAvant };
  }
  return null;
}

// Ajoute ou retire des favoris. Renvoie { favori, rappel } (rappel : texte a afficher ou null)
export async function basculerFavori(bourse) {
  const favoris = await lireFavoris();
  const id = String(bourse.id);
  if (id in favoris) {
    await annulerRappel(favoris[id]);
    delete favoris[id];
    await ecrire(favoris);
    return { favori: false, rappel: null };
  }
  let idRappel = null;
  let rappel = null;
  const quand = bourse.deadline ? dateDuRappel(bourse.deadline) : null;
  if (quand) {
    try {
      idRappel = await programmerRappel(
        `Bourse : J-${quand.joursAvant}`,
        `« ${bourse.titre} » se termine le ${bourse.deadline}. N'oublie pas de postuler !`,
        quand.date,
        { type: 'bourse', lien: '/bourses' },
      );
      if (idRappel) rappel = `Rappel programme ${quand.joursAvant === 1 ? 'la veille' : '3 jours avant'} de la date limite.`;
    } catch (e) {}
  }
  favoris[id] = idRappel;
  await ecrire(favoris);
  return { favori: true, rappel };
}
