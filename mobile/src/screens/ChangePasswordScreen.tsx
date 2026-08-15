import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { FormInput, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;

export const ChangePasswordScreen = ({ navigation }: Props) => {
  const { student, updateSavedPassword, backendMode, completeRequiredPasswordChange, logout } = useAuth();
  const required = Boolean(student?.forcePasswordChange);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!current || !next || !confirm) { setError('Please complete all password fields.'); return; }
    if (next.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (next !== confirm) { setError('New password and confirmation do not match.'); return; }
    if (next === current) { setError('Choose a new password different from the current one.'); return; }
    if (!student) return;
    setError('');
    setLoading(true);
    try {
      const result = await api.changePassword(student.studentId, current, next);
      if (!result?.success) throw new Error(result?.message || 'Password could not be updated.');
      if (backendMode !== 'mock') await updateSavedPassword(next);
      Alert.alert('Password updated', backendMode === 'mock' ? 'Demo completed safely. Your live account was not changed.' : 'Your live account and encrypted sign-in session have been updated.', [
        { text: required ? 'Continue to dashboard' : 'Done', onPress: () => required ? completeRequiredPasswordChange() : navigation.goBack() },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Password could not be updated.');
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.icon}><Ionicons name="shield-checkmark-outline" size={32} color={colors.primary} /></View>
          <Text style={styles.title}>{required ? 'Create your private password' : 'Keep your account secure'}</Text>
          <Text style={styles.subtitle}>{required ? 'This is your first live sign-in. Change the temporary password before continuing.' : 'Use at least 6 characters and avoid passwords used on other apps.'}</Text>
          {required ? <View style={styles.requiredBanner}><Ionicons name="information-circle-outline" size={19} color="#94610B" /><Text style={styles.requiredBannerText}>Your dashboard will open immediately after the password is updated successfully.</Text></View> : null}
          <View style={styles.form}>
            <FormInput label="Current password" value={current} onChangeText={setCurrent} secureTextEntry placeholder="Enter current password" />
            <FormInput label="New password" value={next} onChangeText={setNext} secureTextEntry placeholder="At least 6 characters" />
            <FormInput label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Enter new password again" />
            {error ? <View style={styles.error}><Ionicons name="alert-circle" size={19} color={colors.red} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <PrimaryButton label={backendMode === 'live' ? 'Update live password' : 'Update password'} icon="key-outline" loading={loading} onPress={submit} />
            {required ? <PrimaryButton label="Sign out" icon="log-out-outline" variant="secondary" disabled={loading} onPress={logout} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { padding: spacing.xl, paddingTop: spacing.xxl },
  icon: { width: 67, height: 67, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.5, marginTop: spacing.xl },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  requiredBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl },
  requiredBannerText: { flex: 1, color: '#76561F', fontSize: 10, lineHeight: 15 },
  form: { marginTop: spacing.xxxl, gap: spacing.lg },
  error: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: colors.red, fontSize: 12, lineHeight: 18, flex: 1, fontWeight: '600' },
});
