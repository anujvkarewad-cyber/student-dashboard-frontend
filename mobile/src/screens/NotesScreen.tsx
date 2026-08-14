import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ui';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';

const palette = [
  { tint: colors.primary, soft: colors.primarySoft },
  { tint: colors.teal, soft: colors.tealSoft },
  { tint: colors.purple, soft: colors.purpleSoft },
  { tint: '#B36A16', soft: colors.amberSoft },
];

export const NotesScreen = () => {
  const navigation = useNavigation<any>();
  const { data, refreshing, refreshNotes } = useData();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const result: Record<string, number> = {};
    data.studyNotes.forEach((note) => {
      const subject = note.subject?.trim() || 'Other';
      result[subject] = (result[subject] || 0) + 1;
    });
    return Object.entries(result)
      .filter(([subject]) => subject.toLowerCase().includes(query.trim().toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [data.studyNotes, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={groups}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        keyExtractor={([subject]) => subject}
        renderItem={({ item: [subject, count], index }) => {
          const tone = palette[index % palette.length];
          return (
            <Pressable onPress={() => navigation.navigate('NoteSubject', { subject })} style={({ pressed }) => [styles.folder, pressed && styles.pressed]}>
              <View style={[styles.folderIcon, { backgroundColor: tone.soft }]}><Ionicons name="folder-open" size={27} color={tone.tint} /></View>
              <Text style={styles.folderTitle} numberOfLines={2}>{subject}</Text>
              <Text style={styles.folderCount}>{count} {count === 1 ? 'file' : 'files'}</Text>
              <View style={styles.folderArrow}><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>
            </Pressable>
          );
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refreshNotes().catch(() => undefined)} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.header}><Text style={styles.eyebrow}>LEARNING LIBRARY</Text><Text style={styles.title}>Study material</Text><Text style={styles.subtitle}>Everything shared by your mentor, organised by subject.</Text></View>
            <View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search subjects" placeholderTextColor={colors.muted} style={styles.searchInput} /></View>
            <View style={styles.summary}><View style={styles.summaryIcon}><Ionicons name="documents-outline" size={22} color={colors.primary} /></View><View><Text style={styles.summaryValue}>{data.studyNotes.length} resources</Text><Text style={styles.summaryText}>Updated by your mentorship team</Text></View></View>
            <Text style={styles.sectionTitle}>Subjects</Text>
          </>
        }
        ListEmptyComponent={<View style={styles.emptyWrap}><EmptyState icon="folder-open-outline" title="No material found" message={query ? 'Try a different subject name.' : 'Your mentor’s notes will appear here.'} /></View>}
        ListFooterComponent={<View style={{ height: 100 }} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.lg },
  header: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.7, marginTop: 3 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  search: { height: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  summaryIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  summaryText: { color: colors.muted, fontSize: 10, marginTop: 3 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: spacing.xxl, marginBottom: spacing.md },
  columns: { justifyContent: 'space-between' },
  folder: { width: '48.5%', minHeight: 174, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  folderIcon: { width: 49, height: 49, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  folderTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', lineHeight: 19, minHeight: 38 },
  folderCount: { color: colors.muted, fontSize: 10, marginTop: 4 },
  folderArrow: { position: 'absolute', bottom: spacing.md, right: spacing.md, width: 28, height: 28, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { width: '100%' },
});
