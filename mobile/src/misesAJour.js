// Mises a jour "over the air" (EAS Update), appliquees automatiquement :
// - trouvee dans les premieres secondes apres l'ouverture : l'app se recharge tout de suite ;
// - trouvee plus tard : appliquee au prochain retour dans l'app (apres un passage en
//   arriere-plan), pour ne jamais couper l'etudiant au milieu d'un message.
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const DEMARRAGE = Date.now();
const FENETRE_DEMARRAGE = 20 * 1000; // recharge immediate si l'app vient d'etre ouverte
const INTERVALLE = 10 * 60 * 1000; // une verification toutes les 10 minutes au plus
let derniere = 0;
let enCours = false;
let enAttente = false; // mise a jour telechargee, a appliquer au prochain retour

function appliquer() {
  Updates.reloadAsync().catch(() => {});
}

async function verifier() {
  if (__DEV__ || !Updates.isEnabled || enCours || enAttente || Date.now() - derniere < INTERVALLE) return;
  enCours = true;
  derniere = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    const { isNew } = await Updates.fetchUpdateAsync();
    if (!isNew) return;
    if (Date.now() - DEMARRAGE < FENETRE_DEMARRAGE) appliquer();
    else enAttente = true;
  } catch (e) {
    // pas de reseau ou serveur indisponible : on reessaiera plus tard
  } finally {
    enCours = false;
  }
}

export function surveillerMisesAJour() {
  verifier();
  let etatPrecedent = AppState.currentState;
  const abonnement = AppState.addEventListener('change', (etat) => {
    const retour = etat === 'active' && etatPrecedent !== 'active';
    etatPrecedent = etat;
    if (!retour) return;
    if (enAttente) appliquer();
    else verifier();
  });
  return () => abonnement.remove();
}
