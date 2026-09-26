// Temps reel : connexion Socket.IO au serveur et compteurs des pastilles (messages, notifications)
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import * as api from './api';

const RealtimeContext = createContext({
  compteurs: { messages: 0, notifications: 0 },
  rafraichirCompteurs: () => {},
  abonner: () => () => {},
  emettre: () => {},
});

export function RealtimeProvider({ token, children }) {
  const [compteurs, setCompteurs] = useState({ messages: 0, notifications: 0 });
  const socketRef = useRef(null);
  const abonnes = useRef({}); // { evenement: Set(handlers) }

  const rafraichirCompteurs = useCallback(async () => {
    try {
      setCompteurs(await api.getCompteurs());
    } catch (e) {} // serveur endormi ou hors ligne : on reessaiera plus tard
  }, []);

  // Les ecrans s'abonnent aux evenements ; renvoie la fonction de desabonnement
  const abonner = useCallback((evenement, handler) => {
    if (!abonnes.current[evenement]) abonnes.current[evenement] = new Set();
    abonnes.current[evenement].add(handler);
    return () => abonnes.current[evenement]?.delete(handler);
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(api.API_BASE, { auth: { token }, reconnectionDelayMax: 10000 });
    socketRef.current = socket;
    const diffuser = (evenement) => (data) => abonnes.current[evenement]?.forEach((h) => h(data));

    socket.on('connect', rafraichirCompteurs);
    socket.on('notification_update', (data) => { rafraichirCompteurs(); diffuser('notification_update')(data); });
    socket.on('message_recu', (data) => { rafraichirCompteurs(); diffuser('message_recu')(data); });
    socket.on('groupe_message', diffuser('groupe_message'));
    socket.on('typing_indicator', diffuser('typing_indicator')); // "en train d'ecrire..."
    socket.on('messages_lus', diffuser('messages_lus')); // "Vu" en direct
    socket.on('message_maj', diffuser('message_maj')); // reaction ou message supprime pour tous

    // Au retour dans l'app (et toutes les minutes en secours) : compteurs a jour
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') {
        rafraichirCompteurs();
        if (!socket.connected) socket.connect();
      }
    });
    const minuterie = setInterval(rafraichirCompteurs, 60000);
    rafraichirCompteurs();

    return () => {
      sub.remove();
      clearInterval(minuterie);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, rafraichirCompteurs]);

  // Envoie un evenement au serveur (ignore si la connexion temps reel est coupee)
  const emettre = useCallback((evenement, data) => {
    if (socketRef.current?.connected) socketRef.current.emit(evenement, data);
  }, []);

  return (
    <RealtimeContext.Provider value={{ compteurs, rafraichirCompteurs, abonner, emettre }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export const useRealtime = () => useContext(RealtimeContext);

// Raccourci : useEvenement('message_recu', (data) => ...)
export function useEvenement(evenement, handler) {
  const { abonner } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => abonner(evenement, (data) => ref.current(data)), [abonner, evenement]);
}
