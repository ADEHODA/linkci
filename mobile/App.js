import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import AppNavigator from './src/navigation/AppNavigator';
import { setToken } from './src/api';
import { RealtimeProvider } from './src/realtime';

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

  if (!ready) return null;

  return (
    <RealtimeProvider token={token}>
      <StatusBar style="dark" />
      <AppNavigator token={token} onLogin={handleLogin} onLogout={handleLogout} />
    </RealtimeProvider>
  );
}
