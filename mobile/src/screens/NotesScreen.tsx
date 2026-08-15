import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { colors, radius, spacing } from '../theme';
import { CaGroup, caGroupDetails, groupsForStudent, subjectGroup } from '../utils/caGroups';

const palette = [
  { tint: colors.primary, soft: colors.primarySoft },
  { tint: colors.teal, soft: colors.tealSoft },
  { tint: colors.purple, soft: colors.purpleSoft },
  { tint: '#B36A16', soft: colors.amberSoft },
];

export const NotesScreen = () => {
  const navigation = useNavigation<any>();
  const { student, backendMode } = useAuth();
  const { data, refreshing, refreshNotes } = useData();
  const allowedGroups = useMemo(() => groupsForStudent(student?.group), [student?.group]);
  const [selectedGroup, setSelectedGroup] = useState<CaGroup>(allowedGroups[0]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!allowedGroups.includes(selectedGroup)) setSelectedGroup(allowedGroups[0]);
  }, [allowedGroups, selectedGroup]);

  // Match the web dashboard: entering Study Material always asks the existing
  // backend for the latest Drive/Sheet rows, while pull-to-refresh remains available.
  useFocusEffect(useCallback(() => {
    if (backendMode !== 'mock') refreshNotes().catch(() => undefined);
  }, [backendMode, refreshNotes]));

  const groupCounts = useMemo(() => ({
    'Group I': data.studyNotes.filter((note) => subjectGroup(note.subject) === 'Group I').length,
    'Group II': data.studyNotes.filter((note) => subjectGroup(note.subject) === 'Group II').length,
  }), [data.studyNotes]);

  const subjectFolders = useMemo(() => {
    const result: Record<string, number> = {};
    data.studyNotes
      .filter((note) => subjectGroup(note.subject) === selectedGroup)
      .forEach((note) => {
        const subject = note.subject?.trim() || 'Other';
        result[subject] = (result[subject] || 0) + 1;
      });
    return Object.entries(result)
      .filter(([subject]) => subject.toLowerCase().includes(query.trim().toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [data.studyNotes, query, selectedGroup]);

  const generalCount = data.studyNotes.filter((note) => subjectGroup(note.subject) === 'General').length;
  const selectedDetails = caGroupDetails[selectedGroup];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={subjectFolders}
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
            <View style={styles.header}><Text style={styles.eyebrow}>LEARNING LIBRARY</Text><Text style={styles.title}>Study material</Text><Text style={styles.subtitle}>Mentor resources separated according to your CA Intermediate group.</Text></View>

            <Text style={styles.groupHeading}>SELECT GROUP</Text>
            <View style={styles.groupSelector}>
              {allowedGroups.map((group) => {
                const details = caGroupDetails[group];
                const active = selectedGroup === group;
                return (
                  <Pressable key={group} onPress={() => { setSelectedGroup(group); setQuery(''); }} style={[styles.groupCard, active && { borderColor: details.color, backgroundColor: details.soft }]}>
                    <View style={[styles.groupBadge, { backgroundColor: active ? details.color : colors.canvas }]}><Text style={[styles.groupBadgeText, active && { color: '#FFFFFF' }]}>{details.short}</Text></View>
                    <Text style={[styles.groupName, active && { color: details.color }]}>{group}</Text>
                    <Text style={styles.groupFiles}>{groupCounts[group]} files</Text>
                    {active ? <Ionicons name="checkmark-circle" size={18} color={details.color} style={styles.groupCheck} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.groupInfo, { backgroundColor: selectedDetails.soft }]}>
              <View style={[styles.groupInfoIcon, { backgroundColor: selectedDetails.color }]}><Text style={styles.groupInfoIconText}>{selectedDetails.short}</Text></View>
              <View style={{ flex: 1 }}><Text style={[styles.groupInfoTitle, { color: selectedDetails.color }]}>{selectedGroup} papers</Text><Text style={styles.groupInfoPapers}>{selectedDetails.papers.join('  ·  ')}</Text></View>
            </View>

            <View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder={`Search ${selectedGroup} subjects`} placeholderTextColor={colors.muted} style={styles.searchInput} /></View>
            <View style={styles.summary}><View style={styles.summaryIcon}><Ionicons name="documents-outline" size={22} color={selectedDetails.color} /></View><View><Text style={styles.summaryValue}>{groupCounts[selectedGroup]} {selectedGroup} resources</Text><Text style={styles.summaryText}>Updated by your mentorship team</Text></View></View>
            {generalCount ? <Text style={styles.generalNotice}>{generalCount} unclassified resource{generalCount === 1 ? '' : 's'} need a subject/group mapping.</Text> : null}
            <Text style={styles.sectionTitle}>{selectedGroup} subjects</Text>
          </>
        }
        ListEmptyComponent={<View style={styles.emptyWrap}><EmptyState icon="folder-open-outline" title={`No ${selectedGroup} material found`} message={query ? 'Try a different subject name.' : 'Resources for this group will appear here after mentor upload.'} /></View>}
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
  groupHeading: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginBottom: spacing.sm },
  groupSelector: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  groupCard: { flex: 1, minHeight: 91, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#FFFFFF', padding: spacing.md, position: 'relative' },
  groupBadge: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  groupBadgeText: { color: colors.inkSoft, fontSize: 9, fontWeight: '900' },
  groupName: { color: colors.ink, fontSize: 12, fontWeight: '900', marginTop: spacing.sm },
  groupFiles: { color: colors.muted, fontSize: 8, marginTop: 2 },
  groupCheck: { position: 'absolute', top: spacing.md, right: spacing.md },
  groupInfo: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  groupInfoIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  groupInfoIconText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  groupInfoTitle: { fontSize: 11, fontWeight: '900' },
  groupInfoPapers: { color: colors.inkSoft, fontSize: 8, lineHeight: 13, marginTop: 3 },
  search: { height: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: 'rgba(255,255,255,0.76)', borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  summaryIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  summaryValue: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  summaryText: { color: colors.muted, fontSize: 10, marginTop: 3 },
  generalNotice: { color: '#8D5C05', backgroundColor: colors.amberSoft, borderRadius: radius.sm, padding: spacing.sm, fontSize: 8, marginTop: spacing.sm, textAlign: 'center' },
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
