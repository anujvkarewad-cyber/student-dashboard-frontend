import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing } from '../theme';
import { PrimaryButton } from './ui';
import type { AppUpdateUi } from '../context/AppUpdateContext';

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Visible auto-update UI driven by AppUpdateContext.
 *  - forceUpdate  -> blocking, non-dismissible modal
 *  - optional     -> non-blocking top banner (dismissible)
 * Purely presentational: all logic lives in the context. Renders nothing while
 * idle/checking so a normal cold start is never interrupted by a flash of UI.
 */
export const AppUpdateOverlay = ({ ui }: { ui: AppUpdateUi }) => {
  const insets = useSafeAreaInsets();
  const { phase, forceUpdate, dismissed } = ui;

  if (phase === 'idle' || phase === 'checking') return null;
  if (!forceUpdate && dismissed && phase !== 'error') return null;

  const card = (
    <View style={styles.card}>
      <Header ui={ui} />
      {phase === 'downloading' ? <Progress ui={ui} /> : null}
      <Body ui={ui} />
      <Actions ui={ui} />
    </View>
  );

  if (forceUpdate) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.backdrop}>
          <View style={styles.modalWrap}>{card}</View>
        </View>
      </Modal>
    );
  }

  return (
    <View pointerEvents="box-none" style={[styles.bannerWrap, { top: insets.top + spacing.sm }]}>
      <View style={styles.bannerInner}>{card}</View>
    </View>
  );
};

const Header = ({ ui }: { ui: AppUpdateUi }) => {
  const icon = headerIcon(ui.phase);
  const title = headerTitle(ui);
  return (
    <View style={styles.header}>
      <View style={[styles.iconBubble, { backgroundColor: icon.bg }]}>
        {ui.phase === 'installing' ? (
          <ActivityIndicator size="small" color={icon.fg} />
        ) : (
          <Ionicons name={icon.name} size={20} color={icon.fg} />
        )}
      </View>
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        {ui.version ? <Text style={styles.subtitle}>Version {ui.version}</Text> : null}
      </View>
      {ui.canDismiss && ui.phase !== 'downloading' ? (
        <Pressable hitSlop={10} onPress={ui.dismiss} accessibilityRole="button" accessibilityLabel="Dismiss update">
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
};

const Progress = ({ ui }: { ui: AppUpdateUi }) => {
  const determinate = ui.progress >= 0;
  const pct = determinate ? Math.round(ui.progress * 100) : null;
  return (
    <View style={styles.progressBlock}>
      <View style={styles.track}>
        {determinate ? (
          <View style={[styles.fill, { width: `${Math.max(4, pct || 0)}%` }]} />
        ) : (
          <View style={[styles.fill, styles.indeterminate]} />
        )}
      </View>
      <Text style={styles.progressLabel}>
        {determinate
          ? `${pct}%${ui.totalBytes > 0 ? `  •  ${mb(ui.bytesWritten)} of ${mb(ui.totalBytes)}` : ''}`
          : 'Downloading… (size unknown)'}
      </Text>
    </View>
  );
};

const Body = ({ ui }: { ui: AppUpdateUi }) => {
  if (ui.phase === 'error') {
    return <Text style={styles.bodyError}>{ui.errorMessage || 'Please retry the update.'}</Text>;
  }
  if (ui.phase === 'installing') {
    return (
      <Text style={styles.body}>
        If Android asks, allow UPM to install apps, then tap Install in the system dialog. Nothing
        is lost if you step away — the update stays ready.
      </Text>
    );
  }
  if (ui.phase === 'ready') {
    return (
      <Text style={styles.body}>
        The new version is downloaded and verified. Tap Install — you may be asked to allow UPM to
        install apps the first time.
      </Text>
    );
  }
  // downloading
  return (
    <>
      <Text style={styles.body}>
        Please keep the app open and stay on Wi-Fi if you can. This usually takes a minute.
      </Text>
      {ui.statusNote ? <Text style={styles.note}>{ui.statusNote}</Text> : null}
    </>
  );
};

const Actions = ({ ui }: { ui: AppUpdateUi }) => {
  const { phase } = ui;
  if (phase === 'downloading') {
    return (
      <View style={styles.actions}>
        <Pressable onPress={ui.openInBrowser} style={styles.hideLink} accessibilityRole="button">
          <Text style={styles.hideLinkText}>Taking too long? Download in browser</Text>
        </Pressable>
        {ui.canDismiss ? (
          <Pressable onPress={ui.dismiss} style={styles.hideLink} accessibilityRole="button">
            <Text style={styles.hideLinkText}>Hide (keeps downloading)</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (phase === 'ready') {
    return (
      <View style={styles.actions}>
        <PrimaryButton label="Install now" icon="download-outline" onPress={ui.install} />
        {ui.canDismiss ? (
          <PrimaryButton label="Later" variant="secondary" onPress={ui.dismiss} style={styles.secondaryAction} />
        ) : null}
      </View>
    );
  }
  if (phase === 'installing') {
    return (
      <View style={styles.actions}>
        <PrimaryButton label="Open installer again" icon="refresh" onPress={ui.install} />
        <PrimaryButton
          label="Allow installing apps"
          icon="shield-checkmark-outline"
          variant="secondary"
          onPress={ui.openInstallSettings}
          style={styles.secondaryAction}
        />
        <Pressable onPress={ui.openInBrowser} style={styles.hideLink} accessibilityRole="button">
          <Text style={styles.hideLinkText}>Install not showing up? Download in browser</Text>
        </Pressable>
      </View>
    );
  }
  // error
  return (
    <View style={styles.actions}>
      <PrimaryButton label="Retry" icon="refresh" onPress={ui.retry} />
      <PrimaryButton
        label="Download in browser"
        icon="open-outline"
        variant="secondary"
        onPress={ui.openInBrowser}
        style={styles.secondaryAction}
      />
      <PrimaryButton
        label="Allow installing apps"
        icon="shield-checkmark-outline"
        variant="secondary"
        onPress={ui.openInstallSettings}
        style={styles.secondaryAction}
      />
      {ui.canDismiss ? (
        <Pressable onPress={ui.dismiss} style={styles.hideLink} accessibilityRole="button">
          <Text style={styles.hideLinkText}>Dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

function headerIcon(phase: AppUpdateUi['phase']): { name: keyof typeof Ionicons.glyphMap; fg: string; bg: string } {
  switch (phase) {
    case 'ready':
      return { name: 'checkmark-circle', fg: colors.success, bg: '#E7F6EF' };
    case 'error':
      return { name: 'alert-circle', fg: colors.red, bg: colors.redSoft };
    case 'installing':
      return { name: 'phone-portrait-outline', fg: colors.primary, bg: colors.primarySoft };
    default:
      return { name: 'cloud-download-outline', fg: colors.primary, bg: colors.primarySoft };
  }
}

function headerTitle(ui: AppUpdateUi): string {
  switch (ui.phase) {
    case 'ready':
      return 'Update ready to install';
    case 'error':
      return ui.errorTitle || 'Update failed';
    case 'installing':
      return 'Opening the installer…';
    default:
      return ui.forceUpdate ? 'Update required' : 'Updating UPM';
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,35,63,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalWrap: { width: '100%', maxWidth: 420 },
  bannerWrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    elevation: 12,
  },
  bannerInner: { ...shadow },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  progressBlock: { marginTop: spacing.lg },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  indeterminate: { width: '40%', opacity: 0.7 },
  progressLabel: { marginTop: spacing.sm, fontSize: 12.5, color: colors.inkSoft, fontWeight: '600' },
  body: { marginTop: spacing.md, fontSize: 13.5, lineHeight: 19, color: colors.inkSoft },
  note: { marginTop: spacing.xs, fontSize: 12.5, lineHeight: 17, color: colors.muted, fontWeight: '600' },
  bodyError: { marginTop: spacing.md, fontSize: 13.5, lineHeight: 19, color: colors.red },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  secondaryAction: { marginTop: 0 },
  hideLink: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: 4 },
  hideLinkText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
});
