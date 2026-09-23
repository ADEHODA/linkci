// Mise en page commune a la connexion et a l'inscription
import React from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

export default function AuthShell({ titre, sousTitre, children }) {
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.logoBox}><Ionicons name="school" size={34} color={colors.primary} /></View>
          <Text style={styles.logo}>LINK CI</Text>
          <Text style={styles.tagline}>Le reseau des etudiants de Cote d'Ivoire</Text>
        </View>
        <View style={styles.sheet}>
          <Text style={styles.titre}>{titre}</Text>
          <Text style={styles.sousTitre}>{sousTitre}</Text>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({ icon, style, ...props }) {
  return (
    <View style={[styles.field, style]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.textFaint} /> : null}
      <TextInput style={styles.input} placeholderTextColor={colors.textFaint} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  scroll: { flexGrow: 1, justifyContent: 'flex-end' },
  hero: { alignItems: 'center', paddingTop: 70, paddingBottom: 34, paddingHorizontal: spacing.xl },
  logoBox: { width: 68, height: 68, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  logo: { fontSize: 34, fontWeight: '900', color: colors.white, letterSpacing: 1 },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 4, textAlign: 'center' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xl, paddingBottom: 40 },
  titre: { fontSize: 24, fontWeight: '800', color: colors.text },
  sousTitre: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: spacing.xl },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: 14, marginBottom: spacing.md },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: colors.text },
});
