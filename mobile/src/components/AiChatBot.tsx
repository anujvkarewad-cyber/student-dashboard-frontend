import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { askAi } from '../api/reformApi';
import { useAuth } from '../context/AuthContext';
import { registerChatBotHandler, type ChatBotRequest } from '../services/chatBotBus';
import { setChapterCompleted } from '../services/completedChapters';
import { answerFromSyllabus, matchChapter, pickQuizQuestions } from '../services/syllabusBrain';
import type { DailyMcqQuestion } from '../data/dailyMcqBank';
import type { OfficialMcqChapter } from '../data/icaiChapterCatalog';
import { colors, radius, spacing } from '../theme';

type Msg = { me: boolean; text: string };
type RevStage = null | 'ask-chapter' | 'quiz';

const WELCOME = 'Hi! I am your AI study assistant with knowledge of the full CA Inter syllabus. Ask me anything — or type "quiz me on <chapter>" for a quick revision round.';

// ---------- ChatGPT-like formatted message renderer ----------
const InlineBold = ({ text, isMe }: { text: string; isMe: boolean }) => {
  // Split by **bold**
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <Text>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          const inner = part.slice(2, -2);
          return (
            <Text key={i} style={isMe ? styles.inlineBoldMe : styles.inlineBold}>
              {inner}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
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
    const trimmed = line.trim();
    if (!trimmed) {
      flushTable();
      blocks.push({ type: 'spacer' });
      continue;
    }
    // Table row detection: | col | col |
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3) {
      // separator line |---|---|
      if (/^\|[\s\-|:]+\|$/.test(trimmed)) continue;
      const cells = trimmed
        .split('|')
        .slice(1, -1)
        .map((c) => c.replace(/\*\*/g, '').trim());
      if (cells.length) tableRows.push(cells);
      continue;
    }
    flushTable();

    // Headings: ### or ## or **Heading**
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push({ type: 'heading', text: hMatch[2].replace(/\*\*/g, '').trim(), level });
      continue;
    }
    // Bold heading on its own line: **What Section 2 Covers** or **Section 43 – ...**
    if (/^\*\*.+\*\*$/.test(trimmed) && trimmed.length < 140) {
      blocks.push({ type: 'heading', text: trimmed.replace(/^\*\*|\*\*$/g, '').trim(), level: 2 });
      continue;
    }
    // Subheading patterns: **1. Overview** or **What is...** or lines ending with : and bold
    if (/^(\*\*)?.*(Covers|Insight|Truth|Strategy|Example|Important|Brutal|What|Why|How).*(\*\*)?:?$/.test(trimmed) && trimmed.length < 100 && !trimmed.includes('  ')) {
      // Only treat as subheading if short and looks like heading
      if (trimmed.replace(/\*/g, '').length < 60) {
        // Check if it's likely a heading (contains Covers, Insight, Truth)
        if (/Covers|Insight|Truth|Strategy|Exam/.test(trimmed)) {
          blocks.push({ type: 'subheading', text: trimmed.replace(/\*\*/g, '').replace(/:$/, '').trim() });
          continue;
        }
      }
    }
    // Bullet detection
    if (/^[-•]\s+/.test(trimmed) || /^\*\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^[•]\s+/.test(trimmed)) {
      const icon = '•';
      const txt = trimmed.replace(/^[-•*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      blocks.push({ type: 'bullet', text: txt, icon });
      continue;
    }
    if (trimmed.startsWith('👉') || trimmed.startsWith('⚠️') || trimmed.startsWith('💡') || trimmed.startsWith('✅') || trimmed.startsWith('❌')) {
      const icon = trimmed[0];
      const txt = trimmed.slice(1).trim();
      blocks.push({ type: 'bullet', text: txt, icon });
      continue;
    }
    // Normal paragraph
    blocks.push({ type: 'paragraph', text: line });
  }
  flushTable();
  return blocks;
};

const FormattedMessage = ({ text, isMe }: { text: string; isMe: boolean }) => {
  const blocks = parseBlocks(text);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((b, idx) => {
        if (b.type === 'spacer') return <View key={idx} style={{ height: 6 }} />;
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
        // paragraph
        return (
          <Text key={idx} style={isMe ? styles.paragraphMe : styles.paragraph}>
            <InlineBold text={b.text} isMe={isMe} />
          </Text>
        );
      })}
    </View>
  );
};
// ---------- end formatter ----------

export const AiChatBot = () => {
  const { student } = useAuth();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Msg[]>([{ me: false, text: WELCOME }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
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
    push({ me: false, text: 'Great session! 🎉 Which chapter did you study? Tell me the name and I will ask a few questions to check what you remember.' });
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
        text: correct ? `✅ Correct! ${q.explanation}` : `❌ Not quite — the answer is ${'ABCD'[q.answer]}. ${q.explanation}`,
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
            text: finalScore >= 2 ? `Revision round done — ${finalScore}/${revQuestions.length} correct. Strong! Chapter marked as revised. Keep it up! 💪` : `Revision round done — ${finalScore}/${revQuestions.length} correct. No stress — revise the chapter once more tonight and try me again tomorrow.`,
          });
          if (ch) setChapterCompleted(ch.id, true).catch(() => undefined);
        }, 350);
      }
      return true;
    }
    return false;
  }, [revStage, revIndex, revQuestions, revScore, revChapter, askQuestion, push]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput('');
    push({ me: true, text: q });

    if (handleRevisionReply(q)) return;

    const quizMatch = q.toLowerCase().match(/quiz (?:me )?on (.+)/);
    if (quizMatch) { startRevision(quizMatch[1]); return; }

    setThinking(true);
    let answer: string | null = null;
    if (student) {
      const live = await askAi(student.studentId, q);
      answer = live?.answer || null;
    }
    if (!answer) answer = answerFromSyllabus(q);
    setThinking(false);
    push({ me: false, text: answer });
  }, [input, thinking, student, push, handleRevisionReply, startRevision]);

  if (!student) return null;

  return (
    <>
      <Pressable style={styles.fab} onPress={() => setOpen(true)} accessibilityLabel="Open AI assistant">
        <Ionicons name="sparkles" size={23} color="#fff" />
        <View style={styles.fabDot} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
          <Pressable style={styles.backdropTap} onPress={() => setOpen(false)} accessibilityLabel="Close AI assistant" />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetIcon}><Ionicons name="sparkles" size={18} color="#fff" /></View>
              <View style={styles.sheetTitleBox}>
                <Text style={styles.sheetTitle}>AI Study Assistant</Text>
                <Text style={styles.sheetSub}>Full syllabus · doubts · revision rounds</Text>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => setOpen(false)} accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView ref={listRef} style={styles.chatArea} contentContainerStyle={styles.chatList} keyboardShouldPersistTaps="handled" onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}>
              {chat.map((m, i) => (
                <View key={i} style={[styles.messageRow, m.me ? styles.messageRowMe : styles.messageRowAi]}>
                  {!m.me ? (
                    <View style={styles.aiAvatar}><Ionicons name="sparkles" size={14} color={colors.primary} /></View>
                  ) : null}
                  <View style={[styles.bubble, m.me ? styles.bubbleMe : styles.bubbleAi]}>
                    <FormattedMessage text={m.text} isMe={m.me} />
                  </View>
                </View>
              ))}
              {thinking ? (
                <View style={styles.messageRowAi}>
                  <View style={styles.aiAvatar}><Ionicons name="sparkles" size={14} color={colors.primary} /></View>
                  <View style={styles.bubbleAi}>
                    <View style={styles.thinkingRow}>
                      <View style={styles.dot} />
                      <View style={[styles.dot, { opacity: 0.6 }]} />
                      <View style={[styles.dot, { opacity: 0.3 }]} />
                      <Text style={styles.thinkingText}>AI is thinking…</Text>
                    </View>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.composer}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Type any syllabus question…"
                placeholderTextColor={colors.muted}
                style={styles.composerInput}
                onSubmitEditing={send}
                selectionColor={colors.primary}
                autoCorrect={false}
                returnKeyType="send"
                blurOnSubmit={false}
                multiline
              />
              <Pressable style={[styles.sendBtn, (!input.trim() || thinking) && styles.sendOff]} onPress={send} disabled={!input.trim() || thinking}>
                <Ionicons name="send" size={17} color="#fff" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 18, bottom: 96, width: 56, height: 56, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', zIndex: 30, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 10 },
  fabDot: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.amber, borderWidth: 1.5, borderColor: '#fff' },
  backdrop: { flex: 1, backgroundColor: 'rgba(16,35,63,0.45)', justifyContent: 'flex-end' },
  backdropTap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: '18%' },
  sheet: { height: '84%', backgroundColor: '#F7F7F8', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetTitleBox: { flex: 1 },
  sheetTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  sheetSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  chatArea: { flex: 1, backgroundColor: '#F7F7F8' },
  chatList: { paddingHorizontal: 12, paddingTop: spacing.md, paddingBottom: spacing.md, gap: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '100%' },
  messageRowAi: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '92%', alignSelf: 'flex-start' },
  messageRowMe: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '88%', alignSelf: 'flex-end' },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, maxWidth: '100%' },
  bubbleMe: { backgroundColor: colors.primary, borderBottomRightRadius: 4, alignSelf: 'flex-end' },
  bubbleAi: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderBottomLeftRadius: 4, alignSelf: 'flex-start', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  // ChatGPT-like typography
  paragraph: { fontSize: 13.5, lineHeight: 21, color: '#111827' },
  paragraphMe: { fontSize: 13.5, lineHeight: 21, color: '#FFFFFF' },
  heading1: { fontSize: 16, lineHeight: 22, fontWeight: '900', color: '#111827', marginTop: 10, marginBottom: 6 },
  heading2: { fontSize: 14.5, lineHeight: 20, fontWeight: '800', color: '#111827', marginTop: 10, marginBottom: 4 },
  headingMe: { fontSize: 14.5, lineHeight: 20, fontWeight: '800', color: '#FFFFFF', marginTop: 4, marginBottom: 2 },
  subHeading: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: colors.primary, marginTop: 12, marginBottom: 4, letterSpacing: 0.2 },
  subHeadingMe: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: '#FFFFFF', marginTop: 6, marginBottom: 2 },
  inlineBold: { fontWeight: '800', color: '#111827' },
  inlineBoldMe: { fontWeight: '800', color: '#FFFFFF' },
  bulletRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  bulletIcon: { fontSize: 13.5, lineHeight: 21, color: colors.primary, fontWeight: '900', marginTop: 1 },
  bulletIconMe: { fontSize: 13.5, lineHeight: 21, color: '#FFFFFF', fontWeight: '900', marginTop: 1 },
  bulletText: { flex: 1, fontSize: 13.5, lineHeight: 21, color: '#1F2937' },
  bulletTextMe: { flex: 1, fontSize: 13.5, lineHeight: 21, color: '#FFFFFF' },
  table: { marginTop: 8, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  tableMe: { marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tableHeaderRow: { backgroundColor: '#F9FAFB' },
  tableLastRow: { borderBottomWidth: 0 },
  tableCell: { flex: 1, paddingHorizontal: 8, paddingVertical: 8, borderRightWidth: 1, borderRightColor: '#F3F4F6' },
  tableCellText: { fontSize: 12, lineHeight: 16, color: '#374151' },
  tableCellTextMe: { fontSize: 12, lineHeight: 16, color: '#FFFFFF' },
  tableHeaderText: { fontWeight: '800', color: '#111827', fontSize: 12 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  thinkingText: { fontSize: 12, color: colors.muted, marginLeft: 4 },
  composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 16, paddingTop: 10, alignItems: 'flex-end', backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  composerInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 20, borderWidth: 0, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14, color: colors.ink, maxHeight: 110 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
});
