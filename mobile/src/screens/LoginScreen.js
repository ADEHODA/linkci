import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';

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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>LINK CI</Text>
        <Text style={styles.subtitle}>Content de te revoir</Text>

        <View style={styles.inputGroup}>
          <Ionicons name="mail-outline" size={18} color="#999" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        </View>

        <View style={styles.inputGroup}>
          <Ionicons name="lock-closed-outline" size={18} color="#999" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry />
        </View>

        <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Se connecter</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.link}>
          <Text style={styles.linkText}>Pas de compte ? <Text style={{ fontWeight: '700', color: '#FF6B35' }}>Inscris-toi</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FF6B35', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 30, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 30, elevation: 10 },
  logo: { fontSize: 32, fontWeight: '900', color: '#FF6B35', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  inputGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F7F4', borderRadius: 10, marginBottom: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#EDEDEA' },
  icon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  btn: { backgroundColor: '#FF6B35', borderRadius: 50, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 16 },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#666', fontSize: 14 },
});
