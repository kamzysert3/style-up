import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { PrimaryButton, SecondaryButton, TopBar } from '@/components/ui';
import { deleteOutfit, getOutfit, type OutfitRecord } from '@/lib/db';
import { colors, spacing, type, scoreBandLabel, scoreColor } from '@/theme';

const SUBSCORE_LABELS: { key: keyof OutfitRecord['subscores']; label: string }[] = [
  { key: 'fit_silhouette', label: 'Fit & silhouette' },
  { key: 'color_harmony', label: 'Color harmony' },
  { key: 'occasion_appropriateness', label: 'Occasion fit' },
  { key: 'style_coherence', label: 'Style coherence' },
  { key: 'styling_details', label: 'Styling details' },
];

export default function ScoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [record, setRecord] = useState<OutfitRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const parsedId = Number(id);
      const found = Number.isFinite(parsedId) ? await getOutfit(db, parsedId) : null;
      if (cancelled) return;
      if (!found) {
        setMissing(true);
        return;
      }
      setRecord(found);
      const reduced = await AccessibilityInfo.isReduceMotionEnabled();
      if (cancelled) return;
      if (reduced) {
        progress.setValue(1);
      } else {
        Animated.timing(progress, {
          toValue: 1,
          duration: 550,
          easing: (t) => 1 - (1 - t) ** 3, // ease-out cubic
          useNativeDriver: false,
        }).start();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, db, progress]);

  const confirmDelete = useCallback(() => {
    if (!record) return;
    Alert.alert('Delete this score?', 'The photo and its score will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteOutfit(db, record.id);
          if (router.canGoBack()) router.back();
          else router.replace('/history');
        },
      },
    ]);
  }, [record, db, router]);

  if (missing) {
    return (
      <View style={styles.fill}>
        <TopBar showBack />
        <View style={styles.centered}>
          <Text style={styles.summary}>This score no longer exists.</Text>
          <PrimaryButton
            label="Back to camera"
            onPress={() => router.replace('/')}
            style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
          />
        </View>
      </View>
    );
  }

  if (!record) {
    return (
      <View style={styles.fill}>
        <TopBar showBack />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  const dateLabel = new Date(record.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <View style={styles.fill}>
      <TopBar
        showBack
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete this score"
            hitSlop={12}
            onPress={confirmDelete}
            style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="trash-outline" size={22} color={colors.ink} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={{ uri: record.photoUri }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
        />

        {/* ---- the score: the hero ---- */}
        <View style={styles.scoreBlock}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreNumber, { color: scoreColor(record.score) }]}>
              {record.score}
            </Text>
            <View style={styles.scoreMeta}>
              <Text style={styles.scoreBand}>{scoreBandLabel(record.score)}</Text>
              <Text style={styles.caption}>out of 100 · {dateLabel}</Text>
            </View>
          </View>
          {record.summary ? <Text style={styles.summary}>{record.summary}</Text> : null}
          {record.model ? (
            <Text style={styles.provenance}>Scored by {record.model}</Text>
          ) : null}
        </View>

        {/* ---- subscores ---- */}
        <View style={styles.section}>
          {SUBSCORE_LABELS.map(({ key, label }) => {
            const value = record.subscores[key];
            return (
              <View key={key} style={styles.barRow}>
                <View style={styles.barLabelRow}>
                  <Text style={styles.barLabel}>{label}</Text>
                  <Text style={styles.barValue}>{value}</Text>
                </View>
                <View style={styles.barTrack}>
                  <Animated.View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: scoreColor(value),
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', `${value}%`],
                        }),
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {/* ---- strengths ---- */}
        {record.strengths.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>What works</Text>
            {record.strengths.map((item, i) => (
              <View key={i} style={styles.listItem}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.good}
                  style={styles.listIcon}
                />
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ---- improvements ---- */}
        {record.improvements.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>To improve it</Text>
            {record.improvements.map((item, i) => (
              <View key={i} style={styles.listItem}>
                <Text style={styles.improveNumber}>
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ---- actions ---- */}
        <View style={styles.actions}>
          <PrimaryButton label="Shoot next outfit" onPress={() => router.replace('/')} />
          <SecondaryButton
            label="View history"
            onPress={() => router.replace('/history')}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -10,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },

  photo: {
    width: '100%',
    height: 380,
    backgroundColor: colors.surface,
  },

  scoreBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  scoreNumber: {
    ...type.score,
  },
  scoreMeta: {
    paddingBottom: spacing.md,
    gap: 2,
  },
  scoreBand: {
    ...type.title,
    color: colors.ink,
  },
  caption: {
    ...type.caption,
    color: colors.inkMuted,
  },
  summary: {
    ...type.bodyLg,
    color: colors.ink,
  },
  provenance: {
    ...type.caption,
    color: colors.inkMuted,
  },

  section: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  sectionHeading: {
    ...type.label,
    fontWeight: '600',
    color: colors.ink,
  },

  barRow: { gap: 6 },
  barLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  barLabel: {
    ...type.label,
    color: colors.inkMuted,
  },
  barValue: {
    ...type.label,
    fontWeight: '700',
    color: colors.ink,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },

  listItem: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  listIcon: { marginTop: 2 },
  improveNumber: {
    ...type.label,
    fontWeight: '700',
    color: colors.accent,
    width: 24,
    marginTop: 2,
  },
  listText: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },

  actions: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
  },
});
