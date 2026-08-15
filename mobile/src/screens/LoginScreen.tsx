import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormInput, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen = ({ navigation }: Props) => {
  const { login, backendMode, switchBackendMode } = useAuth();
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const changeMode = async (mode: 'mock' | 'live-readonly') => {
    if (mode === backendMode || loading) return;
    setError('');
    setStudentId('');
    setPassword('');
    await switchBackendMode(mode);
  };

  const submit = async (id = studentId, secret = password) => {
    if (!id.trim() || !secret) {
      setError('Student ID and password are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(id, secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openDemo = () => {
    setStudentId('UMP2407');
    setPassword('demo123');
    submit('UMP2407', 'demo123');
  };

  return (
    <LinearGradient colors={['#EEF3FF', '#F8FAFD', '#E9F8F5']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.brandRow}>
              <Image source={require('../../assets/icon.png')} style={styles.logo} />
              <View>
                <Text style={styles.brand}>Ujjwal Pathak</Text>
                <Text style={styles.brandSub}>MENTORSHIP</Text>
              </View>
            </View>

            <View style={styles.welcome}>
              <View style={styles.badge}>
                <Ionicons name="sparkles" size={15} color={colors.primary} />
                <Text style={styles.badgeText}>YOUR STUDY COMPANION</Text>
              </View>
              <Text style={styles.title}>Welcome back,</Text>
              <Text style={styles.titleAccent}>future CA.</Text>
              <Text style={styles.subtitle}>Track focused hours, stay accountable and keep moving towards your goal.</Text>
            </View>

            <View style={styles.formCard}>
              <View style={styles.modeSection}>
                <Text style={styles.modeLabel}>DATA SOURCE</Text>
                <View style={styles.modeSwitch}>
                  <Pressable onPress={() => changeMode('mock')} style={[styles.modeOption, backendMode === 'mock' && styles.modeOptionActive]}>
                    <Ionicons name="shield-checkmark-outline" size={17} color={backendMode === 'mock' ? colors.primary : colors.muted} />
                    <View><Text style={[styles.modeTitle, backendMode === 'mock' && styles.modeTitleActive]}>Safe demo</Text><Text style={styles.modeSub}>Sample data</Text></View>
                  </Pressable>
                  <Pressable onPress={() => changeMode('live-readonly')} style={[styles.modeOption, backendMode === 'live-readonly' && styles.liveModeActive]}>
                    <Ionicons name="cloud-outline" size={17} color={backendMode === 'live-readonly' ? colors.success : colors.muted} />
                    <View><Text style={[styles.modeTitle, backendMode === 'live-readonly' && styles.liveModeTitle]}>Live read-only</Text><Text style={styles.modeSub}>Real data · no writes</Text></View>
                  </Pressable>
                </View>
                {backendMode === 'live-readonly' ? <View style={styles.readOnlyNotice}><Ionicons name="lock-closed" size={14} color={colors.success} /><Text style={styles.readOnlyNoticeText}>Connected backend reads only. Study submissions, password recovery and all server updates are blocked.</Text></View> : null}
              </View>
              <Text style={styles.formTitle}>{backendMode === 'mock' ? 'Sign in to safe demo' : 'Sign in to live read-only test'}</Text>
              <FormInput
                label="Student ID"
                value={studentId}
                onChangeText={(value) => setStudentId(value.toUpperCase())}
                placeholder="e.g. UMP2407"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
              />
              <View>
                <FormInput
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry={secure}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => submit()}
                  style={styles.passwordInput}
                />
                <Pressable style={styles.eye} onPress={() => setSecure((value) => !value)} hitSlop={12}>
                  <Ionicons name={secure ? 'eye-outline' : 'eye-off-outline'} size={21} color={colors.muted} />
                </Pressable>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={19} color={colors.red} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {backendMode === 'mock' ? (
                <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgot}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
              ) : <Text style={styles.recoveryDisabled}>Password recovery is disabled in read-only testing.</Text>}

              <PrimaryButton label="Sign in" icon="arrow-forward" loading={loading} onPress={() => submit()} />

              {backendMode === 'mock' ? (
                <View style={styles.demoArea}>
                  <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>SAFE PREVIEW</Text><View style={styles.line} /></View>
                  <PrimaryButton label="Explore demo dashboard" variant="secondary" icon="phone-portrait-outline" onPress={openDemo} disabled={loading} />
                  <Text style={styles.demoNote}>Demo mode uses local sample data and does not touch the live backend.</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.footer}>Build discipline. Create momentum. Achieve the rank.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 48, height: 48, borderRadius: 14 },
  brand: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  brandSub: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 2.2, marginTop: 2 },
  welcome: { marginTop: 42, marginBottom: spacing.xxl },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, marginBottom: spacing.lg },
  badgeText: { color: colors.primaryDark, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 39, lineHeight: 44, fontWeight: '900', letterSpacing: -1.5 },
  titleAccent: { color: colors.primary, fontSize: 39, lineHeight: 44, fontWeight: '900', letterSpacing: -1.5 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: spacing.md, maxWidth: 340 },
  formCard: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(220,228,240,0.9)', padding: spacing.xl, gap: spacing.lg, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 25, elevation: 5 },
  formTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: spacing.xs },
  modeSection: { gap: spacing.sm },
  modeLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  modeSwitch: { flexDirection: 'row', gap: spacing.sm },
  modeOption: { flex: 1, minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, padding: spacing.sm },
  modeOptionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  liveModeActive: { borderColor: colors.success, backgroundColor: colors.tealSoft },
  modeTitle: { color: colors.inkSoft, fontSize: 10, fontWeight: '800' },
  modeTitleActive: { color: colors.primaryDark },
  liveModeTitle: { color: colors.success },
  modeSub: { color: colors.muted, fontSize: 7, marginTop: 2 },
  readOnlyNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.tealSoft, borderRadius: radius.sm, padding: spacing.sm },
  readOnlyNoticeText: { flex: 1, color: colors.inkSoft, fontSize: 8, lineHeight: 13 },
  passwordInput: { paddingRight: 50 },
  eye: { position: 'absolute', right: 16, bottom: 15 },
  forgot: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  recoveryDisabled: { alignSelf: 'flex-end', color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: -4 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: colors.red, fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },
  demoArea: { gap: spacing.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { height: 1, backgroundColor: colors.border, flex: 1 },
  or: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  demoNote: { color: colors.muted, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  footer: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
