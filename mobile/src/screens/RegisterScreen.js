import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, Linking } from 'react-native';
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
  const [invitation, setInvitation] = useState('');
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
      const data = await api.register({ nom: nom.trim(), prenom: prenom.trim(), email: email.trim(), mot_de_passe: password, universite: universite.trim(), invitation: invitation.trim() });
      if (data.a_verifier) {
        navigation.navigate('VerifierEmail', { email: data.email });
      } else {
        api.setToken(data.token);
        onLogin(data.token);
      }
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
      <Field icon="ticket-outline" placeholder="Code d'invitation (optionnel)" value={invitation} onChangeText={setInvitation} autoCapitalize="characters" maxLength={12} />
      <PrimaryButton title="Creer mon compte" onPress={handleRegister} loading={loading} style={{ marginTop: spacing.sm }} />
      <Text style={styles.legal}>
        En creant un compte, tu acceptes les{' '}
        <Text style={styles.lienLegal} onPress={() => Linking.openURL(`${api.API_BASE}/conditions`)}>conditions d'utilisation</Text>
        {' '}et la{' '}
        <Text style={styles.lienLegal} onPress={() => Linking.openURL(`${api.API_BASE}/confidentialite`)}>politique de confidentialite</Text>.
      </Text>
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
  legal: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  lienLegal: { color: colors.primary, fontWeight: '700' },
}));
