import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { FormInput, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;
type Stage = 'identity' | 'otp' | 'reset' | 'done';

export const ForgotPasswordScreen = ({ navigation }: Props) => {
  const { backendMode } = useAuth();
  const [stage, setStage] = useState<Stage>('identity');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async (operation: () => Promise<void>) => {
    setError('');
    setLoading(true);
    try { await operation(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally { setLoading(false); }
  };

  const sendOtp = () => run(async () => {
    if (!studentId.trim() || !email.trim()) throw new Error('Enter your Student ID and registered email.');
    const result = await api.forgotPassword(studentId.trim().toUpperCase(), email.trim());
    if (result?.success === false) throw new Error(result.message || 'Unable to send OTP.');
    setStage('otp');
  });

  const verify = () => run(async () => {
    if (!/^\d{6}$/.test(otp)) throw new Error('Enter the complete 6-digit OTP.');
    const result = await api.verifyOTP(studentId.trim().toUpperCase(), otp);
    if (!result?.success) throw new Error(result?.message || 'OTP verification failed.');
    setStage('reset');
  });

  const reset = () => run(async () => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (password !== confirmPassword) throw new Error('Passwords do not match.');
    const result = await api.resetPassword(studentId.trim().toUpperCase(), password);
    if (!result?.success) throw new Error(result?.message || 'Password could not be reset.');
    setStage('done');
  });

  const copy: Record<Stage, { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }> = {
    identity: { icon: 'mail-outline', title: 'Reset your password', subtitle: 'We will send a verification code to your registered email.' },
    otp: { icon: 'keypad-outline', title: 'Check your email', subtitle: `Enter the 6-digit code sent for ${studentId.toUpperCase()}.` },
    reset: { icon: 'lock-closed-outline', title: 'Create new password', subtitle: 'Choose a strong password you have not used before.' },
    done: { icon: 'checkmark-circle-outline', title: 'Password updated', subtitle: 'You can now sign in with your new password.' },
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.icon}><Ionicons name={copy[stage].icon} size={31} color={colors.primary} /></View>
          <Text style={styles.title}>{copy[stage].title}</Text>
          <Text style={styles.subtitle}>{copy[stage].subtitle}</Text>

          {backendMode === 'mock' && stage === 'otp' ? <Text style={styles.demoHint}>Safe demo OTP: 123456</Text> : null}

          <View style={styles.form}>
            {stage === 'identity' ? (
              <>
                <FormInput label="Student ID" value={studentId} onChangeText={(v) => setStudentId(v.toUpperCase())} autoCapitalize="characters" placeholder="UMP0000" />
                <FormInput label="Registered email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
                <PrimaryButton label="Send verification code" icon="paper-plane-outline" onPress={sendOtp} loading={loading} />
              </>
            ) : null}
            {stage === 'otp' ? (
              <>
                <FormInput label="6-digit OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="••••••" style={styles.otp} />
                <PrimaryButton label="Verify code" onPress={verify} loading={loading} />
              </>
            ) : null}
            {stage === 'reset' ? (
              <>
                <FormInput label="New password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" />
                <FormInput label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholder="Enter it again" />
                <PrimaryButton label="Update password" onPress={reset} loading={loading} />
              </>
            ) : null}
            {stage === 'done' ? <PrimaryButton label="Back to sign in" icon="arrow-back" onPress={() => navigation.navigate('Login')} /> : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: spacing.xl, paddingTop: 50 },
  icon: { width: 68, height: 68, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  title: { color: colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.7 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: spacing.sm, maxWidth: 340 },
  form: { marginTop: spacing.xxxl, gap: spacing.lg },
  error: { color: colors.red, backgroundColor: colors.redSoft, padding: spacing.md, borderRadius: radius.md, fontSize: 13, lineHeight: 18 },
  demoHint: { color: colors.primaryDark, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg, fontWeight: '800' },
  otp: { fontSize: 25, letterSpacing: 10, textAlign: 'center', fontWeight: '800' },
});
