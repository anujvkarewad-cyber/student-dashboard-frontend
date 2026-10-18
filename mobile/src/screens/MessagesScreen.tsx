import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchMessages, sendMessage, type ChatMessage } from '../api/reformApi';
import { EmptyState } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme';

/**
 * Reform policy item 8: "one more thing like one messenger where students
 * can message you and talk about their problems."
 */
export const MessagesScreen = () => {
  const { student } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    if (!student) return;
    const payload = await fetchMessages(student.studentId);
    setMessages(payload?.messages || []);
  }, [student]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // mentor reply polling
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !student || sending) return;
    setSending(true);
    const res = await sendMessage(student.studentId, text, (student as any).studentName, (student as any).batch);
    setSending(false);
    if (res?.message) setMessages((prev) => [...(prev || []), res.message]);
    else setMessages((prev) => [...(prev || []), { id: `local-${Date.now()}`, from: 'student', text, at: new Date().toISOString() }]);
    setDraft('');
  };

  if (messages === null) {
    return <EmptyState icon="chatbubbles-outline" title="Loading messages" message="Talk to your mentor directly — problems, doubts, everything here." />;
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages yet" message="Write your problem or doubt to your mentor — the reply arrives right here." />}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.from === 'student' ? styles.bubbleMine : styles.bubbleMentor]}>
            <Text style={[styles.bubbleText, item.from === 'student' && { color: '#fff' }]}>{item.text}</Text>
            <Text style={[styles.bubbleTime, item.from === 'student' && { color: 'rgba(255,255,255,0.75)' }]}>
              {new Date(item.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message your mentor…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
        />
        <Pressable style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]} onPress={send} disabled={!draft.trim() || sending}>
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleMentor: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  bubbleTime: { fontSize: 10, color: colors.muted, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.xl, paddingBottom: 16, paddingTop: 8, alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.ink, maxHeight: 110 },
  sendBtn: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.45 },
});
