import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import React, { PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Card, PrimaryButton } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import type { AppRelease } from '../types';
import { useAuth } from './AuthContext';

const LAST_CHECK_KEY = 'ump_last_app_update_check_v1';
const DISMISSED_KEY = 'ump_dismissed_app_update_v1';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;
const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;

const currentVersionCode = () => Number(Application.nativeBuildVersion || 0);

const isSafeApkUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch { return false; }
};

export const AppUpdateProvider = ({ children }: PropsWithChildren) => {
  const { booting, backendMode } = useAuth();
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const checkingRef = useRef(false);
  const downloadingRef = useRef(false);

  const required = useMemo(() => Boolean(release && (
    release.forceUpdate || Number(release.minimumVersionCode || 0) > currentVersionCode()
  )), [release]);

  const checkForUpdate = useCallback(async (force = false) => {
    if (Platform.OS !== 'android' || backendMode !== 'live' || checkingRef.current || downloadingRef.current) return;
    try {
      if (!force) {
        const lastCheck = Number(await AsyncStorage.getItem(LAST_CHECK_KEY) || 0);
        if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
      }
      checkingRef.current = true;
      const latest = await api.getAppRelease();
      await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      if (!latest || Number(latest.versionCode || 0) <= currentVersionCode() || !isSafeApkUrl(latest.apkUrl)) return;
      let dismissed: { versionCode: number; dismissedAt: number } | null = null;
      try {
        const raw = await AsyncStorage.getItem(DISMISSED_KEY);
        dismissed = raw ? JSON.parse(raw) as { versionCode: number; dismissedAt: number } : null;
      } catch { dismissed = null; }
      const mandatory = Boolean(latest.forceUpdate || Number(latest.minimumVersionCode || 0) > currentVersionCode());
      if (!mandatory && dismissed?.versionCode === Number(latest.versionCode) && Date.now() - dismissed.dismissedAt < UPDATE_SNOOZE_MS) return;
      setError('');
      setRelease(latest);
    } catch {
      // Update checks must never block login when the manifest is temporarily unavailable.
    } finally {
      checkingRef.current = false;
    }
  }, [backendMode]);

  useEffect(() => {
    if (booting || backendMode !== 'live') return;
    checkForUpdate(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkForUpdate(false);
    });
    return () => subscription.remove();
  }, [backendMode, booting, checkForUpdate]);

  const later = async () => {
    if (!release || required) return;
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify({ versionCode: release.versionCode, dismissedAt: Date.now() }));
    setRelease(null);
  };

  const install = async () => {
    if (!release || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    setError('');
    try {
      const destination = new File(Paths.cache, `UPM-${release.version}-${release.versionCode}.apk`);
      if (destination.exists) destination.delete();
      const apk = await File.downloadFileAsync(release.apkUrl, destination, { idempotent: true });
      if (!apk.exists || Number(apk.size || 0) < 1_000_000) throw new Error('The update file was incomplete.');
      const contentUri = await LegacyFileSystem.getContentUriAsync(apk.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: APK_MIME,
        flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
      });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The update could not be installed automatically.');
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  };

  const openDownload = async () => {
    if (release?.apkUrl) await Linking.openURL(release.apkUrl);
  };

  return (
    <>
      {children}
      <Modal visible={Boolean(release)} transparent animationType="fade" onRequestClose={() => { if (!required) later(); }}>
        <View style={styles.overlay}>
          <Card style={styles.card}>
            <View style={styles.icon}><Text style={styles.iconText}>↑</Text></View>
            <Text style={styles.eyebrow}>{required ? 'REQUIRED UPDATE' : 'NEW VERSION AVAILABLE'}</Text>
            <Text style={styles.title}>Update to v{release?.version}</Text>
            <Text style={styles.copy}>{required ? 'This update is required to continue securely.' : 'Install the latest improvements without waiting for a Play Store release.'}</Text>
            {release?.releaseNotes ? <View style={styles.notes}><Text style={styles.notesTitle}>WHAT’S NEW</Text><Text style={styles.notesText}>{release.releaseNotes}</Text></View> : null}
            <View style={styles.versionRow}><Text style={styles.versionText}>Installed: v{Application.nativeApplicationVersion || '—'}</Text><Text style={styles.versionText}>New: v{release?.version}</Text></View>
            {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Text onPress={openDownload} style={styles.downloadLink}>Open direct download</Text></View> : null}
            {downloading ? <View style={styles.progress}><ActivityIndicator color={colors.primary} /><Text style={styles.progressText}>Downloading secure APK…</Text></View> : null}
            <PrimaryButton label={downloading ? 'Downloading update…' : 'Update now'} icon="cloud-download-outline" loading={downloading} onPress={install} />
            {!required && !downloading ? <PrimaryButton label="Later" variant="secondary" onPress={later} style={{ marginTop: spacing.sm }} /> : null}
            <Text style={styles.installHint}>Android will ask you to confirm the final installation.</Text>
          </Card>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(9,20,43,0.72)' },
  card: { borderRadius: radius.xl, padding: spacing.xl },
  icon: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  iconText: { color: colors.primary, fontSize: 32, lineHeight: 35, fontWeight: '900' },
  eyebrow: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.lg },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 3 },
  copy: { color: colors.inkSoft, fontSize: 11, lineHeight: 17, marginTop: spacing.sm },
  notes: { backgroundColor: colors.canvas, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  notesTitle: { color: colors.muted, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  notesText: { color: colors.inkSoft, fontSize: 10, lineHeight: 16, marginTop: spacing.sm },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: spacing.lg },
  versionText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm },
  progressText: { color: colors.primary, fontSize: 10, fontWeight: '800' },
  error: { backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.red, fontSize: 9, lineHeight: 14 },
  downloadLink: { color: colors.primary, fontSize: 9, fontWeight: '900', textDecorationLine: 'underline', marginTop: spacing.sm },
  installHint: { color: colors.muted, fontSize: 8, textAlign: 'center', marginTop: spacing.md },
});
