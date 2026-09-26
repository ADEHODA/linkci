import { useState, useCallback, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { lireCache } from '../api';

// Charge des donnees depuis l'API a chaque affichage de l'ecran, et gere
// l'actualisation en tirant vers le bas.
//   const { data, loading, refreshing, refresh, reload } = useApiList(api.getBourses, []);
// Option : { cache: '/api/...' } affiche tout de suite la derniere version connue,
// puis la remplace par celle du serveur.
export default function useApiList(fetcher, initial = [], options = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const recu = useRef(false); // la reponse du serveur est arrivee : le cache ne doit plus l'ecraser

  useEffect(() => {
    if (!options.cache) return;
    lireCache(options.cache).then((d) => {
      if (d && !recu.current) {
        setData(options.transformer ? options.transformer(d) : d);
        setLoading(false);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      recu.current = true;
      setData(d);
    } catch (e) {
      // pas de reseau et rien en memoire : le bandeau "Hors connexion" suffit
      if (!/connexion internet|serveur demarre/i.test(e.message)) Alert.alert('Erreur', e.message);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return { data, setData, loading, refreshing, refresh, reload };
}
