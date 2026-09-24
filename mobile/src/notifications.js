// Notifications push : le telephone affiche les nouveautes meme quand l'app est fermee.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as api from './api';

// App ouverte : on affiche quand meme la notification (le temps reel met deja a jour les pastilles)
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let jetonActuel = null;

// Demande l'autorisation et enregistre ce telephone aupres du serveur. Silencieux en cas d'echec.
export async function activerNotifications() {
  try {
    if (!Device.isDevice) return null; // pas de push sur un emulateur
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'LinkCI',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#FF6B35',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    jetonActuel = data;
    await api.registerPushToken(data);
    return data;
  } catch (e) {
    return null;
  }
}

// A la deconnexion : ce telephone ne recoit plus les notifications de ce compte
export async function desactiverNotifications() {
  if (!jetonActuel) return;
  try { await api.deletePushToken(jetonActuel); } catch (e) {}
  jetonActuel = null;
}

// Appelle `ouvrir(data)` quand l'utilisateur touche une notification (y compris au lancement de l'app)
export function surNotificationTouchee(ouvrir) {
  Notifications.getLastNotificationResponseAsync().then((r) => {
    if (r) ouvrir(r.notification.request.content.data || {});
  }).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => ouvrir(r.notification.request.content.data || {}));
  return () => sub.remove();
}

// Rappel local (sans serveur) : ex. deadline d'une bourse. Renvoie l'identifiant du rappel.
export async function programmerRappel(titre, corps, date, data = {}) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted' || date <= new Date()) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title: titre, body: corps, data, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'default' },
  });
}

export async function annulerRappel(id) {
  if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
