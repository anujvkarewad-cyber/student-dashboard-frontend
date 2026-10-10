import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, Modal, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Card, SectionHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { targetsHaveStarted } from '../services/programGate';
import { colors, radius, spacing } from '../theme';

/**
 * Reform policy: all tests live on the app; instant answer key +
 * marking scheme after submit. Tests are created and uploaded by the
 * MENTOR (redesign/tests/*.json) — not AI generated.
 */
export const TestsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { student } = useAuth();

  const [targetsStarted, setTargetsStarted] = useState(false);
  const [showWeb, setShowWeb] = useState(false);
  const injectJs = `
    try {
      localStorage.setItem("ump_student", JSON.stringify({
        studentId: "${student?.studentId || ''}",
        password: "${student?.password || ''}"
      }));
      window.location.hash = "tests";
      
      const hideNav = () => {
         const sb = document.querySelector('.sidebar');
         const top = document.querySelector('.top-nav');
         if(sb) sb.style.display = 'none';
         if(top) top.style.display = 'none';
         const main = document.querySelector('.main-content');
         if(main) { main.style.marginLeft = '0'; main.style.marginTop = '0'; main.style.paddingTop = '10px'; }
      };
      setInterval(hideNav, 500); hideNav();
    } catch(e) {}
    true;
  `;

  useEffect(() => {
    if (!student?.studentId) {
      setTargetsStarted(false);
      return;
    }
    let alive = true;
    targetsHaveStarted(student.studentId).then((started) => { if (alive) setTargetsStarted(started); });
    return () => { alive = false; };
  }, [student?.studentId]);


  return (
    <View style={styles.page}>
      <Modal visible={showWeb} animationType="slide" onRequestClose={() => setShowWeb(false)}>
        <View style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingTop: 50 }}>
            <Pressable onPress={() => setShowWeb(false)} style={{ padding: 5 }}>
              <Ionicons name="close" size={28} color={colors.ink} />
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: 'bold', marginLeft: 15 }}>Mentor Tests Portal</Text>
          </View>
          <WebView 
            source={{ uri: 'https://ump-dashboard.web.app/#tests' }}
            injectedJavaScriptBeforeContentLoaded={injectJs}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.canvas }}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          />
        </View>
      </Modal>

      <View style={styles.header}>
        <Text style={styles.title}>Tests</Text>
        <Text style={styles.subtitle}>Mentor's tests — instant answer key + marking scheme after submit</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Weekly Report — this week's full record: study hours, tests given, MCQ report */}
        <Pressable onPress={() => navigation.navigate('WeeklyReport')}>
          <Card style={styles.weekCard}>
            <View style={styles.weekIconBox}><Ionicons name="calendar" size={22} color="#fff" /></View>
            <View style={styles.testCopy}>
              <Text style={styles.weekTitle}>Weekly Report</Text>
              <Text style={styles.weekSub}>This week's record — study hours, tests you gave, MCQ report</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.85)" />
          </Card>
        </Pressable>

        <SectionHeader title="Mentor tests" />
        
        <Pressable onPress={() => setShowWeb(true)}>
          <Card style={[styles.testCard, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
            <View style={styles.testIconBox}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
            <View style={styles.testCopy}>
              <Text style={styles.testTitle}>Mentor Tests Portal</Text>
              <Text style={styles.testMeta}>Open to view question papers, upload answers, and submit your marks.</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.primary} />
          </Card>
        </Pressable>


        <SectionHeader title="Practice" />
        {([
          ['flame', 'Daily MCQ Challenge', '10 questions for today — do them daily', colors.amber, colors.amberSoft, () => navigation.navigate('DailyMcq')],
          ['trophy', 'Leaderboard', 'Ranked on your test marks and Daily MCQ score', colors.teal, colors.tealSoft, () => navigation.navigate('Leaderboard')],
        ] as Array<[keyof typeof Ionicons.glyphMap, string, string, string, string, () => void]>).map(([icon, title, sub, tint, soft, go]) => (
          <Pressable key={title} onPress={go}>
            <Card style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: soft }]}><Ionicons name={icon} size={22} color={tint} /></View>
              <View style={styles.copy}>
                <Text style={styles.rowTitle}>{title}</Text>
                <Text style={styles.rowSub}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingTop: 56, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 110, gap: spacing.sm },
  testCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm },
  testIconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  weekCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.primary, borderColor: colors.primaryDark },
  weekIconBox: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  testCopy: { flex: 1 },
  testTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  testMeta: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  weekTitle: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  weekSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.88)', marginTop: 2, lineHeight: 16 },
  testChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  testChip: { fontSize: 10, fontWeight: '800', color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  rowTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
