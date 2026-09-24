import { useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

// Charge des donnees depuis l'API a chaque affichage de l'ecran, et gere
// l'actualisation en tirant vers le bas.
//   const { data, loading, refreshing, refresh, reload } = useApiList(api.getBourses, []);
export default function useApiList(fetcher, initial = []) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
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
