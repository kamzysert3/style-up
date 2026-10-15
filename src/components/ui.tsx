import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, type } from '@/theme';

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const busy = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy: loading }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.primary,
        pressed && !busy && { opacity: 0.85 },
        busy && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentInk} />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }, style]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

/** Header bar pinned to the safe area: back chevron, centered title, right slot. */
export function TopBar({
  title,
  right,
  showBack,
}: {
  title?: string;
  right?: ReactNode;
  showBack?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBarSide}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
      {title ? (
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.topBarSide} />
      )}
      <View style={[styles.topBarSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  primaryLabel: {
    color: colors.accentInk,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  secondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  secondaryLabel: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  topBarSide: {
    width: 44,
    justifyContent: 'center',
  },
  topBarTitle: {
    ...type.title,
    color: colors.ink,
    textAlign: 'center',
    flex: 1,
  },
  sectionHeading: {
    ...type.label,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
});
