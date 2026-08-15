import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';
import { caGroupDetails, subjectGroup } from '../utils/caGroups';

type Props = NativeStackScreenProps<RootStackParamList, 'NoteSubject'>;

export const NoteSubjectScreen = ({ route, navigation }: Props) => {
  const { subject } = route.params;
  const { backendMode } = useAuth();
  const { data, refreshNotes } = useData();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => {
    if (backendMode !== 'mock') refreshNotes().catch(() => undefined);
  }, [backendMode, refreshNotes]));

  const allNotes = useMemo(() => data.studyNotes.filter((note) => (note.subject?.trim() || 'Other') === subject), [data.studyNotes, subject]);
  const categoryGroups = useMemo(() => {
    const groups: Record<string, typeof allNotes> = {};
    allNotes.forEach((note) => {
      const category = note.category?.trim() || 'General';
      (groups[category] ||= []).push(note);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'General') return -1;
      if (b === 'General') return 1;
      return a.localeCompare(b);
    });
  }, [allNotes]);

  const visibleNotes = useMemo(() => {
    if (!selectedCategory) return [];
    const notes = categoryGroups.find(([category]) => category === selectedCategory)?.[1] || [];
    const search = query.trim().toLowerCase();
    return search ? notes.filter((note) => `${note.title} ${note.description || ''}`.toLowerCase().includes(search)) : notes;
  }, [categoryGroups, query, selectedCategory]);

  const group = subjectGroup(subject);
  const groupDetails = group === 'General' ? null : caGroupDetails[group];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, groupDetails && { backgroundColor: groupDetails.soft }]}>
          <View style={[styles.heroIcon, groupDetails && { backgroundColor: groupDetails.color }]}><Ionicons name="folder-open" size={29} color={groupDetails ? '#FFFFFF' : colors.primary} /></View>
          <View style={styles.heroBody}>
            {groupDetails ? <Text style={[styles.groupLabel, { color: groupDetails.color }]}>{group.toUpperCase()}</Text> : null}
            <Text style={styles.heroTitle}>{subject}</Text>
            <Text style={styles.heroText}>{allNotes.length} resources · {categoryGroups.length} categor{categoryGroups.length === 1 ? 'y' : 'ies'}</Text>
          </View>
        </View>

        {!selectedCategory ? (
          <>
            <View style={styles.sectionHeader}><View><Text style={styles.sectionEyebrow}>STEP 3</Text><Text style={styles.sectionTitle}>Choose material category</Text></View><Text style={styles.sectionCount}>{categoryGroups.length} folders</Text></View>
            {categoryGroups.length ? (
              <View style={styles.categoryGrid}>
                {categoryGroups.map(([category, notes], index) => {
                  const tones = [
                    { color: colors.primary, soft: colors.primarySoft, icon: 'folder' as const },
                    { color: colors.purple, soft: colors.purpleSoft, icon: 'library' as const },
                    { color: colors.teal, soft: colors.tealSoft, icon: 'documents' as const },
                    { color: '#B36A16', soft: colors.amberSoft, icon: 'bookmark' as const },
                  ];
                  const tone = tones[index % tones.length];
                  return (
                    <Pressable key={category} onPress={() => { setSelectedCategory(category); setQuery(''); }} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
                      <View style={[styles.categoryIcon, { backgroundColor: tone.soft }]}><Ionicons name={tone.icon} size={25} color={tone.color} /></View>
                      <Text style={styles.categoryTitle} numberOfLines={2}>{category}</Text>
                      <Text style={styles.categoryCount}>{notes.length} {notes.length === 1 ? 'file' : 'files'}</Text>
                      <View style={[styles.categoryArrow, { backgroundColor: tone.soft }]}><Ionicons name="arrow-forward" size={15} color={tone.color} /></View>
                    </Pressable>
                  );
                })}
              </View>
            ) : <EmptyState icon="folder-open-outline" title="No categories yet" message="Materials will appear after the mentor assigns subject and category metadata." />}
          </>
        ) : (
          <>
            <Pressable onPress={() => { setSelectedCategory(null); setQuery(''); }} style={styles.backToCategories}><Ionicons name="arrow-back" size={17} color={colors.primary} /><Text style={styles.backText}>All categories</Text></Pressable>
            <View style={styles.categoryHeading}><View><Text style={styles.sectionEyebrow}>CATEGORY</Text><Text style={styles.sectionTitle}>{selectedCategory}</Text></View><View style={styles.fileCountPill}><Text style={styles.fileCountText}>{visibleNotes.length} files</Text></View></View>
            <View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder={`Search in ${selectedCategory}`} placeholderTextColor={colors.muted} style={styles.searchInput} /></View>

            <View style={styles.notesList}>
              {visibleNotes.length ? visibleNotes.map((item) => (
                <Pressable key={item.id} onPress={() => navigation.navigate('NotePreview', { noteId: item.id })} style={({ pressed }) => [styles.noteCard, pressed && styles.pressed]}>
                  <View style={styles.pdfIcon}><Ionicons name="document-text" size={24} color={colors.red} /></View>
                  <View style={styles.noteBody}>
                    <Text style={styles.noteTitle}>{item.title}</Text>
                    {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
                    <View style={styles.noteMeta}><Ionicons name="calendar-outline" size={12} color={colors.muted} /><Text style={styles.noteDate}>{item.date || 'Recently added'}</Text><View style={styles.previewOnly}><Ionicons name="eye-outline" size={11} color={colors.success} /><Text style={styles.previewOnlyText}>PREVIEW</Text></View></View>
                  </View>
                  <View style={styles.openIcon}><Ionicons name="eye-outline" size={18} color={colors.primary} /></View>
                </Pressable>
              )) : <EmptyState icon="document-outline" title="No matching files" message="Try another title or return to categories." />}
            </View>
          </>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.xxl },
  heroIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1 },
  groupLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  heroTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 2 },
  heroText: { color: colors.muted, fontSize: 10, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.lg },
  sectionEyebrow: { color: colors.primary, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 3 },
  sectionCount: { color: colors.muted, fontSize: 9 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  categoryCard: { width: '48.5%', minHeight: 157, backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  categoryIcon: { width: 47, height: 47, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  categoryTitle: { color: colors.ink, fontSize: 13, fontWeight: '900', lineHeight: 18, minHeight: 36 },
  categoryCount: { color: colors.muted, fontSize: 9, marginTop: 3 },
  categoryArrow: { position: 'absolute', width: 28, height: 28, right: spacing.md, bottom: spacing.md, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.995 }] },
  backToCategories: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 8, marginBottom: spacing.lg },
  backText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  categoryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  fileCountPill: { backgroundColor: colors.canvas, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 6 },
  fileCountText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  search: { height: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14 },
  notesList: { gap: spacing.md },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  pdfIcon: { width: 46, height: 51, borderRadius: 14, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center' },
  noteBody: { flex: 1 },
  noteTitle: { color: colors.ink, fontSize: 13, fontWeight: '900', lineHeight: 18 },
  description: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  noteMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  noteDate: { color: colors.muted, fontSize: 9 },
  previewOnly: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: spacing.sm },
  previewOnlyText: { color: colors.success, fontSize: 6, fontWeight: '900', letterSpacing: 0.5 },
  openIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
