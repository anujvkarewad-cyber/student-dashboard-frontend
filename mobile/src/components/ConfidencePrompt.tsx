import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Confidence, MISTAKE_LABEL, type MistakeType } from '../services/adaptiveEngine';
import { colors, radius, spacing } from '../theme';

const CONFIDENCE_OPTIONS: { value: Confidence; label: string; hint: string; tone: string }[] = [
  { value: 'Low', label: 'Low', hint: 'Guessed', tone: '#B3261E' },
  { value: 'Medium', label: 'Medium', hint: 'Fairly sure', tone: '#9A6400' },
  { value: 'High', label: 'High', hint: 'Certain', tone: '#1B7F3B' },
];

const MISTAKE_OPTIONS: { value: MistakeType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'concept', icon: 'book-outline' },
  { value: 'application', icon: 'git-branch-outline' },
  { value: 'calculation', icon: 'calculator-outline' },
  { value: 'misread', icon: 'eye-outline' },
  { value: 'guess', icon: 'help-circle-outline' },
];

/**
 * Shown right after an answer is recorded.
 *
 * Confidence is asked on every answer because the schedule depends on it - a
 * confident wrong answer is the single strongest signal that a concept was
 * never really learned, so it is pushed back to a 1-day loop. The mistake
 * reason is only asked when the answer was wrong, because that is the only
 * time it exists, and it is kept to one tap to avoid making practice feel like
 * a survey.
 */
export const ConfidencePrompt = ({
  correct,
  confidence,
  mistakeType,
  conceptLabel,
  onConfidence,
  onMistake,
  onSkip,
}: {
  correct: boolean;
  confidence?: Confidence;
  mistakeType?: MistakeType;
  conceptLabel: string;
  onConfidence: (value: Confidence) => void;
  onMistake: (value: MistakeType) => void;
  onSkip: () => void;
}) => {
  const needsMistake = !correct && confidence != null && mistakeType == null;

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <View style={[styles.badge, correct ? styles.badgeOk : styles.badgeBad]}>
          <Ionicons
            name={correct ? 'checkmark-circle' : 'close-circle'}
            size={14}
            color={correct ? '#1B7F3B' : '#B3261E'}
          />
          <Text style={[styles.badgeText, { color: correct ? '#1B7F3B' : '#B3261E' }]}>
            {correct ? 'Correct' : 'Incorrect'}
          </Text>
        </View>
        <Text style={styles.concept} numberOfLines={1}>{conceptLabel}</Text>
        <Pressable onPress={onSkip} hitSlop={10}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {!needsMistake ? (
        <>
          <Text style={styles.question}>How confident were you?</Text>
          <View style={styles.row}>
            {CONFIDENCE_OPTIONS.map((option) => {
              const active = confidence === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onConfidence(option.value)}
                  style={[styles.tile, active && { borderColor: option.tone, backgroundColor: '#FFFFFF' }]}
                >
                  <Text style={[styles.tileLabel, active && { color: option.tone }]}>{option.label}</Text>
                  <Text style={styles.tileHint}>{option.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.question}>What went wrong?</Text>
          <View style={styles.wrap}>
            {MISTAKE_OPTIONS.map((option) => {
              const active = mistakeType === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onMistake(option.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Ionicons name={option.icon} size={13} color={active ? '#FFFFFF' : colors.inkSoft} />
                  <Text style={[styles.chipText, active && { color: '#FFFFFF' }]}>
                    {MISTAKE_LABEL[option.value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#F7F8FA',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeOk: { backgroundColor: '#E7F6EC' },
  badgeBad: { backgroundColor: '#FDECEC' },
  badgeText: { fontSize: 10, fontWeight: '900' },
  concept: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.muted },
  skip: { fontSize: 11, fontWeight: '800', color: colors.muted },
  question: { fontSize: 12, fontWeight: '800', color: colors.ink, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  tileLabel: { fontSize: 13, fontWeight: '900', color: colors.ink },
  tileHint: { fontSize: 9, fontWeight: '700', color: colors.muted, marginTop: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 11, fontWeight: '800', color: colors.inkSoft },
});
