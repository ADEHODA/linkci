// Saisie du code a 6 chiffres recu par e-mail apres l'inscription
import React, { useState } from 'react';
import { Text, TouchableOpacity, Alert } from 'react-native';
import * as api from '../api';
import AuthShell, { Field } from '../components/AuthShell';
import { PrimaryButton } from '../components/ui';
import { spacing, creerStyles } from '../theme';

export default function VerifyEmailScreen({ route, navigation, onLogin }) {
  const styles = useStyles();
  const email = route.params?.email || '';
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  const valider = async () => {
    const chiffres = code.replace(/\D/g, '');
    if (chiffres.length !== 6) {
      Alert.alert('Code incomplet', 'Le code contient 6 chiffres.');
      return;
    }
    setLoading(true);
    try {
      const data = await api.verifierEmail(email, chiffres);
      api.setToken(data.token);
      onLogin(data.token);
    } catch (e) {
      Alert.alert('Verification', e.message);
      setLoading(false);
    }
  };

  const renvoyer = async () => {
    setEnvoi(true);
    try {
      await api.renvoyerCode(email);
      Alert.alert('Code renvoye', `Regarde ta boite ${email} (et les spams).`);
    } catch (e) {
      Alert.alert('Patiente un peu', e.message);
    }
    setEnvoi(false);
  };

  return (
    <AuthShell titre="Verifie ton e-mail" sousTitre={`Entre le code a 6 chiffres envoye a ${email}. Pense aux spams !`}>
      <Field
        icon="key-outline"
        placeholder="123456"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        onSubmitEditing={valider}
        style={styles.code}
      />
      <PrimaryButton title="Valider" icon="checkmark" onPress={valider} loading={loading} style={{ marginTop: spacing.sm }} />
      <TouchableOpacity onPress={renvoyer} disabled={envoi} style={styles.lien}>
        <Text style={styles.lienTexte}>{envoi ? 'Envoi...' : 'Renvoyer un code'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.lien}>
        <Text style={styles.retour}>Retour a la connexion</Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const useStyles = creerStyles(({ colors }) => ({
  code: { letterSpacing: 8 },
  lien: { marginTop: spacing.lg, alignItems: 'center' },
  lienTexte: { color: colors.primary, fontWeight: '800', fontSize: 15 },
  retour: { color: colors.textMuted, fontSize: 14 },
}));
