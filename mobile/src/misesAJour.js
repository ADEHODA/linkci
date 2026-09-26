// Mises a jour "over the air" (EAS Update), entierement automatiques, sans lien ni bouton :
// - verifiees a l'ouverture, a chaque retour dans l'app et toutes les 15 minutes ;
// - trouvee juste apres l'ouverture ou un retour dans l'app : rechargement immediat
//   (l'etudiant n'a encore rien commence) ;
// - trouvee plus tard : appliquee des que l'app passe en arriere-plan, pour ne jamais
//   couper l'etudiant au milieu d'un message ; il retrouve l'app a jour en revenant.
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const FENETRE = 30 * 1000; // rechargement immediat si l'app vient d'etre ouverte ou reprise
const INTERVALLE = 2 * 60 * 1000; // pas plus d'une verification toutes les 2 minutes
const PERIODE = 15 * 60 * 1000; // verification reguliere pendant que l'app reste ouverte
let activation = Date.now();
let derniere = 0;
let enCours = false;
let enAttente = false; // mise a jour telechargee, a appliquer des que possible

function appliquer() {
  Updates.reloadAsync().catch(() => {});
}

async function verifier() {
  if (__DEV__ || !Updates.isEnabled || enCours || Date.now() - derniere < INTERVALLE) return;
  if (enAttente) return appliquer();
  enCours = true;
  derniere = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    const { isNew } = await Updates.fetchUpdateAsync();
    if (!isNew) return;
    enAttente = true;
    if (Date.now() - activation < FENETRE || AppState.currentState !== 'active') appliquer();
  } catch (e) {
    // pas de reseau ou serveur indisponible : on reessaiera plus tard
  } finally {
    enCours = false;
  }
}

export function surveillerMisesAJour() {
  verifier();
  const minuteur = setInterval(verifier, PERIODE);
  let etatPrecedent = AppState.currentState;
  const abonnement = AppState.addEventListener('change', (etat) => {
    const retour = etat === 'active' && etatPrecedent !== 'active';
    etatPrecedent = etat;
    if (etat === 'background' && enAttente) appliquer(); // l'app quitte l'ecran : on en profite
    if (!retour) return;
    activation = Date.now();
    if (enAttente) appliquer();
    else verifier();
  });
  return () => { abonnement.remove(); clearInterval(minuteur); };
}
