import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import React, { PropsWithChildren, useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

/**
 * Silent auto-updates (v1.15.0, per product decision): no banner/modal.
 * When a newer versionCode is published the APK downloads in the background
 * and the system installer opens automatically.
 *
 * 10-Oct-2026 incident hardening kept:
 *  - falls back apkUrl -> downloadUrl
 *  - every rejected/failed check is logged (`[update] ...` in logcat)
 */
const LAST_CHECK_KEY = 'ump_last_app_update_check_v1';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly while app is in use
const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;

const currentVersionCode = () => Number(Application.nativeBuildVersion || 0);

const isSafeApkUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export const AppUpdateProvider = ({ children }: PropsWithChildren) => {
  const { booting, backendMode } = useAuth();
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const attemptedRef = useRef<number>(0);

  const autoUpdate = useCallback(async (force = false) => {
    if (Platform.OS !== 'android' || backendMode !== 'live' || checkingRef.current || installingRef.current) return;
    try {
      if (!force) {
        const lastCheck = Number(await AsyncStorage.getItem(LAST_CHECK_KEY) || 0);
        if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
      }
      checkingRef.current = true;
      const latest = await api.getAppRelease();
      await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      const candidateUrl = latest
        ? (latest.apkUrl || (latest as { downloadUrl?: string }).downloadUrl || '')
        : '';
      const code = Number(latest?.versionCode || 0);
      if (!latest || code <= currentVersionCode() || !isSafeApkUrl(candidateUrl)) {
        console.warn('[update] no update applied:', JSON.stringify({
          hasLatest: Boolean(latest),
          latestCode: code,
          currentCode: currentVersionCode(),
          hasSafeUrl: isSafeApkUrl(candidateUrl),
        }));
        return;
      }
      if (attemptedRef.current === code) return; // already tried this version this session
      attemptedRef.current = code;

      // Silent background download, then hand to the system installer.
      const destination = new File(Paths.cache, `UPM-${latest.version}-${code}.apk`);
      if (destination.exists) destination.delete();
      const apk = await File.downloadFileAsync(candidateUrl, destination, { idempotent: true });
      if (!apk.exists || Number(apk.size || 0) < 1_000_000) throw new Error('The update file was incomplete.');
      const contentUri = await LegacyFileSystem.getContentUriAsync(apk.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: APK_MIME,
        flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
      });
    } catch (updateError) {
      // Never block the app, never fail silently.
      console.warn('[update] auto-update failed:', updateError);
      attemptedRef.current = 0; // retry on next foreground
    } finally {
      checkingRef.current = false;
    }
  }, [backendMode]);

  useEffect(() => {
    if (booting || backendMode !== 'live') return;
    void autoUpdate(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void autoUpdate(false);
    });
    return () => subscription.remove();
  }, [backendMode, booting, autoUpdate]);

  return <>{children}</>;
};
