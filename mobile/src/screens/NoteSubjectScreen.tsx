import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ui';
import { useData } from '../context/DataContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';
import type { StudyNote } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'NoteSubject'>;

const openNote = async (note: StudyNote) => {
  const url = note.url || (note.fileId ? `https://drive.google.com/file/d/${note.fileId}/view` : '');
  if (!url) {
    Alert.alert('Preview unavailable', 'This sample resource has no live file. Connected backend resources will open here.');
    return;
  }
  const supported = await Linking.canOpenURL(url);
  if (supported) await Linking.openURL(url);
  else Alert.alert('Cannot open file', 'The resource link is not valid.');
};

export const NoteSubjectScreen = ({ route }: Props) => {
  const { subject } = route.params;
  const { data } = useData();
  const [query, setQuery] = useState('');

  const notes = useMemo(() => data.studyNotes.filter((note) =>
    (note.subject?.trim() || 'Other') === subject &&
    `${note.title} ${note.description || ''} ${note.category || ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [data.studyNotes, query, subject]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable onPress={() => openNote(item)} style={({ pressed }) => [styles.noteCard, pressed && { opacity: 0.78 }]}>
            <View style={styles.pdfIcon}><Ionicons name="document-text" size={24} color={colors.red} /></View>
            <View style={styles.noteBody}>
              {item.category ? <Text style={styles.category}>{item.category.toUpperCase()}</Text> : null}
              <Text style={styles.noteTitle}>{item.title}</Text>
              {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
              <View style={styles.noteMeta}><Ionicons name="calendar-outline" size={12} color={colors.muted} /><Text style={styles.noteDate}>{item.date || 'Recently added'}</Text></View>
            </View>
            <View style={styles.openIcon}><Ionicons name="open-outline" size={18} color={colors.primary} /></View>
          </Pressable>
        )}
        ListHeaderComponent={
          <>
            <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="folder-open" size={30} color={colors.primary} /></View><View style={styles.heroBody}><Text style={styles.heroTitle}>{subject}</Text><Text style={styles.heroText}>{notes.length} available resources</Text></View></View>
            <View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search in this subject" placeholderTextColor={colors.muted} style={styles.searchInput} /></View>
            <Text style={styles.section}>Files</Text>
          </>
        }
        ListEmptyComponent={<EmptyState icon="document-outline" title="No matching files" message="Try another title or category." />}
        ListFooterComponent={<View style={{ height: 30 }} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1 },
  heroTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  heroText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  search: { height: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14 },
  section: { color: colors.ink, fontSize: 17, fontWeight: '900', marginVertical: spacing.xl },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  pdfIcon: { width: 46, height: 51, borderRadius: 14, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center' },
  noteBody: { flex: 1 },
  category: { color: colors.primary, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  noteTitle: { color: colors.ink, fontSize: 13, fontWeight: '900', lineHeight: 18 },
  description: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  noteDate: { color: colors.muted, fontSize: 9 },
  openIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
