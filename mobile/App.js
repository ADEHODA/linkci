import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import AppNavigator from './src/navigation/AppNavigator';
import { Alert } from 'react-native';
import { setToken, onSessionExpiree } from './src/api';
import { RealtimeProvider } from './src/realtime';
import { ThemeProvider, useTheme } from './src/theme';

export default function App() {
  const [token, setTokenState] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
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
    setToken(null);
    setTokenState(null);
    try { await SecureStore.deleteItemAsync('linkci_token'); } catch (e) {}
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

  if (!ready) return null;

  return (
    <ThemeProvider>
      <RealtimeProvider token={token}>
        <BarreDeStatut />
        <AppNavigator token={token} onLogin={handleLogin} onLogout={handleLogout} />
      </RealtimeProvider>
    </ThemeProvider>
  );
}

// Icones de la barre d'etat (heure, batterie) claires en mode sombre
function BarreDeStatut() {
  const { sombre } = useTheme();
  return <StatusBar style={sombre ? 'light' : 'dark'} />;
}
