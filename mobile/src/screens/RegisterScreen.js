import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api';

export default function RegisterScreen({ navigation, onLogin }) {
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [universite, setUniversite] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!nom.trim() || !prenom.trim() || !email.trim() || !password) {
      Alert.alert('Erreur', 'Tous les champs sont requis');
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.logo}>LINK CI</Text>
          <Text style={styles.subtitle}>Rejoins le reseau</Text>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <TextInput style={styles.input} placeholder="Prenom" value={prenom} onChangeText={setPrenom} />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <TextInput style={styles.input} placeholder="Nom" value={nom} onChangeText={setNom} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Ionicons name="mail-outline" size={18} color="#999" style={styles.icon} />
            <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          </View>

          <View style={styles.inputGroup}>
            <Ionicons name="lock-closed-outline" size={18} color="#999" style={styles.icon} />
            <TextInput style={styles.input} placeholder="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry />
          </View>

          <View style={styles.inputGroup}>
            <Ionicons name="school-outline" size={18} color="#999" style={styles.icon} />
            <TextInput style={styles.input} placeholder="Universite (optionnel)" value={universite} onChangeText={setUniversite} />
          </View>

          <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Creer mon compte</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.link}>
            <Text style={styles.linkText}>Deja un compte ? <Text style={{ fontWeight: '700', color: '#FF6B35' }}>Connecte-toi</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FF6B35' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 30, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 30, elevation: 10 },
  logo: { fontSize: 32, fontWeight: '900', color: '#FF6B35', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  row: { flexDirection: 'row', gap: 8 },
  inputGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F7F4', borderRadius: 10, marginBottom: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#EDEDEA' },
  icon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  btn: { backgroundColor: '#FF6B35', borderRadius: 50, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 16 },
  link: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#666', fontSize: 14 },
});
