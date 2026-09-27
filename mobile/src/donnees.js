// Mode "economie de donnees" : photos chargees seulement quand on les touche, envois plus legers.
// Garde sur le telephone.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CLE = 'linkci_economie_donnees';
let actif = false;
const abonnes = new Set();

AsyncStorage.getItem(CLE).then((v) => { actif = v === '1'; abonnes.forEach((f) => f(actif)); }).catch(() => {});

export const economieActive = () => actif;

export function changerEconomie(oui) {
  actif = !!oui;
  abonnes.forEach((f) => f(actif));
  AsyncStorage.setItem(CLE, actif ? '1' : '0').catch(() => {});
}

export function useEconomie() {
  const [valeur, setValeur] = useState(actif);
  useEffect(() => {
    abonnes.add(setValeur);
    setValeur(actif);
    return () => abonnes.delete(setValeur);
  }, []);
  return valeur;
}
