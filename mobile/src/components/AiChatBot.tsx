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

/**
 * Global AI study assistant — floating button above the bottom tab bar,
 * visible on every screen. Tapping opens the popup chat bot.
 * After a focus session ends, the bot opens automatically and runs a
 * revision round: "which chapter did you study?" → related questions →
 * checks what the student remembers.
 */
export const AiChatBot = () => {
  const { student } = useAuth();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Msg[]>([{ me: false, text: WELCOME }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<ScrollView>(null);

  // revision round state
  const [revStage, setRevStage] = useState<RevStage>(null);
  const [revChapter, setRevChapter] = useState<OfficialMcqChapter | null>(null);
  const [revQuestions, setRevQuestions] = useState<DailyMcqQuestion[]>([]);
  const [revIndex, setRevIndex] = useState(0);
  const [revScore, setRevScore] = useState(0);

  const push = useCallback((m: Msg) => {
    setChat((prev) => [...prev, m]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
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

  // let other screens (Focus timer) open the bot
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
        text: correct
          ? `✅ Correct! ${q.explanation}`
          : `❌ Not quite — the answer is ${'ABCD'[q.answer]}. ${q.explanation}`,
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
            text: finalScore >= 2
              ? `Revision round done — ${finalScore}/${revQuestions.length} correct. Strong! Chapter marked as revised. Keep it up! 💪`
              : `Revision round done — ${finalScore}/${revQuestions.length} correct. No stress — revise the chapter once more tonight and try me again tomorrow.`,
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
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

            <ScrollView ref={listRef} style={styles.chatArea} contentContainerStyle={styles.chatList} onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}>
              {chat.map((m, i) => (
                <View key={i} style={[styles.bubble, m.me ? styles.bubbleMe : styles.bubbleAi]}>
                  <Text style={[styles.bubbleText, m.me && { color: '#fff' }]}>{m.text}</Text>
                </View>
              ))}
              {thinking ? (
                <View style={styles.bubbleAi}><Text style={styles.bubbleText}>AI is thinking…</Text></View>
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
  sheet: { height: '82%', backgroundColor: colors.canvas, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetTitleBox: { flex: 1 },
  sheetTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  sheetSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  chatArea: { flex: 1 },
  chatList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: 8 },
  bubble: { maxWidth: '86%', borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleAi: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 13, lineHeight: 19, color: colors.ink },
  composer: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, paddingBottom: 16, paddingTop: 8, alignItems: 'center', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  composerInput: { flex: 1, backgroundColor: colors.canvas, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 11, fontSize: 13.5, color: colors.ink },
  sendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
});
