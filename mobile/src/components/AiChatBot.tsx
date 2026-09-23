import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { askAi, type AiAttachment, type AiTurn } from '../api/reformApi';
import { useAuth } from '../context/AuthContext';
import { registerChatBotHandler, type ChatBotRequest } from '../services/chatBotBus';
import { setChapterCompleted } from '../services/completedChapters';
import { answerFromSyllabus, matchChapter, pickQuizQuestions } from '../services/syllabusBrain';
import type { DailyMcqQuestion } from '../data/dailyMcqBank';
import type { OfficialMcqChapter } from '../data/icaiChapterCatalog';
import { colors } from '../theme';

type Msg = { me: boolean; text: string };
type RevStage = null | 'ask-chapter' | 'quiz';

// TRUE ChatGPT welcome - NO * symbols at all
const WELCOME = `How can I help you right now?

Concept Clarity
Stuck on a tricky topic like Consolidation of Accounts or LLP Compliance?

Numerical Practice
Need a step-by-step solution for a Costing or Taxation problem?

Exam Strategy
Want to know how ICAI tests specific provisions in Corporate Laws or Audit?

Quick Revision
Need a 5-minute summary of a key section (e.g., Section 2 of LLP Act or Section 185 of Companies Act)?

Just drop your subject, topic, or a specific question. For example:
Explain Section 2 of the LLP Act, 2008 simply.
Solve this Costing problem: [Paste problem].
What are the key differences between Audit and Inspection?

I'm ready when you are. Let's make your CA Inter journey smoother.`;

// ---------- ChatGPT-like formatted message renderer - strips ALL * ----------
const InlineBold = ({ text, isMe }: { text: string; isMe: boolean }) => {
  // First strip **, then handle *word* -> bold without stars
  // Split by **bold** and *italic*
  const parts = text.split(/(\*\*.*?\*\*|\*[^*\n]+\*)/g);
  return (
    <Text>
      {parts.map((part, i) => {
        if (!part) return null;
        // **bold**
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          const inner = part.slice(2, -2).replace(/\*/g, '').trim();
          return (
            <Text key={i} style={isMe ? styles.inlineBoldMe : styles.inlineBold}>
              {inner}
            </Text>
          );
        }
        // *italic* or *word* -> treat as bold without stars
        if (part.startsWith('*') && part.endsWith('*') && part.length >= 3 && !part.includes('**')) {
          const inner = part.slice(1, -1).replace(/\*/g, '').trim();
          // Don't bold if it's just a bullet star at start
          if (inner.length > 0 && inner.length < 80) {
            return (
              <Text key={i} style={isMe ? styles.inlineBoldMe : styles.inlineBold}>
                {inner}
              </Text>
            );
          }
        }
        // Remove any stray * that might remain
        const cleaned = part.replace(/\*\*/g, '').replace(/(^|\s)\*(\S)/g, '$1$2').replace(/(\S)\*(\s|$)/g, '$1$2');
        return <Text key={i}>{cleaned}</Text>;
      })}
    </Text>
  );
};

type Block =
  | { type: 'heading'; text: string; level: number }
  | { type: 'subheading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string; icon: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'spacer' };

const parseBlocks = (raw: string): Block[] => {
  const lines = raw.split('\n');
  const blocks: Block[] = [];
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ type: 'table', rows: tableRows });
      tableRows = [];
    }
  };

  for (let line of lines) {
    let trimmed = line.trim();
    // Strip leading/trailing ** and single * for detection
    const cleanForDetect = trimmed.replace(/^\*\*|\*\*$/g, '').replace(/^\*|\*$/g, '').trim();
    if (!trimmed) {
      flushTable();
      blocks.push({ type: 'spacer' });
      continue;
    }
    // Table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3) {
      if (/^\|[\s\-|:]+\|$/.test(trimmed)) continue;
      const cells = trimmed
        .split('|')
        .slice(1, -1)
        .map((c) => c.replace(/\*\*/g, '').replace(/\*/g, '').trim());
      if (cells.length) tableRows.push(cells);
      continue;
    }
    flushTable();

    // Headings: ### or ##
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push({ type: 'heading', text: hMatch[2].replace(/\*\*/g, '').replace(/\*/g, '').trim(), level });
      continue;
    }
    // Bold heading on its own line
    if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length < 140) {
      blocks.push({ type: 'heading', text: trimmed.replace(/^\*\*|\*\*$/g, '').replace(/\*/g, '').trim(), level: 2 });
      continue;
    }
    // Subheading detection - short lines that look like headings
    if (trimmed.length < 80 && !trimmed.includes('  ') && /Covers|Insight|Truth|Strategy|Example|Important|Applicability|Criteria|Overview|Summary/.test(trimmed.replace(/\*/g, ''))) {
      if (trimmed.replace(/\*/g, '').length < 60) {
        blocks.push({ type: 'subheading', text: trimmed.replace(/\*\*/g, '').replace(/\*/g, '').replace(/:$/, '').trim() });
        continue;
      }
    }
    // Bullet detection
    if (/^[-•]\s+/.test(trimmed) || /^\*\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const txt = trimmed.replace(/^[-•*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      blocks.push({ type: 'bullet', text: txt, icon: '•' });
      continue;
    }
    if (trimmed.startsWith('👉') || trimmed.startsWith('⚠️') || trimmed.startsWith('💡') || trimmed.startsWith('✅') || trimmed.startsWith('❌') || trimmed.startsWith('🔹') || trimmed.startsWith('📌')) {
      const icon = trimmed[0];
      const txt = trimmed.slice(1).trim();
      blocks.push({ type: 'bullet', text: txt, icon });
      continue;
    }
    // Normal paragraph - also strip stray * at start/end
    blocks.push({ type: 'paragraph', text: line });
  }
  flushTable();
  return blocks;
};

const FormattedMessage = ({ text, isMe }: { text: string; isMe: boolean }) => {
  const blocks = parseBlocks(text);
  return (
    <View style={{ gap: isMe ? 4 : 8 }}>
      {blocks.map((b, idx) => {
        if (b.type === 'spacer') return <View key={idx} style={{ height: isMe ? 4 : 8 }} />;
        if (b.type === 'heading') {
          const isH1 = b.level === 1;
          return (
            <Text key={idx} style={isMe ? styles.headingMe : isH1 ? styles.heading1 : styles.heading2}>
              {b.text}
            </Text>
          );
        }
        if (b.type === 'subheading') {
          return (
            <Text key={idx} style={isMe ? styles.subHeadingMe : styles.subHeading}>
              {b.text}
            </Text>
          );
        }
        if (b.type === 'bullet') {
          return (
            <View key={idx} style={styles.bulletRow}>
              <Text style={isMe ? styles.bulletIconMe : styles.bulletIcon}>{b.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={isMe ? styles.bulletTextMe : styles.bulletText}>
                  <InlineBold text={b.text} isMe={isMe} />
                </Text>
              </View>
            </View>
          );
        }
        if (b.type === 'table') {
          const rows = b.rows;
          if (!rows.length) return null;
          return (
            <View key={idx} style={isMe ? styles.tableMe : styles.table}>
              {rows.map((row, ri) => (
                <View key={ri} style={[styles.tableRow, ri === 0 && styles.tableHeaderRow, ri === rows.length - 1 && styles.tableLastRow]}>
                  {row.map((cell, ci) => (
                    <View key={ci} style={[styles.tableCell, ci === row.length - 1 && { borderRightWidth: 0 }]}>
                      <Text style={[isMe ? styles.tableCellTextMe : styles.tableCellText, ri === 0 && styles.tableHeaderText]}>
                        {cell}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={idx} style={isMe ? styles.paragraphMe : styles.paragraph}>
            <InlineBold text={b.text} isMe={isMe} />
          </Text>
        );
      })}
    </View>
  );
};


// ── Attachments ─────────────────────────────────────────────────────────────
// A student photographs a question far more often than they type it out.
//
// Two hard limits shape this code:
//   1. Vercel rejects request bodies over ~4.5 MB, so a raw phone photo has to
//      be shrunk before it is sent. Images are resized to 1280px wide at 60%
//      JPEG quality, which lands around 150-300 KB.
//   2. Groq tokenises an image into a lot of tokens, and the free tier only
//      allows 8,000 tokens per minute, so sending a 12-megapixel original
//      would burn the whole minute on one question.
const MAX_B64 = 4_800_000;
const FREE_TIER_NOTE = 'That can happen on the free AI plan - please try again in a minute.';

/** Alert.alert is a no-op in the browser, so fall back to window.alert. */
const notify = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    try { (globalThis as any).alert(message ? `${title}\n\n${message}` : title); } catch { /* ignore */ }
    return;
  }
  Alert.alert(title, message);
};

/** Read a web File object as base64 (expo returns a File in the browser). */
const readFileAsBase64 = (file: any): Promise<string> =>
  new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });

/** Shrink an image and return fresh base64. Falls back to the original. */
const shrinkImage = async (uri: string): Promise<string> => {
  try {
    const M: any = ImageManipulator;
    // expo-image-manipulator has two APIs depending on SDK; support both so a
    // version bump cannot silently break the upload.
    if (typeof M.manipulateAsync === 'function') {
      const out = await M.manipulateAsync(uri, [{ resize: { width: 1280 } }],
        { compress: 0.6, format: 'jpeg', base64: true });
      if (out?.base64) return out.base64;
    } else if (typeof M.manipulate === 'function') {
      const ctx = M.manipulate(uri);
      ctx.resize({ width: 1280 });
      const img = await ctx.renderAsync();
      const out = await img.saveAsync({ compress: 0.6, format: 'jpeg', base64: true });
      if (out?.base64) return out.base64;
    }
  } catch (e) {
    console.warn('image resize unavailable, sending the original', e);
  }
  return '';
};

export const AiChatBot = () => {
  const { student } = useAuth();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Msg[]>([{ me: false, text: WELCOME }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [attachSheet, setAttachSheet] = useState(false);
  const [attached, setAttached] = useState<AiAttachment | null>(null);
  const [preparing, setPreparing] = useState(false);
  const listRef = useRef<ScrollView>(null);

  const [revStage, setRevStage] = useState<RevStage>(null);
  const [revChapter, setRevChapter] = useState<OfficialMcqChapter | null>(null);
  const [revQuestions, setRevQuestions] = useState<DailyMcqQuestion[]>([]);
  const [revIndex, setRevIndex] = useState(0);
  const [revScore, setRevScore] = useState(0);

  const push = useCallback((m: Msg) => {
    setChat((prev) => [...prev, m]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const askQuestion = useCallback((qs: DailyMcqQuestion[], idx: number) => {
    const q = qs[idx];
    push({ me: false, text: `Q${idx + 1}/${qs.length}: ${q.prompt}\nA) ${q.options[0]}\nB) ${q.options[1]}\nC) ${q.options[2]}\nD) ${q.options[3]}\n(Reply A, B, C or D)` });
  }, [push]);

  const startRevision = useCallback((topic?: string) => {
    if (topic) {
      const ch = matchChapter(topic);
      if (ch) {
        const qs = pickQuizQuestions(ch, 3);
        if (qs.length) {
          setRevChapter(ch); setRevQuestions(qs); setRevIndex(0); setRevScore(0); setRevStage('quiz');
          push({ me: false, text: `Nice session! Let's check what you remember from "${ch.displayTitle}" (${ch.subject}).` });
          askQuestion(qs, 0);
          return;
        }
      }
      push({ me: false, text: `I could not match "${topic}" to a chapter with revision questions yet. Ask me any doubt instead!` });
      setRevStage(null);
      return;
    }
    setRevStage('ask-chapter');
    push({ me: false, text: 'Great session! Which chapter did you study? Tell me the name and I will ask a few questions to check what you remember.' });
  }, [askQuestion, push]);

  useEffect(() => {
    registerChatBotHandler((req: ChatBotRequest) => {
      setOpen(true);
      setTimeout(() => startRevision(req.revisionTopic), 250);
    });
    return () => registerChatBotHandler(null);
  }, [startRevision]);

  const handleRevisionReply = useCallback((text: string): boolean => {
    if (revStage === 'ask-chapter') {
      const ch = matchChapter(text);
      if (!ch) {
        push({ me: false, text: 'Hmm, I could not match that to a chapter. Try the chapter name, e.g. "Accounting Standards" or "Contract Act".' });
        return true;
      }
      const qs = pickQuizQuestions(ch, 3);
      if (!qs.length) {
        push({ me: false, text: `I don't have revision questions for "${ch.displayTitle}" yet. Ask me any doubt on it instead!` });
        setRevStage(null);
        return true;
      }
      setRevChapter(ch); setRevQuestions(qs); setRevIndex(0); setRevScore(0); setRevStage('quiz');
      push({ me: false, text: `Perfect — "${ch.displayTitle}" it is. Let's see what you remember!` });
      askQuestion(qs, 0);
      return true;
    }
    if (revStage === 'quiz') {
      const q = revQuestions[revIndex];
      const m = text.toUpperCase().match(/[A-D]/);
      const letter = m ? m[0] : '';
      const correct = letter && 'ABCD'.indexOf(letter) === q.answer;
      if (correct) setRevScore((s) => s + 1);
      push({
        me: false,
        text: correct ? `Correct! ${q.explanation}` : `Not quite — the answer is ${'ABCD'[q.answer]}. ${q.explanation}`,
      });
      if (revIndex + 1 < revQuestions.length) {
        const next = revIndex + 1;
        setRevIndex(next);
        setTimeout(() => askQuestion(revQuestions, next), 350);
      } else {
        const finalScore = revScore + (correct ? 1 : 0);
        setRevStage(null);
        const ch = revChapter;
        setTimeout(() => {
          push({
            me: false,
            text: finalScore >= 2 ? `Revision round done — ${finalScore}/${revQuestions.length} correct. Strong! Chapter marked as revised. Keep it up!` : `Revision round done — ${finalScore}/${revQuestions.length} correct. No stress — revise the chapter once more tonight and try me again tomorrow.`,
          });
          if (ch) setChapterCompleted(ch.id, true).catch(() => undefined);
        }, 350);
      }
      return true;
    }
    return false;
  }, [revStage, revIndex, revQuestions, revScore, revChapter, askQuestion, push]);

  const pickAttachment = useCallback(async (kind: 'image' | 'file') => {
    setAttachSheet(false);
    try {
      const res: any = await DocumentPicker.getDocumentAsync({
        type: kind === 'image'
          ? ['image/*']
          : ['application/pdf', 'image/*', 'text/plain'],
        base64: true,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res?.canceled) return;
      const asset: any = (res?.assets && res.assets[0]) || null;
      if (!asset) return;

      setPreparing(true);
      const mime: string = asset.mimeType || asset.type
        || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');
      let data: string = asset.base64 || '';
      if (!data && asset.file) data = await readFileAsBase64(asset.file);
      if (!data) {
        notify('Could not read that file', 'Please try again, or take a fresh photo of the question.');
        return;
      }

      const isImage = mime.startsWith('image/');
      // Shrink before sending: a raw phone photo is 3-6 MB and would be
      // rejected by the API, and would burn the whole per-minute AI quota.
      if (isImage && asset.uri) {
        const shrunk = await shrinkImage(asset.uri);
        if (shrunk) data = shrunk;
      }
      if (data.length > MAX_B64) {
        notify('That file is a bit large',
          'Please crop it to just the question, or retake the photo at a lower resolution.');
        return;
      }

      setAttached({
        kind: isImage ? 'image' : 'file',
        name: asset.name || (isImage ? 'photo.jpg' : 'document'),
        mime: isImage ? 'image/jpeg' : mime,
        data,
      });
    } catch (e) {
      console.warn('attach failed', e);
      notify('Could not open that file', 'Please try again.');
    } finally {
      setPreparing(false);
    }
  }, []);

  const send = useCallback(async () => {
    const q = input.trim();
    const att = attached;
    if ((!q && !att) || thinking || preparing) return;
    const asked = q || (att?.kind === 'file'
      ? 'Please answer the question in my file.'
      : 'Please solve the question in my photo.');
    setInput('');
    setAttached(null);
    push({ me: true, text: att
      ? `${asked}\n\n[${att.kind === 'image' ? 'Photo' : 'File'} attached: ${att.name}]`
      : asked });

    // A photo cannot be a revision reply or a quiz command, so those paths are
    // skipped rather than run against the placeholder text.
    if (!att && handleRevisionReply(q)) return;

    const quizMatch = att ? null : asked.toLowerCase().match(/quiz (?:me )?on (.+)/);
    if (quizMatch) { startRevision(quizMatch[1]); return; }

    setThinking(true);

    // Build the conversation so far (excluding the welcome bubble) so the
    // backend can answer follow-ups in context, exactly like a chat thread.
    const history: AiTurn[] = chat
      .slice(1)
      .filter((m) => !!m.text?.trim())
      .slice(-8)
      .map((m) => ({ role: m.me ? ('user' as const) : ('assistant' as const), text: m.text }));

    let answer: string | null = null;
    if (student) {
      const live = await askAi(student.studentId, asked, undefined, history, att);
      answer = live?.answer || null;
      if (att && !answer) {
        // Never answer a photograph from the offline notes - they cannot see
        // it, and a confident text answer to a picture is worse than none.
        answer = `Sorry, I could not read that question just now. ${FREE_TIER_NOTE}`;
      }
    }
    if (!answer) answer = answerFromSyllabus(asked);
    setThinking(false);
    push({ me: false, text: answer });
  }, [input, thinking, preparing, attached, student, chat, push, handleRevisionReply, startRevision]);

  if (!student) return null;

  return (
    <>
      <Pressable style={styles.fab} onPress={() => setOpen(true)} accessibilityLabel="Open AI assistant">
        <Ionicons name="sparkles" size={22} color="#fff" />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <View style={styles.sheet}>
            {/* ChatGPT-style header */}
            <View style={styles.sheetHeader}>
              <Pressable style={styles.backBtn} onPress={() => setOpen(false)}>
                <Ionicons name="chevron-back" size={24} color="#000" />
              </Pressable>
              <View style={styles.headerCenter}>
                <Text style={styles.sheetTitle}>ChatGPT • CA Inter Mentor</Text>
                <Text style={styles.sheetSub}>UPM AI • Full syllabus</Text>
              </View>
              <View style={styles.headerRight} />
            </View>

            <ScrollView ref={listRef} style={styles.chatArea} contentContainerStyle={styles.chatList} keyboardShouldPersistTaps="handled" onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}>
              {chat.map((m, i) => (
                <View key={i} style={[styles.messageRow, m.me ? styles.messageRowMe : styles.messageRowAi]}>
                  {!m.me ? (
                    <View style={styles.aiAvatar}>
                      <Ionicons name="sparkles" size={14} color="#000" />
                    </View>
                  ) : null}
                  <View style={[styles.bubble, m.me ? styles.bubbleMe : styles.bubbleAi]}>
                    {!m.me && i === 0 ? (
                      <Text style={styles.welcomeTitle}>How can I help you right now?</Text>
                    ) : !m.me ? (
                      <View style={styles.aiNameRow}>
                        <Text style={styles.aiName}>UPM AI</Text>
                      </View>
                    ) : null}
                    <FormattedMessage text={m.text} isMe={m.me} />
                  </View>
                </View>
              ))}
              {thinking ? (
                <View style={styles.messageRowAi}>
                  <View style={styles.aiAvatar}>
                    <Ionicons name="sparkles" size={14} color="#000" />
                  </View>
                  <View style={styles.bubbleAi}>
                    <View style={styles.aiNameRow}>
                      <Text style={styles.aiName}>UPM AI</Text>
                    </View>
                    <View style={styles.thinkingRow}>
                      <View style={styles.dot} />
                      <View style={[styles.dot, { opacity: 0.6 }]} />
                      <View style={[styles.dot, { opacity: 0.3 }]} />
                    </View>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {/* ChatGPT pill composer */}
            <View style={styles.composerWrapper}>
              {attachSheet ? (
                <View style={styles.attachSheet}>
                  <Pressable style={styles.attachOption} onPress={() => pickAttachment('image')}>
                    <View style={styles.attachIcon}><Ionicons name="camera-outline" size={19} color="#000" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachTitle}>Photo of a question</Text>
                      <Text style={styles.attachSub}>Snap or pick a picture - I will read it and solve it</Text>
                    </View>
                  </Pressable>
                  <Pressable style={styles.attachOption} onPress={() => pickAttachment('file')}>
                    <View style={styles.attachIcon}><Ionicons name="document-outline" size={19} color="#000" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachTitle}>Upload a file</Text>
                      <Text style={styles.attachSub}>PDF, notes or text</Text>
                    </View>
                  </Pressable>
                </View>
              ) : null}

              {preparing ? (
                <View style={styles.chip}>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.chipText}>Preparing…</Text>
                </View>
              ) : attached ? (
                <View style={styles.chip}>
                  <Ionicons
                    name={attached.kind === 'image' ? 'image-outline' : 'document-text-outline'}
                    size={15}
                    color="#000"
                  />
                  <Text style={styles.chipText} numberOfLines={1}>{attached.name}</Text>
                  <Pressable onPress={() => setAttached(null)} hitSlop={10}>
                    <Ionicons name="close" size={15} color="#000" />
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.composer}>
                <Pressable
                  style={[styles.plusBtn, attachSheet && styles.plusBtnOn]}
                  onPress={() => setAttachSheet((v) => !v)}
                  accessibilityLabel="Attach a photo or file"
                >
                  <Ionicons name={attachSheet ? 'close' : 'add'} size={22} color="#000" />
                </Pressable>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Message UPM AI..."
                  placeholderTextColor="#8E8E93"
                  style={styles.composerInput}
                  onSubmitEditing={send}
                  selectionColor="#000"
                  autoCorrect={false}
                  returnKeyType="send"
                  blurOnSubmit={false}
                  multiline
                />
                <Pressable
                  style={[styles.sendBtn, ((!input.trim() && !attached) || thinking || preparing) && styles.sendOff]}
                  onPress={send}
                  disabled={(!input.trim() && !attached) || thinking || preparing}
                >
                  <Ionicons name="arrow-up" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 18, bottom: 96, width: 56, height: 56, borderRadius: 28, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 30, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 10 },
  backdrop: { flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'flex-end' },
  sheet: { flex: 1, backgroundColor: '#FFFFFF' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight: { width: 36 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#000', letterSpacing: -0.3 },
  sheetSub: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  chatArea: { flex: 1, backgroundColor: '#FFFFFF' },
  chatList: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 20 },
  messageRow: { flexDirection: 'row', gap: 10, maxWidth: '100%' },
  messageRowAi: { flexDirection: 'row', gap: 10, maxWidth: '100%', alignSelf: 'flex-start' },
  messageRowMe: { flexDirection: 'row', gap: 10, maxWidth: '85%', alignSelf: 'flex-end', justifyContent: 'flex-end' },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F2F2F7', borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  aiNameRow: { marginBottom: 6 },
  aiName: { fontSize: 13, fontWeight: '700', color: '#000' },
  welcomeTitle: { fontSize: 20, fontWeight: '800', color: '#000', marginBottom: 16, letterSpacing: -0.4 },
  bubble: { flex: 1, borderRadius: 0, paddingHorizontal: 0, paddingVertical: 0 },
  bubbleMe: { backgroundColor: '#F2F2F7', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-end' },
  bubbleAi: { backgroundColor: 'transparent', flex: 1 },
  // TRUE ChatGPT typography - larger, cleaner
  paragraph: { fontSize: 15, lineHeight: 24, color: '#000000', letterSpacing: -0.2 },
  paragraphMe: { fontSize: 15, lineHeight: 22, color: '#000000' },
  heading1: { fontSize: 20, lineHeight: 26, fontWeight: '800', color: '#000000', marginTop: 16, marginBottom: 8, letterSpacing: -0.5 },
  heading2: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: '#000000', marginTop: 14, marginBottom: 6 },
  headingMe: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: '#000000' },
  subHeading: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#000000', marginTop: 14, marginBottom: 6 },
  subHeadingMe: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#000000' },
  inlineBold: { fontWeight: '700', color: '#000000' },
  inlineBoldMe: { fontWeight: '700', color: '#000000' },
  bulletRow: { flexDirection: 'row', gap: 8, marginTop: 4, paddingRight: 8 },
  bulletIcon: { fontSize: 15, lineHeight: 24, color: '#000000', fontWeight: '400', marginTop: 0 },
  bulletIconMe: { fontSize: 15, lineHeight: 22, color: '#000000', fontWeight: '400' },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 24, color: '#000000', letterSpacing: -0.2 },
  bulletTextMe: { flex: 1, fontSize: 15, lineHeight: 22, color: '#000000' },
  table: { marginTop: 12, borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  tableMe: { marginTop: 8, borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12, overflow: 'hidden', backgroundColor: '#F2F2F7' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  tableHeaderRow: { backgroundColor: '#F9F9FB' },
  tableLastRow: { borderBottomWidth: 0 },
  tableCell: { flex: 1, paddingHorizontal: 10, paddingVertical: 10, borderRightWidth: 1, borderRightColor: '#F2F2F7' },
  tableCellText: { fontSize: 13, lineHeight: 18, color: '#000000' },
  tableCellTextMe: { fontSize: 13, lineHeight: 18, color: '#000000' },
  tableHeaderText: { fontWeight: '700', color: '#000000', fontSize: 13 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#000' },
  composerWrapper: { paddingHorizontal: 12, paddingBottom: 20, paddingTop: 10, backgroundColor: '#FFFFFF', borderTopWidth: 0 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#F2F2F7', borderRadius: 26, paddingHorizontal: 6, paddingVertical: 6, gap: 6, minHeight: 52 },
  plusBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  composerInput: { flex: 1, fontSize: 16, color: '#000', maxHeight: 110, paddingHorizontal: 8, paddingVertical: 8, letterSpacing: -0.2 },
  attachSheet: {
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 6, marginBottom: 8,
    borderWidth: 1, borderColor: '#E5E5EA',
  },
  attachOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  attachIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  attachTitle: { fontSize: 14, fontWeight: '600', color: '#000000' },
  attachSub: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: '#F2F2F7', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 11,
    marginBottom: 8, maxWidth: '90%',
  },
  chipText: { fontSize: 13, color: '#000000', flexShrink: 1 },
  plusBtnOn: { backgroundColor: '#E5E5EA' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.3, backgroundColor: '#8E8E93' },
});
