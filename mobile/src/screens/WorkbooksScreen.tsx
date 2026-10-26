import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../context/AuthContext';
import { config } from '../config';
import { practiceSession } from '../services/practiceTools';

/** Shared handwriting/typed workbook workspace; bearer stays in page memory, never a URL. */
export function WorkbooksScreen() {
  const { student, backendMode } = useAuth();
  const ref = useRef<WebView>(null);
  const identity = useRef(student?.studentId);
  const [error, setError] = useState('');
  useEffect(() => { identity.current = student?.studentId; return () => { identity.current = undefined; }; }, [student?.studentId]);
  if (backendMode !== 'live' || !student || !config.gatewayOrigin) return <View style={{ padding: 24 }}><Text>Workbooks require a signed-in live account and configured gateway. Existing study tools are unchanged.</Text></View>;
  const url = `${config.gatewayOrigin}/workbook.html`;
  if (Platform.OS === 'web') return <View style={{ padding: 24 }}><Text onPress={() => void Linking.openURL(url)}>Open the workbook workspace in the student web dashboard. Sign in there if prompted.</Text></View>;
  return <View style={{ flex: 1 }}>
    {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', padding: 12 }}>{error}</Text> : null}
    <WebView key={student.studentId} ref={ref} source={{ uri: url }} javaScriptEnabled domStorageEnabled startInLoadingState
      renderLoading={() => <ActivityIndicator style={{ margin: 20 }} />}
      originWhitelist={[config.gatewayOrigin, 'https://drive.google.com', 'https://docs.google.com', 'https://storage.googleapis.com']}
      allowsInlineMediaPlayback={false} mediaPlaybackRequiresUserAction setSupportMultipleWindows={false}
      onError={() => setError('Workbook workspace could not load. Your saved drafts have not been deleted.')}
      onShouldStartLoadWithRequest={request => {
        if (request.url === 'about:blank') return true;
        try {
          const target = new URL(request.url);
          if (request.isTopFrame === false) return target.protocol === 'https:' && ['drive.google.com', 'docs.google.com', 'storage.googleapis.com'].includes(target.hostname);
          return target.origin === new URL(config.gatewayOrigin).origin && target.pathname === '/workbook.html';
        } catch { return false; }
      }}
      onMessage={async event => {
        try {
          const source = new URL(event.nativeEvent.url);
          if (source.origin !== new URL(config.gatewayOrigin).origin || source.pathname !== '/workbook.html') return;
          if (JSON.parse(event.nativeEvent.data)?.type !== 'practice-ready') return;
          const expected = student.studentId;
          const session = await practiceSession('workbook');
          if (identity.current !== expected || session.studentId.toUpperCase() !== expected.toUpperCase()) return;
          ref.current?.postMessage(JSON.stringify({ type: 'practice-session', ...session }));
          setError('');
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Please reopen the workbook workspace.';
          setError(message); ref.current?.postMessage(JSON.stringify({ type: 'practice-session', error: message }));
        }
      }} />
  </View>;
}
