import { Ionicons } from '@expo/vector-icons';
import React, { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

export const Card = ({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) => (
  <View style={[styles.card, style]}>{children}</View>
);

export const SectionHeader = ({ title, action }: { title: string; action?: ReactNode }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {action}
  </View>
);

export const PrimaryButton = ({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
}) => {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'danger' && styles.dangerButton,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.primary : colors.surface} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={19} color={variant === 'secondary' ? colors.primary : colors.surface} /> : null}
          <Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryButtonText]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
};

export const FormInput = ({ label, error, style, ...props }: TextInputProps & { label: string; error?: string; style?: StyleProp<TextStyle> }) => (
  <View style={styles.inputGroup}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      placeholderTextColor={colors.muted}
      selectionColor={colors.primary}
      style={[styles.input, error && styles.inputError, style]}
      {...props}
    />
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>
);

export const InitialsAvatar = ({ name, size = 44 }: { name: string; size?: number }) => {
  const initials = name.split(' ').filter(Boolean).map((word) => word[0]).slice(0, 2).join('').toUpperCase() || 'S';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
};

export const EmptyState = ({ icon, title, message }: { icon: keyof typeof Ionicons.glyphMap; title: string; message: string }) => (
  <View style={styles.empty}>
    <View style={styles.emptyIcon}><Ionicons name={icon} size={28} color={colors.primary} /></View>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyMessage}>{message}</Text>
  </View>
);

export const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <View style={styles.banner}>
    <Ionicons name="cloud-offline-outline" size={20} color={colors.red} />
    <Text style={styles.bannerText}>{message}</Text>
    {onRetry ? (
      <Pressable onPress={onRetry}><Text style={styles.retry}>Retry</Text></Pressable>
    ) : null}
  </View>
);

export const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', letterSpacing: -0.25 },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#CFDAFF' },
  dangerButton: { backgroundColor: colors.red },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '800' },
  secondaryButtonText: { color: colors.primary },
  inputGroup: { gap: spacing.sm },
  label: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.ink,
    fontSize: 16,
  },
  inputError: { borderColor: colors.red },
  errorText: { color: colors.red, fontSize: 12, fontWeight: '600' },
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryDark, fontWeight: '900' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', marginBottom: spacing.xs },
  emptyMessage: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.redSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  bannerText: { color: colors.inkSoft, flex: 1, fontSize: 13, lineHeight: 18 },
  retry: { color: colors.primary, fontWeight: '800' },
  chip: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.primaryDark },
});
