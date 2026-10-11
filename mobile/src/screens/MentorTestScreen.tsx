import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, ErrorBanner, PrimaryButton } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import {
  fetchPdfBase64,
  getPaperMeta,
  MAX_UPLOAD_BYTES,
  submitMcqAnswers,
  submitSelfMarks,
  uploadAnswerSheet,
  type PaperMeta,
} from '../services/mentorTests';
import { PDF_VIEWER_HTML } from '../services/pdfViewerBundle';
import { colors, radius, spacing } from '../theme';

// react-native-webview has no web implementation - load it lazily like NotePreviewScreen.
const NativeWebView: any =
  Platform.OS === 'web' ? null : (require('react-native-webview').WebView as any);

/** Same helper as NotePreviewScreen - notes aur papers dono Drive files hain. */
const getDriveFileId = (url?: string | null) => {
  if (!url) return '';
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match?.[1] || '';
};

/** Proven in NotePreviewScreen: hide Drive's download/print/export controls. */
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

const zoomScript = (value: number) => `
  (function applyProtectedPreviewZoom() {
    var scale = ${value / 100};
    document.documentElement.style.setProperty('zoom', String(scale), 'important');
  })();
  true;
`;

/**
 * Mentor Test screen - simple two-action format (owner-approved):
 *   [ Open Question Paper ]  [ Upload Answer Sheet ]
 * No "Step 1/2/3" labels. After upload: answer sheet + marking scheme +
 * marks/mistakes submit appear. MCQ tests render questions directly.
 */
export const MentorTestScreen = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'MentorTest'>>();
  const testId = route.params.testId;
  const { student } = useAuth();

  const [meta, setMeta] = useState<PaperMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [answerUrl, setAnswerUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const [evaluated, setEvaluated] = useState<{ score?: number; total?: number } | null>(null);
  const [marksInput, setMarksInput] = useState('');
  const [remarks, setRemarks] = useState('');
  const [marksError, setMarksError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [viewer, setViewer] = useState<{ label: string; url: string; b64?: string } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [textDoc, setTextDoc] = useState<{ label: string; text: string } | null>(null);
  const viewerRef = useRef<any>(null);
  const viewerReady = useRef(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getPaperMeta(testId);
        if (!alive) return;
        setMeta(m);
        setError('');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load this test.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [testId]);

  const unlocked = Boolean(answerUrl) || Boolean(evaluated);
  const isPaper = (meta?.kind || 'mcq-test') === 'paper-test';
  const isMcq = !isPaper && (meta?.questions.length ?? 0) > 0;
  const hasAnswerDoc = Boolean(meta?.answerSheetUrl || meta?.answerSheetText);
  const hasMarkingDoc = Boolean(meta?.markingSchemeUrl || meta?.markingSchemeText);

  const openProtected = async (url: string | null, label: string) => {
    if (!url) return;
    setError('');
    setZoomPercent(100);
    viewerReady.current = false;
    const driveId = getDriveFileId(url);
    // Drive docs render through the /preview embed on BOTH platforms:
    // native -> WebView, web (sandbox preview) -> inline iframe. No popups,
    // because the sandboxed preview iframe blocks window.open().
    if (driveId || Platform.OS === 'web') {
      setViewer({ label, url });
      return;
    }
    try {
      const b64 = await fetchPdfBase64(url); // memory only - never written to disk
      setViewer({ label, url, b64 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the document.');
    }
  };

  useEffect(() => {
    if (viewer && getDriveFileId(viewer.url) && viewerRef.current) {
      viewerRef.current.injectJavaScript(zoomScript(zoomPercent));
    }
  }, [zoomPercent, viewer]);

  const openAnswerDoc = () => {
    if (meta?.answerSheetUrl) void openProtected(meta.answerSheetUrl, 'Answer Sheet');
    else if (meta?.answerSheetText) setTextDoc({ label: 'Answer Sheet', text: meta.answerSheetText });
  };
  const openMarkingDoc = () => {
    if (meta?.markingSchemeUrl) void openProtected(meta.markingSchemeUrl, 'Marking Scheme');
    else if (meta?.markingSchemeText) setTextDoc({ label: 'Marking Scheme', text: meta.markingSchemeText });
  };

  const pickAndUpload = async (source: 'camera' | 'gallery' | 'file') => {
    if (uploading || evaluated) return;
    setPickerOpen(false);
    setUploadError('');
    try {
      let uri = '';
      let name = `answer-${Date.now()}.jpg`;
      let mime = 'image/jpeg';
      if (source === 'camera') {
        const r = await ImagePicker.launchCameraAsync({ quality: 0.75 });
        if (r.canceled || !r.assets?.length) return;
        uri = r.assets[0].uri;
        mime = r.assets[0].mimeType || mime;
      } else if (source === 'gallery') {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
        if (r.canceled || !r.assets?.length) return;
        uri = r.assets[0].uri;
        mime = r.assets[0].mimeType || mime;
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.length) return;
        uri = r.assets[0].uri;
        name = r.assets[0].name || name;
        mime = r.assets[0].mimeType || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mime);
      }
      const info = await LegacyFileSystem.getInfoAsync(uri);
      const size = (info as { size?: number }).size || 0;
      if (size > MAX_UPLOAD_BYTES) {
        setUploadError('File is larger than 10 MB. Photograph fewer pages or compress the PDF, then try again.');
        return;
      }
      setUploading(true);
      const base64 = await LegacyFileSystem.readAsStringAsync(uri, { encoding: LegacyFileSystem.EncodingType.Base64 });
      const url = await uploadAnswerSheet({ base64, mimeType: mime, filename: name });
      setAnswerUrl(url);
    } catch (e) {
      setUploadError(e instanceof Error ? `Upload failed: ${e.message}` : 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (submitting) return;
    setMarksError('');
    const marks = Number(marksInput);
    const max = meta?.maxMarks ?? null;
    if (marksInput.trim() === '' || Number.isNaN(marks) || marks < 0) {
      setMarksError('Enter the marks you scored.');
      return;
    }
    if (max != null && marks > max) {
      setMarksError(`Marks cannot be greater than ${max}.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitSelfMarks({ testId, selfMarks: marks, remarks, answerUrl });
      setEvaluated({ score: res.score ?? marks, total: res.total ?? max ?? undefined });
    } catch (e) {
      setMarksError(e instanceof Error ? e.message : 'Submit failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitMcq = async () => {
    if (submitting || !meta) return;
    setMarksError('');
    if (Object.keys(answers).length < meta.questions.length) {
      setMarksError(`Answer all questions before submitting (${Object.keys(answers).length}/${meta.questions.length} done).`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitMcqAnswers({ testId, answers });
      setEvaluated({ score: res.score, total: res.total });
    } catch (e) {
      setMarksError(e instanceof Error ? e.message : 'Submit failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const feedViewer = async () => {
    const wv = viewerRef.current;
    const b64 = viewer?.b64;
    if (!wv || !b64 || viewerReady.current) return;
    const CH = 262144;
    for (let i = 0; i < b64.length; i += CH) {
      const chunk = JSON.stringify(b64.slice(i, i + CH));
      await wv.injectJavaScript(`window.__pushChunk(${chunk}); true;`);
    }
    const wm = JSON.stringify(`${student?.studentId || 'STUDENT'} · ${student?.studentName || ''} · confidential`);
    await wv.injectJavaScript(`window.__render(${wm}); true;`);
    viewerReady.current = true;
  };

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{meta?.title || 'Mentor test'}</Text>
            <Text style={styles.subtitle}>
              {[meta?.subject, meta?.maxMarks ? `${meta.maxMarks} marks` : null, meta?.durationMinutes ? `${meta.durationMinutes} min` : null]
                .filter(Boolean)
                .join(' · ') || 'Paper test'}
            </Text>
          </View>

          {error ? <ErrorBanner message={error} /> : null}

          {loading ? (
            <Card style={styles.card}><ActivityIndicator color={colors.primary} /></Card>
          ) : evaluated ? (
            <Card style={styles.evalCard}>
              <Text style={styles.evalTitle}>✅ Test Evaluated</Text>
              <Text style={styles.evalScore}>{evaluated.score} / {evaluated.total ?? '?'}</Text>
              <Text style={styles.evalSub}>Your self-evaluation has been recorded and sent to your mentor.</Text>
              {hasAnswerDoc ? <PrimaryButton label="📝 Open Answer Sheet" icon="clipboard-outline" variant="secondary" onPress={openAnswerDoc} /> : null}
            </Card>
          ) : isMcq ? (
            <>
              <Card style={styles.card}>
                <PrimaryButton label="📄 Open Question Paper" icon="document-text-outline" onPress={() => void openProtected(meta?.paperUrl ?? null, 'Question Paper')} />
                {meta?.instructions ? <Text style={styles.instructions}>{meta.instructions}</Text> : null}
              </Card>
              {meta?.questions.map((q, qi) => (
                <Card key={q.id || qi} style={styles.card}>
                  <Text style={styles.qPrompt}>Q{qi + 1}. {q.prompt}</Text>
                  {q.options.map((op) => (
                    <Pressable
                      key={op.id}
                      onPress={() => setAnswers((a) => ({ ...a, [q.id]: op.id }))}
                      style={[styles.optRow, answers[q.id] === op.id ? styles.optSel : null]}
                    >
                      <Ionicons name={answers[q.id] === op.id ? 'radio-button-on' : 'radio-button-off'} size={18} color={answers[q.id] === op.id ? colors.primary : colors.muted} />
                      <Text style={styles.optText}>{op.id}. {op.text}</Text>
                    </Pressable>
                  ))}
                </Card>
              ))}
              <Card style={styles.card}>
                <Text style={styles.muted}>Answered {Object.keys(answers).length} of {meta?.questions.length ?? 0}</Text>
                {marksError ? <Text style={styles.errorText}>{marksError}</Text> : null}
                <PrimaryButton label="Submit Answers" icon="checkmark-circle-outline" loading={submitting} onPress={() => void submitMcq()} />
              </Card>
            </>
          ) : (
            <>
              {/* Two big actions - no step numbers */}
              <Card style={styles.card}>
                <PrimaryButton label="📄 Open Question Paper" icon="document-text-outline" onPress={() => void openProtected(meta?.paperUrl ?? null, 'Question Paper')} />
                {!meta?.paperUrl ? <Text style={styles.errorText}>No question paper attached to this test.</Text> : null}
                {meta?.instructions ? <Text style={styles.instructions}>{meta.instructions}</Text> : null}
              </Card>

              <Card style={styles.card}>
                {answerUrl ? (
                  <View style={styles.okBox}>
                    <Ionicons name="cloud-done" size={20} color={colors.teal} />
                    <Text style={styles.okText}>Answer sheet uploaded</Text>
                  </View>
                ) : (
                  <>
                    <PrimaryButton
                      label="⬆️ Upload Answer Sheet"
                      icon="cloud-upload-outline"
                      loading={uploading}
                      onPress={() => (Platform.OS === 'web' ? setUploadError('Upload se phone par available hai (preview mode).') : setPickerOpen((o) => !o))}
                    />
                    {pickerOpen ? (
                      <View style={styles.pickerRow}>
                        <Pressable style={styles.pickBtn} onPress={() => void pickAndUpload('camera')}>
                          <Ionicons name="camera" size={20} color={colors.primary} />
                          <Text style={styles.pickLabel}>Camera</Text>
                        </Pressable>
                        <Pressable style={styles.pickBtn} onPress={() => void pickAndUpload('gallery')}>
                          <Ionicons name="images" size={20} color={colors.primary} />
                          <Text style={styles.pickLabel}>Gallery</Text>
                        </Pressable>
                        <Pressable style={styles.pickBtn} onPress={() => void pickAndUpload('file')}>
                          <Ionicons name="document" size={20} color={colors.primary} />
                          <Text style={styles.pickLabel}>PDF</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {uploading ? (
                      <View style={styles.progressRow}>
                        <ActivityIndicator color={colors.primary} />
                        <Text style={styles.progressText}>Uploading… 5–30 seconds on mobile network.</Text>
                      </View>
                    ) : null}
                    {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
                  </>
                )}
              </Card>

              {unlocked ? (
                <>
                  <Card style={styles.card}>
                    <View style={styles.duoRow}>
                      <View style={styles.duoHalf}>
                        <PrimaryButton label="📝 Answer Sheet" icon="clipboard-outline" onPress={openAnswerDoc} />
                      </View>
                      <View style={styles.duoHalf}>
                        <PrimaryButton label="📊 Marking Scheme" icon="list-outline" variant="secondary" onPress={openMarkingDoc} />
                      </View>
                    </View>
                    {!hasAnswerDoc ? <Text style={styles.errorText}>Mentor has not provided an answer sheet.</Text> : null}
                    {!hasMarkingDoc ? <Text style={styles.errorText}>Mentor has not provided a marking scheme.</Text> : null}
                  </Card>

                  <Card style={styles.card}>
                    <Text style={styles.label}>Marks obtained{meta?.maxMarks ? ` (out of ${meta.maxMarks})` : ''}</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="number-pad"
                      placeholder="e.g. 45"
                      placeholderTextColor={colors.muted}
                      value={marksInput}
                      onChangeText={setMarksInput}
                    />
                    <Text style={styles.label}>What mistakes did you make? (self-analysis)</Text>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      multiline
                      numberOfLines={4}
                      placeholder="e.g. Silly sign errors in Q3, missed units in Q5…"
                      placeholderTextColor={colors.muted}
                      value={remarks}
                      onChangeText={setRemarks}
                    />
                    {marksError ? <Text style={styles.errorText}>{marksError}</Text> : null}
                    <PrimaryButton label="Final Submit" icon="checkmark-circle-outline" loading={submitting} onPress={() => void submit()} />
                  </Card>
                </>
              ) : (
                <Card style={styles.card}>
                  <View style={styles.lockedBox}>
                    <Ionicons name="lock-closed" size={18} color={colors.muted} />
                    <Text style={styles.muted}>Answer sheet upload karne ke baad answer key, marking scheme aur marks submit khul jayega.</Text>
                  </View>
                </Card>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Protected in-app document viewer (notes-format Drive embed + watermark) */}
      <Modal visible={Boolean(viewer) && Platform.OS !== 'web'} transparent={false} animationType="slide" onRequestClose={() => setViewer(null)}>
        <SafeAreaView style={styles.viewerPage} edges={['top', 'bottom']}>
          <View style={styles.viewerBar}>
            <Text style={styles.viewerTitle} numberOfLines={1}>{viewer?.label || 'Document'}</Text>
            {getDriveFileId(viewer?.url) ? (
              <View style={styles.zoomBox}>
                <Pressable style={styles.zoomBtn} onPress={() => setZoomPercent((z) => Math.max(60, z - 20))}><Ionicons name="remove" size={18} color="#fff" /></Pressable>
                <Text style={styles.zoomLabel}>{zoomPercent}%</Text>
                <Pressable style={styles.zoomBtn} onPress={() => setZoomPercent((z) => Math.min(220, z + 20))}><Ionicons name="add" size={18} color="#fff" /></Pressable>
              </View>
            ) : null}
            <Pressable style={styles.viewerClose} onPress={() => setViewer(null)}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          {viewer && NativeWebView ? (
            getDriveFileId(viewer.url) ? (
              <NativeWebView
                ref={viewerRef}
                source={{ uri: `https://drive.google.com/file/d/${getDriveFileId(viewer.url)}/preview` }}
                javaScriptEnabled
                domStorageEnabled
                injectedJavaScript={hideDownloadControls}
                style={styles.viewerWeb}
              />
            ) : (
              <NativeWebView
                ref={viewerRef}
                source={{ html: PDF_VIEWER_HTML }}
                originWhitelist={['*']}
                javaScriptEnabled
                scrollEnabled
                onLoadEnd={() => void feedViewer()}
                onMessage={(e: any) => {
                  const d = e.nativeEvent.data;
                  if (typeof d === 'string' && d.startsWith('error:')) setError(d.slice(6));
                }}
                style={styles.viewerWeb}
              />
            )
          ) : null}
          <View style={styles.wmOverlay} pointerEvents="none">
            {Array.from({ length: 24 }).map((_, i) => (
              <Text key={i} style={styles.wmText}>{student?.studentId} · {student?.studentName} · confidential</Text>
            ))}
          </View>
          <Text style={styles.viewerHint}>Protected document · watermarked with your student ID · sharing disabled</Text>
        </SafeAreaView>
      </Modal>

      {/* WEB (sandbox preview) viewer: the sandboxed preview iframe blocks
          window.open(), so instead of a new tab we render the SAME Drive
          /preview embed inline through an iframe - closest web parity to the
          native WebView. Zoom is not injectable cross-origin, so it is omitted. */}
      {Platform.OS === 'web' && viewer ? (
        <View style={styles.webViewerRoot}>
          <View style={styles.viewerBar}>
            <Text style={styles.viewerTitle} numberOfLines={1}>{viewer.label}</Text>
            <Pressable style={styles.viewerClose} onPress={() => setViewer(null)}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          {React.createElement('iframe', {
            key: viewer.url,
            src: getDriveFileId(viewer.url)
              ? `https://drive.google.com/file/d/${getDriveFileId(viewer.url)}/preview`
              : viewer.url,
            title: viewer.label,
            style: { flex: 1, width: '100%', border: 'none', backgroundColor: '#525659' },
          })}
          <View style={styles.wmOverlay} pointerEvents="none">
            {Array.from({ length: 24 }).map((_, i) => (
              <Text key={i} style={styles.wmText}>{student?.studentId} · {student?.studentName} · confidential</Text>
            ))}
          </View>
          <Text style={styles.viewerHint}>Protected preview · watermarked with your student ID · sharing disabled</Text>
        </View>
      ) : null}

      {/* Protected TEXT document (marking scheme / answer sheet sent as text) */}
      <Modal visible={Boolean(textDoc)} transparent animationType="slide" onRequestClose={() => setTextDoc(null)}>
        <View style={styles.textOverlay}>
          <View style={styles.textCard}>
            <View style={styles.textBar}>
              <Text style={styles.textTitle} numberOfLines={1}>{textDoc?.label || 'Document'}</Text>
              <Pressable onPress={() => setTextDoc(null)}><Ionicons name="close" size={20} color={colors.ink} /></Pressable>
            </View>
            <ScrollView style={styles.textScroll} showsVerticalScrollIndicator>
              <Text style={styles.textBody}>{textDoc?.text}</Text>
            </ScrollView>
            <Text style={styles.textHint}>Protected · {student?.studentId} · sharing disabled</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  header: { paddingTop: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  card: { padding: spacing.lg, marginBottom: spacing.md },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: spacing.sm },
  instructions: { color: colors.inkSoft, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  duoRow: { flexDirection: 'row', gap: spacing.sm },
  duoHalf: { flex: 1 },
  pickerRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pickBtn: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: colors.canvas, borderRadius: radius.md, paddingVertical: spacing.md },
  pickLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: '800' },
  okBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.tealSoft, borderRadius: radius.md, padding: spacing.md },
  okText: { color: colors.teal, fontSize: 11, fontWeight: '800', flex: 1 },
  lockedBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.canvas, borderRadius: radius.md, padding: spacing.md },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  progressText: { color: colors.inkSoft, fontSize: 10, flex: 1 },
  errorText: { color: colors.red, fontSize: 10, marginTop: spacing.sm },
  label: { color: colors.ink, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  input: { backgroundColor: colors.canvas, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.ink, fontSize: 13, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  evalCard: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.md },
  evalTitle: { color: colors.teal, fontSize: 15, fontWeight: '900' },
  evalScore: { color: colors.ink, fontSize: 30, fontWeight: '900', marginTop: spacing.sm },
  evalSub: { color: colors.muted, fontSize: 10, marginTop: spacing.sm, textAlign: 'center', marginBottom: spacing.md },
  qPrompt: { color: colors.ink, fontSize: 12, fontWeight: '800', lineHeight: 18, marginBottom: spacing.sm },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, marginBottom: 4, backgroundColor: colors.canvas },
  optSel: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  optText: { color: colors.inkSoft, fontSize: 11, flex: 1, lineHeight: 16 },
  viewerPage: { flex: 1, backgroundColor: '#202124' },
  webViewerRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#202124', zIndex: 2147483000 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  viewerTitle: { color: '#fff', fontSize: 13, fontWeight: '800', flex: 1 },
  viewerClose: { padding: spacing.xs, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.sm },
  zoomBox: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: spacing.sm },
  zoomBtn: { padding: 2, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.sm },
  zoomLabel: { color: '#fff', fontSize: 10, fontWeight: '800', minWidth: 34, textAlign: 'center' },
  viewerWeb: { flex: 1, backgroundColor: '#525659' },
  wmOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'space-around', justifyContent: 'space-around', overflow: 'hidden' },
  wmText: { color: 'rgba(110,110,110,0.16)', fontSize: 14, fontWeight: '700', transform: [{ rotate: '-30deg' }] },
  viewerHint: { color: 'rgba(255,255,255,0.55)', fontSize: 9, textAlign: 'center', paddingVertical: spacing.xs },
  textOverlay: { flex: 1, backgroundColor: 'rgba(9,20,43,0.72)', justifyContent: 'center', padding: spacing.lg },
  textCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xxl, marginBottom: spacing.xxl },
  textBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  textTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', flex: 1 },
  textScroll: { flex: 1 },
  textBody: { color: colors.inkSoft, fontSize: 12, lineHeight: 19 },
  textHint: { color: colors.muted, fontSize: 9, textAlign: 'center', marginTop: spacing.sm },
});
