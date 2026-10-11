import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { AppUpdateOverlay } from '../components/AppUpdateOverlay';

/**
 * Auto-updates with VISIBLE status (v1.15.x, per product decision 11-Oct-2026).
 *
 * Earlier builds downloaded + installed fully silently, so when a download
 * stalled, the installer permission was missing, or the file was incomplete,
 * students saw nothing and reported "samajh nahi aata kya ho raha" / "stuck at
 * 100%". This version surfaces every stage:
 *
 *   checking -> downloading (live progress) -> ready (Install now) -> installing
 *                          \-> error (plain-language reason + Retry)
 *
 * Presentation:
 *  - forceUpdate  => blocking modal (cannot be dismissed until installed)
 *  - optional     => non-blocking top banner (dismissible)
 *
 * Hardening kept from the 10-Oct incident:
 *  - apkUrl -> downloadUrl fallback
 *  - size/integrity check after download (auto-retries transient truncation)
 *  - every rejection is still logged (`[update] ...` in logcat)
 *
 * Android only. On web/iOS the provider renders children untouched.
 */

const LAST_CHECK_KEY = 'ump_last_app_update_check_v1';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly while app is in use
const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;
const MIN_APK_BYTES = 1_000_000; // reject obviously-broken/empty downloads
const MAX_AUTO_RETRY = 2; // silent retries for transient truncation/network blips

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

export type AppUpdateUi = {
  phase: UpdatePhase;
  forceUpdate: boolean;
  version: string;
  versionCode: number;
  releaseNotes?: string;
  /** 0..1 when the server gave a Content-Length, otherwise -1 (indeterminate). */
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  errorTitle?: string;
  errorMessage?: string;
  /** true once an optional update's banner was dismissed by the user. */
  dismissed: boolean;
  canDismiss: boolean;
  install: () => void;
  retry: () => void;
  dismiss: () => void;
  openInstallSettings: () => void;
};

type Release = {
  version: string;
  versionCode: number;
  minimumVersionCode?: number;
  apkUrl?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
};

const NO_UI: AppUpdateUi = {
  phase: 'idle',
  forceUpdate: false,
  version: '',
  versionCode: 0,
  progress: -1,
  bytesWritten: 0,
  totalBytes: -1,
  dismissed: false,
  canDismiss: true,
  install: () => {},
  retry: () => {},
  dismiss: () => {},
  openInstallSettings: () => {},
};

const AppUpdateContext = createContext<AppUpdateUi>(NO_UI);

export const useAppUpdate = () => useContext(AppUpdateContext);

const currentVersionCode = () => Number(Application.nativeBuildVersion || 0);

const isSafeApkUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Turn a raw download/install failure into a plain-language reason + retry hint. */
function classifyError(raw: unknown): { title: string; message: string; transient: boolean } {
  const msg = String((raw as { message?: string })?.message || raw || '');
  const lower = msg.toLowerCase();
  if (/abort|timeout|timed out|cancelled|canceled/.test(lower)) {
    return {
      title: 'Download timed out',
      message: 'The connection dropped before the update finished. Move closer to your router or switch to mobile data, then retry.',
      transient: true,
    };
  }
  if (/enospc|no space|not enough (space|storage)|storage/.test(lower)) {
    return {
      title: 'Not enough storage',
      message: 'Your phone needs about 60 MB of free space for the update. Delete a few files and retry.',
      transient: false,
    };
  }
  if (/incomplete|corrupt|truncat|size mismatch|was not fully/.test(lower)) {
    return {
      title: 'Download incomplete',
      message: 'The file stopped before it finished (usually a weak network). Retrying will pick it up again.',
      transient: true,
    };
  }
  const httpCode = msg.match(/(?:http|status|code)\D{0,4}(\d{3})/i)?.[1];
  if (httpCode || /unabletodownload|server|gateway|bad gateway|service unavailable/.test(lower)) {
    return {
      title: httpCode ? `Server error (${httpCode})` : 'Server error',
      message: 'The update server could not serve the file right now. This is usually temporary — retry in a minute.',
      transient: true,
    };
  }
  if (/network|offline|enotfound|econn|socket|internet|unreachable|failed to connect|no address/.test(lower)) {
    return {
      title: 'No connection',
      message: 'We could not reach the update server. Check your internet (Wi-Fi works best) and retry.',
      transient: true,
    };
  }
  if (/install|package|parse|intent/.test(lower)) {
    return {
      title: 'Could not open the installer',
      message: 'Android blocked the installer. Allow "Install unknown apps" for UPM in Settings, then tap Install again.',
      transient: false,
    };
  }
  return {
    title: 'Update failed',
    message: msg || 'Something went wrong while updating. Please retry.',
    transient: true,
  };
}

export const AppUpdateProvider = ({ children }: PropsWithChildren) => {
  const { booting, backendMode } = useAuth();
  const [ui, setUi] = useState<AppUpdateUi>(NO_UI);

  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const attemptedRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const releaseRef = useRef<Release | null>(null);
  const apkFileRef = useRef<File | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const patch = useCallback((partial: Partial<AppUpdateUi>) => {
    if (!mountedRef.current) return;
    setUi((prev) => ({ ...prev, ...partial }));
  }, []);

  /** Launch the system installer for the downloaded APK. */
  const install = useCallback(async () => {
    const apk = apkFileRef.current;
    if (Platform.OS !== 'android' || !apk || installingRef.current) return;
    installingRef.current = true;
    patch({ phase: 'installing' });
    try {
      const contentUri = await LegacyFileSystem.getContentUriAsync(apk.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: APK_MIME,
        flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
      });
      // The installer is now in front of the user. Keep phase 'installing' so the
      // UI can offer help (e.g. allow unknown sources) when they come back.
    } catch (installError) {
      console.warn('[update] install intent failed:', installError);
      const info = classifyError(installError);
      patch({ phase: 'error', errorTitle: info.title, errorMessage: info.message });
      installingRef.current = false;
    }
  }, [patch]);

  /** Open Android's "Install unknown apps" settings for this package. */
  const openInstallSettings = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const pkg = Application.applicationId || '';
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
        pkg ? { data: `package:${pkg}` } : undefined,
      );
    } catch (settingsError) {
      console.warn('[update] could not open install settings:', settingsError);
      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.SECURITY_SETTINGS,
        );
      } catch {
        /* nothing else we can do */
      }
    }
  }, []);

  /** Download the APK with live progress + integrity check. Throws on failure. */
  const downloadApk = useCallback(async (release: Release) => {
    const url = String(release.apkUrl || release.downloadUrl || '');
    const destination = new File(Paths.cache, `UPM-${release.version}-${release.versionCode}.apk`);
    try {
      if (destination.exists) destination.delete();
    } catch {
      /* ignore stale-file cleanup errors */
    }

    let expectedBytes = -1;
    const apk = await File.downloadFileAsync(url, destination, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) expectedBytes = totalBytes;
        patch({
          phase: 'downloading',
          bytesWritten,
          totalBytes: totalBytes > 0 ? totalBytes : -1,
          progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : -1,
        });
      },
    });

    const size = Number((apk && apk.size) || 0);
    if (!apk || !apk.exists || size < MIN_APK_BYTES) {
      throw new Error('download incomplete: file missing or too small');
    }
    // If the server told us the total, the file must have fully arrived. A short
    // file is the "stuck at 100%" symptom - treat it as a retryable truncation.
    if (expectedBytes > 0 && size < expectedBytes) {
      throw new Error(`download incomplete: got ${size} of ${expectedBytes} bytes`);
    }
    apkFileRef.current = apk;
    return apk;
  }, [patch]);

  /** Full check -> download -> ready pipeline. */
  const runUpdate = useCallback(
    async (release: Release) => {
      releaseRef.current = release;
      const forceUpdate = Boolean(release.forceUpdate);
      patch({
        phase: 'downloading',
        forceUpdate,
        version: release.version,
        versionCode: release.versionCode,
        releaseNotes: release.releaseNotes,
        progress: -1,
        bytesWritten: 0,
        totalBytes: -1,
        errorTitle: undefined,
        errorMessage: undefined,
        dismissed: false,
        canDismiss: !forceUpdate,
      });

      try {
        await downloadApk(release);
        retryCountRef.current = 0;
        patch({ phase: 'ready', progress: 1 });
      } catch (downloadError) {
        console.warn('[update] download failed:', downloadError);
        const info = classifyError(downloadError);
        // Auto-retry transient failures a couple of times before bothering the user.
        if (info.transient && retryCountRef.current < MAX_AUTO_RETRY) {
          retryCountRef.current += 1;
          patch({ phase: 'downloading', progress: -1 });
          await new Promise((resolve) => setTimeout(resolve, 1200 * retryCountRef.current));
          return runUpdate(release);
        }
        patch({ phase: 'error', errorTitle: info.title, errorMessage: info.message });
      }
    },
    [downloadApk, patch],
  );

  const autoUpdate = useCallback(
    async (force = false) => {
      if (Platform.OS !== 'android' || backendMode !== 'live') return;
      if (checkingRef.current || installingRef.current) return;
      // Don't restart a download/ready/error the user is already looking at.
      if (ui.phase === 'downloading' || ui.phase === 'ready' || ui.phase === 'installing') return;
      try {
        if (!force) {
          const lastCheck = Number((await AsyncStorage.getItem(LAST_CHECK_KEY)) || 0);
          if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
        }
        checkingRef.current = true;
        patch({ phase: 'checking' });
        const latest = (await api.getAppRelease()) as Release | null;
        await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

        const candidateUrl = latest ? String(latest.apkUrl || latest.downloadUrl || '') : '';
        const code = Number(latest?.versionCode || 0);
        if (!latest || code <= currentVersionCode() || !isSafeApkUrl(candidateUrl)) {
          console.warn(
            '[update] no update applied:',
            JSON.stringify({
              hasLatest: Boolean(latest),
              latestCode: code,
              currentCode: currentVersionCode(),
              hasSafeUrl: isSafeApkUrl(candidateUrl),
            }),
          );
          patch({ phase: 'idle' });
          return;
        }
        if (attemptedRef.current === code && !force) {
          patch({ phase: 'idle' });
          return; // already handled this version this session
        }
        attemptedRef.current = code;
        retryCountRef.current = 0;
        await runUpdate(latest);
      } catch (checkError) {
        // Network/proxy failure while merely CHECKING should stay quiet unless an
        // update is already in flight - we don't want to nag on every cold start.
        console.warn('[update] update check failed:', checkError);
        patch({ phase: 'idle' });
      } finally {
        checkingRef.current = false;
      }
    },
    [backendMode, patch, runUpdate, ui.phase],
  );

  // Explicit user-triggered retry (bypasses the once-per-session guard).
  const retry = useCallback(() => {
    const release = releaseRef.current;
    retryCountRef.current = 0;
    installingRef.current = false;
    if (release) {
      void runUpdate(release);
    } else {
      attemptedRef.current = 0;
      void autoUpdate(true);
    }
  }, [autoUpdate, runUpdate]);

  const dismiss = useCallback(() => {
    // Only optional updates can be dismissed; the download keeps running and the
    // banner reappears when it is ready.
    setUi((prev) => (prev.forceUpdate ? prev : { ...prev, dismissed: true }));
  }, []);

  const value = useMemo<AppUpdateUi>(
    () => ({
      ...ui,
      install: () => void install(),
      retry,
      dismiss,
      openInstallSettings: () => void openInstallSettings(),
    }),
    [ui, install, retry, dismiss, openInstallSettings],
  );

  useEffect(() => {
    if (booting || backendMode !== 'live' || Platform.OS !== 'android') return;
    void autoUpdate(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void autoUpdate(false);
    });
    return () => subscription.remove();
  }, [backendMode, booting, autoUpdate]);

  // Dev-only preview harness (web + __DEV__ only; inactive in release builds and
  // on Android). Lets us visually QA the update UI without a device.
  //   EXPO_PUBLIC_UPDATE_DEMO=cycle  -> auto-cycles through every state
  //   EXPO_PUBLIC_UPDATE_DEMO=force-ready / ready / error / downloading / installing
  //   ?updateDemo=<same>             -> same, via query param (takes precedence)
  useEffect(() => {
    if (!(__DEV__ && Platform.OS === 'web')) return;
    const fromQuery =
      typeof window !== 'undefined' && window.location && window.location.search
        ? new URLSearchParams(window.location.search).get('updateDemo')
        : null;
    const demo = String(fromQuery || process.env.EXPO_PUBLIC_UPDATE_DEMO || '')
      .trim()
      .toLowerCase();
    if (!demo) return;

    const TOTAL = 54_630_381;
    const buildUi = (force: boolean, phase: UpdatePhase, progress: number): AppUpdateUi => ({
      ...NO_UI,
      phase,
      forceUpdate: force,
      version: '1.15.1',
      versionCode: 45,
      releaseNotes: 'Visible update progress, clear error reasons, and one-tap install.',
      canDismiss: !force,
      totalBytes: TOTAL,
      bytesWritten: progress >= 0 ? Math.round(TOTAL * progress) : 0,
      progress,
      errorTitle: phase === 'error' ? 'No connection' : undefined,
      errorMessage:
        phase === 'error'
          ? 'We could not reach the update server. Check your internet (Wi-Fi works best) and retry.'
          : undefined,
    });

    if (demo === 'cycle') {
      const seq: Array<[boolean, UpdatePhase]> = [
        [false, 'downloading'],
        [false, 'ready'],
        [false, 'error'],
        [true, 'downloading'],
        [true, 'ready'],
        [true, 'installing'],
        [true, 'error'],
      ];
      let idx = 0;
      let pct = 0.12;
      const render = () => {
        const [force, phase] = seq[idx];
        const progress = phase === 'downloading' ? pct : phase === 'error' ? -1 : 1;
        setUi(buildUi(force, phase, progress));
      };
      render();
      const timer = setInterval(() => {
        const [, phase] = seq[idx];
        if (phase === 'downloading') {
          pct += 0.14;
          if (pct >= 1) {
            pct = 0.12;
            idx = (idx + 1) % seq.length;
          }
        } else {
          idx = (idx + 1) % seq.length;
          pct = 0.12;
        }
        render();
      }, 1500);
      return () => clearInterval(timer);
    }

    const force = demo.startsWith('force');
    const phase = (demo.replace(/^force[-_]?/, '') || 'downloading') as UpdatePhase;
    if (phase === 'downloading') {
      let pct = 0.08;
      setUi(buildUi(force, phase, pct));
      const timer = setInterval(() => {
        pct = pct >= 0.96 ? 0.08 : pct + 0.04;
        setUi(buildUi(force, phase, pct));
      }, 400);
      return () => clearInterval(timer);
    }
    setUi(buildUi(force, phase, phase === 'error' ? -1 : 1));
    return undefined;
  }, []);

  const showOverlay = Platform.OS === 'android' || (__DEV__ && Platform.OS === 'web');

  return (
    <AppUpdateContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {showOverlay ? <AppUpdateOverlay ui={value} /> : null}
      </View>
    </AppUpdateContext.Provider>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
});
