import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { ComponentType, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useData } from '../context/DataContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

const NativeWebView = Platform.OS === 'web'
  ? null
  : (require('react-native-webview').WebView as ComponentType<any>);

const getDriveFileId = (fileId?: string, url?: string) => {
  if (fileId?.trim()) return fileId.trim();
  const match = url?.match(/\/d\/([a-zA-Z0-9_-]+)/) || url?.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match?.[1] || '';
};

const hideDownloadControls = `
  (function protectPreview() {
    var style = document.createElement('style');
    style.innerHTML = [
      '[aria-label*="Download" i]',
      '[data-tooltip*="Download" i]',
      '[aria-label*="Print" i]',
      '[data-tooltip*="Print" i]',
      'a[download]',
      'a[href*="export=download"]',
      'a[href*="/uc?"]'
    ].join(',') + '{display:none!important;visibility:hidden!important;pointer-events:none!important;}';
    document.documentElement.appendChild(style);
    document.addEventListener('contextmenu', function(event) { event.preventDefault(); });
    document.addEventListener('dragstart', function(event) { event.preventDefault(); });
    new MutationObserver(function() {
      document.querySelectorAll('[aria-label*="Download" i],[data-tooltip*="Download" i],[aria-label*="Print" i],[data-tooltip*="Print" i],a[download],a[href*="export=download"],a[href*="/uc?"]').forEach(function(node) { node.remove(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  })();
  true;
`;

type Props = NativeStackScreenProps<RootStackParamList, 'NotePreview'>;

export const NotePreviewScreen = ({ route }: Props) => {
  const { data } = useData();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const note = data.studyNotes.find((item) => item.id === route.params.noteId);
  const driveId = getDriveFileId(note?.fileId, note?.url);
  const previewUrl = driveId ? `https://drive.google.com/file/d/${driveId}/preview` : '';

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const capture = require('expo-screen-capture') as typeof import('expo-screen-capture');
    capture.preventScreenCaptureAsync('protected-note-preview').catch(() => undefined);
    return () => { capture.allowScreenCaptureAsync('protected-note-preview').catch(() => undefined); };
  }, []);

  const iframe = useMemo(() => Platform.OS === 'web' && previewUrl
    ? React.createElement('iframe', {
        src: previewUrl,
        title: note?.title || 'Protected note preview',
        style: { width: '100%', height: '100%', border: 0, backgroundColor: '#FFFFFF' },
        sandbox: 'allow-scripts allow-same-origin allow-forms',
        onLoad: () => setLoading(false),
      })
    : null, [note?.title, previewUrl]);

  if (!note || !previewUrl) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.unavailable}>
          <View style={styles.unavailableIcon}><Ionicons name="lock-closed" size={28} color={colors.primary} /></View>
          <Text style={styles.unavailableTitle}>Protected preview unavailable</Text>
          <Text style={styles.unavailableText}>This sample note has no connected Drive preview. Live notes with a valid Drive file ID will open here without an app download button.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const allowNavigation = (url: string) => {
    const normalized = url.toLowerCase();
    if (normalized.includes('download') || normalized.includes('export=') || normalized.includes('/uc?')) {
      Alert.alert('Download disabled', 'Study material is available for in-app viewing only.');
      return false;
    }
    return url === 'about:blank' || /^https:\/\/(drive|docs)\.google\.com\//.test(url) || /^https:\/\/[^/]+\.(googleusercontent|gstatic)\.com\//.test(url);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.protectionBanner}>
        <View style={styles.shield}><Ionicons name="shield-checkmark" size={19} color={colors.success} /></View>
        <View style={styles.bannerCopy}><Text style={styles.bannerTitle}>Protected in-app preview</Text><Text style={styles.bannerText}>Download, print, external opening and screen capture are restricted.</Text></View>
      </View>
      <View style={styles.viewer}>
        {loading ? <View style={styles.loader}><ActivityIndicator color={colors.primary} /><Text style={styles.loaderText}>Opening protected material…</Text></View> : null}
        {failed ? <View style={styles.loader}><Ionicons name="alert-circle-outline" size={27} color={colors.red} /><Text style={styles.loaderText}>Preview could not be loaded. Check the Drive sharing permission.</Text></View> : null}
        {Platform.OS === 'web' ? iframe : NativeWebView ? (
          <NativeWebView
            source={{ uri: previewUrl }}
            style={styles.webview}
            originWhitelist={['https://*']}
            injectedJavaScript={hideDownloadControls}
            injectedJavaScriptBeforeContentLoaded={hideDownloadControls}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={() => { setLoading(false); setFailed(true); }}
            onShouldStartLoadWithRequest={(request: { url: string }) => allowNavigation(request.url)}
            onFileDownload={() => Alert.alert('Download disabled', 'Study material is available for in-app viewing only.')}
            allowsLinkPreview={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            textInteractionEnabled={false}
          />
        ) : null}
      </View>
      <Text style={styles.footer}>For stronger protection, the Drive owner must also disable download, print and copy for viewers.</Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, padding: spacing.md },
  protectionBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: '#C6EDE4', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  shield: { width: 37, height: 37, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: colors.success, fontSize: 12, fontWeight: '900' },
  bannerText: { color: colors.inkSoft, fontSize: 9, lineHeight: 14, marginTop: 2 },
  viewer: { flex: 1, overflow: 'hidden', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: spacing.md, padding: spacing.xl },
  loaderText: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  footer: { color: colors.muted, fontSize: 8, lineHeight: 12, textAlign: 'center', paddingTop: spacing.sm, paddingHorizontal: spacing.lg },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  unavailableIcon: { width: 62, height: 62, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  unavailableTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: spacing.lg },
  unavailableText: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: spacing.sm },
});
