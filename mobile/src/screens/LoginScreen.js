import React, { useState } from 'react';
import { Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import * as api from '../api';
import AuthShell, { Field } from '../components/AuthShell';
import { PrimaryButton } from '../components/ui';
import { colors, spacing } from '../theme';

export default function LoginScreen({ navigation, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Erreur', 'Email et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      const data = await api.login({ email: email.trim(), mot_de_passe: password });
      api.setToken(data.token);
      onLogin(data.token);
    } catch (e) {
      Alert.alert('Erreur', e.message);
    }
    setLoading(false);
  };

  return (
    <AuthShell titre="Content de te revoir" sousTitre="Connecte-toi pour retrouver ton campus.">
      <Field icon="mail-outline" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field icon="lock-closed-outline" placeholder="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={handleLogin} />
      <PrimaryButton title="Se connecter" onPress={handleLogin} loading={loading} style={{ marginTop: spacing.sm }} />
      <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.link}>
        <Text style={styles.linkText}>Pas encore de compte ? <Text style={styles.linkStrong}>Inscris-toi</Text></Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  link: { marginTop: spacing.xl, alignItems: 'center' },
  linkText: { color: colors.textMuted, fontSize: 14 },
  linkStrong: { fontWeight: '800', color: colors.primary },
});
