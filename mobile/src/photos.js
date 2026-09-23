// Choix et preparation des photos avant envoi
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

const TAILLE_MAX = 1280; // pixels sur le plus grand cote
const QUALITE = 0.7;     // JPEG : ~150-300 Ko par photo (la base Neon gratuite fait 0,5 Go)

// source : 'galerie' ou 'camera'. carre : recadrage carre (photo de profil).
// Renvoie { uri, base64 } ou null si annule.
export async function choisirPhoto(source = 'galerie', { carre = false } = {}) {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Autorisation refusee', source === 'camera'
      ? "Autorise l'acces a l'appareil photo dans les reglages du telephone."
      : "Autorise l'acces aux photos dans les reglages du telephone.");
    return null;
  }

  const options = { mediaTypes: ['images'], quality: 1, ...(carre && { allowsEditing: true, aspect: [1, 1] }) };
  const resultat = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (resultat.canceled || !resultat.assets?.length) return null;

  // une photo de profil n'a pas besoin de plus de 512 px
  return compresser(resultat.assets[0], carre ? 512 : TAILLE_MAX);
}

async function compresser({ uri, width, height }, tailleMax) {
  const actions = [];
  if (width > tailleMax || height > tailleMax) {
    actions.push({ resize: width >= height ? { width: tailleMax } : { height: tailleMax } });
  }
  const photo = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: QUALITE,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return { uri: photo.uri, base64: photo.base64 };
}
