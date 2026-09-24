// Mises a jour "over the air" (EAS Update) : le code JavaScript de l'app se met
// a jour sans reinstaller l'APK. Verification au demarrage et au retour dans l'app.
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';

const INTERVALLE = 30 * 60 * 1000; // pas plus d'une verification par demi-heure
let derniere = 0;
let enCours = false;

async function verifier() {
  if (__DEV__ || !Updates.isEnabled || enCours || Date.now() - derniere < INTERVALLE) return;
  enCours = true;
  derniere = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (!isAvailable) return;
    await Updates.fetchUpdateAsync();
    Alert.alert(
      'Nouvelle version de LinkCI',
      'Une mise a jour vient d\'etre telechargee. Redemarrer maintenant pour en profiter ?',
      [
        { text: 'Plus tard', style: 'cancel' }, // appliquee au prochain lancement
        { text: 'Redemarrer', onPress: () => Updates.reloadAsync().catch(() => {}) },
      ],
    );
  } catch (e) {
    // pas de reseau ou serveur indisponible : on reessaiera plus tard
  } finally {
    enCours = false;
  }
}

export function surveillerMisesAJour() {
  verifier();
  const abonnement = AppState.addEventListener('change', (etat) => { if (etat === 'active') verifier(); });
  return () => abonnement.remove();
}
