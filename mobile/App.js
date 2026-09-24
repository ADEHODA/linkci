import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import AppNavigator, { navigationRef } from './src/navigation/AppNavigator';
import { activerNotifications, desactiverNotifications, surNotificationTouchee } from './src/notifications';
import { destinationNotification } from './src/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLE_ACCUEIL } from './src/screens/OnboardingScreen';
import { Alert } from 'react-native';
import { setToken, onSessionExpiree, viderCache } from './src/api';
import BanniereReseau from './src/components/BanniereReseau';
import { RealtimeProvider } from './src/realtime';
import { ThemeProvider, useTheme } from './src/theme';

export default function App() {
  const [token, setTokenState] = useState(null);
  const [ready, setReady] = useState(false);
  const [accueilVu, setAccueilVu] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setAccueilVu(!!(await AsyncStorage.getItem(CLE_ACCUEIL).catch(() => '1')));
        const saved = await SecureStore.getItemAsync('linkci_token');
        if (saved) {
          setToken(saved);
          setTokenState(saved);
        }
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  const handleLogin = async (newToken) => {
    setToken(newToken);
    setTokenState(newToken);
    try { await SecureStore.setItemAsync('linkci_token', newToken); } catch (e) {}
  };

  const handleLogout = async () => {
    await desactiverNotifications(); // avant de perdre le jeton de session
    setToken(null);
    setTokenState(null);
    try { await SecureStore.deleteItemAsync('linkci_token'); } catch (e) {}
    await viderCache(); // les donnees du compte ne restent pas sur le telephone
  };

  // Session refusee par le serveur : retour a l'ecran de connexion, une seule fois
  useEffect(() => {
    let dejaPrevenu = false;
    onSessionExpiree(() => {
      if (dejaPrevenu) return;
      dejaPrevenu = true;
      handleLogout();
      Alert.alert('Session expiree', 'Pour ta securite, reconnecte-toi.', [{ text: 'OK', onPress: () => { dejaPrevenu = false; } }]);
    });
  }, []);

  // Connecte : on active les notifications push de ce telephone
  useEffect(() => {
    if (token) activerNotifications();
  }, [token]);

  // Toucher une notification ouvre le bon ecran (des que la navigation est prete)
  useEffect(() => surNotificationTouchee((data) => {
    const cible = destinationNotification(data);
    const ouvrir = () => {
      if (navigationRef.isReady()) navigationRef.navigate(...cible);
      else setTimeout(ouvrir, 300);
    };
    if (cible) ouvrir();
  }), []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RealtimeProvider token={token}>
          <BarreDeStatut />
          <AppNavigator token={token} onLogin={handleLogin} onLogout={handleLogout} accueilVu={accueilVu} />
          {token ? <BanniereReseau /> : null}
        </RealtimeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Icones de la barre d'etat (heure, batterie) claires en mode sombre
function BarreDeStatut() {
  const { sombre } = useTheme();
  return <StatusBar style={sombre ? 'light' : 'dark'} />;
}
