import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, shadow, spacing } from '../theme';

/**
 * v1.11.0 — Home hub: every reform feature one tap away
 * (daily target, mentor tests, messenger, reminders).
 */
export const ReformHubCards = ({ navigation }: { navigation: NativeStackNavigationProp<RootStackParamList> }) => {
  const items: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; tint: string; soft: string; go: () => void }> = [
    { icon: 'flag', label: "Today's Target", sub: 'Finish today to unlock tomorrow', tint: colors.amber, soft: colors.amberSoft, go: () => navigation.navigate('DailyTarget') },
    { icon: 'clipboard', label: 'Mentor Tests', sub: 'Answer key + marking scheme', tint: colors.purple, soft: colors.purpleSoft, go: () => navigation.navigate('Tests') },
    { icon: 'chatbubbles', label: 'Mentor Messages', sub: 'Problem? Write to us here', tint: colors.teal, soft: colors.tealSoft, go: () => navigation.navigate('Messages') },
    { icon: 'notifications', label: 'Reminders', sub: 'Free in-app reminders', tint: colors.primary, soft: colors.primarySoft, go: () => navigation.navigate('Reminders') },
  ];

  return (
    <View style={styles.grid}>
      {items.map((it) => (
        <Pressable key={it.label} onPress={it.go} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={[styles.iconBox, { backgroundColor: it.soft }]}>
            <Ionicons name={it.icon} size={20} color={it.tint} />
          </View>
          <Text style={styles.label}>{it.label}</Text>
          <Text style={styles.sub} numberOfLines={2}>{it.sub}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.md },
  card: { width: '48%', backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.94)', padding: spacing.md, gap: 6, ...shadow },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  iconBox: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 10.5, color: colors.muted, lineHeight: 14 },
});
