import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import * as api from '../api';
import AuthShell, { Field } from '../components/AuthShell';
import { PrimaryButton } from '../components/ui';
import { colors, spacing, creerStyles, useTheme } from '../theme';

export default function RegisterScreen({ navigation, onLogin }) {
  const styles = useStyles();
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [universite, setUniversite] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!nom.trim() || !prenom.trim() || !email.trim() || !password) {
      Alert.alert('Erreur', 'Prenom, nom, email et mot de passe sont requis');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Erreur', 'Le mot de passe doit faire au moins 8 caracteres');
      return;
    }
    setLoading(true);
    try {
      const data = await api.register({ nom: nom.trim(), prenom: prenom.trim(), email: email.trim(), mot_de_passe: password, universite: universite.trim() });
      api.setToken(data.token);
      onLogin(data.token);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setLoading(false);
  };

  return (
    <AuthShell titre="Rejoins LinkCI" sousTitre="Cree ton compte en quelques secondes.">
      <View style={styles.row}>
        <Field placeholder="Prenom" value={prenom} onChangeText={setPrenom} style={{ flex: 1 }} />
        <Field placeholder="Nom" value={nom} onChangeText={setNom} style={{ flex: 1 }} />
      </View>
      <Field icon="mail-outline" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field icon="lock-closed-outline" placeholder="Mot de passe (8 caracteres min.)" value={password} onChangeText={setPassword} secureTextEntry />
      <Field icon="school-outline" placeholder="Universite (optionnel)" value={universite} onChangeText={setUniversite} />
      <PrimaryButton title="Creer mon compte" onPress={handleRegister} loading={loading} style={{ marginTop: spacing.sm }} />
      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.link}>
        <Text style={styles.linkText}>Deja un compte ? <Text style={styles.linkStrong}>Connecte-toi</Text></Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const useStyles = creerStyles(({ colors, font, shadow }) => ({
  row: { flexDirection: 'row', gap: spacing.sm },
  link: { marginTop: spacing.xl, alignItems: 'center' },
  linkText: { color: colors.textMuted, fontSize: 14 },
  linkStrong: { fontWeight: '800', color: colors.primary },
}));
