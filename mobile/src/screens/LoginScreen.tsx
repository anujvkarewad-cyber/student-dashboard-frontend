import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Alert,
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
import type { ApiMode } from '../api/client';
import { FormInput, PrimaryButton } from '../components/ui';
import { config } from '../config';
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

  const applyMode = async (mode: ApiMode) => {
    if (mode === backendMode || loading) return;
    setError('');
    setStudentId('');
    setPassword('');
    try { await switchBackendMode(mode); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not change data mode.'); }
  };

  const changeMode = (mode: ApiMode) => {
    if (mode === backendMode || loading) return;
    if (mode !== 'live') {
      applyMode(mode);
      return;
    }
    Alert.alert(
      'Enable Full live mode?',
      'The app will use real student data. Study logs, password changes and feedback updates will be sent to the existing mentorship backend.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enable Full live', onPress: () => applyMode('live') },
      ],
    );
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

  return (
    <LinearGradient colors={['#EEF3FF', '#F8FAFD', '#E9F8F5']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.brandRow}>
              <Image source={require('../../assets/icon.png')} style={styles.logo} />
              <View>
                <Text style={styles.brand}>Super 75</Text>
                <Text style={styles.brandSub}>BY UJJWAL</Text>
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
              <View style={styles.lockedLive}><View style={styles.lockedLiveIcon}><Ionicons name="cloud-done" size={21} color={colors.success} /></View><View style={styles.modeCopy}><Text style={styles.lockedLiveTitle}>Secure live connection</Text><Text style={styles.lockedLiveText}>Connected to Super 75 by Ujjwal</Text></View></View>
              <Text style={styles.formTitle}>Sign in to your account</Text>
              <FormInput
                label="Student ID"
                value={studentId}
                onChangeText={(value) => setStudentId(value.toUpperCase())}
                placeholder="Your student ID"
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

              {backendMode !== 'live-readonly' ? (
                <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgot}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </Pressable>
              ) : <Text style={styles.recoveryDisabled}>Password recovery is disabled in Live preview.</Text>}

              <PrimaryButton label="Sign in" icon="arrow-forward" loading={loading} onPress={() => submit()} />


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
  modeSwitch: { gap: spacing.sm },
  modeOption: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, padding: spacing.md },
  modeCopy: { flex: 1 },
  modeOptionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  liveModeActive: { borderColor: colors.success, backgroundColor: colors.tealSoft },
  fullLiveModeActive: { borderColor: colors.primary, backgroundColor: '#EEF3FF' },
  modeTitle: { color: colors.inkSoft, fontSize: 11, fontWeight: '800' },
  modeTitleActive: { color: colors.primaryDark },
  liveModeTitle: { color: colors.success },
  fullLiveModeTitle: { color: colors.primaryDark },
  modeSub: { color: colors.muted, fontSize: 8, lineHeight: 12, marginTop: 2 },
  readOnlyNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.tealSoft, borderRadius: radius.sm, padding: spacing.sm },
  readOnlyNoticeText: { flex: 1, color: colors.inkSoft, fontSize: 8, lineHeight: 13 },
  fullLiveNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.sm, padding: spacing.sm },
  fullLiveNoticeText: { flex: 1, color: colors.inkSoft, fontSize: 8, lineHeight: 13 },
  lockedLive: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: '#BFE5DB', padding: spacing.md },
  lockedLiveIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  lockedLiveTitle: { color: colors.success, fontSize: 12, fontWeight: '900' },
  lockedLiveText: { color: colors.inkSoft, fontSize: 8, marginTop: 3 },
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
