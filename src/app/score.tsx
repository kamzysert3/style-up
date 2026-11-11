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
import { AGREEMENT_TOLERANCE, isAgreement } from '@/lib/calibration';
import { deleteOutfit, getOutfit, setUserScore, type OutfitRecord } from '@/lib/db';
import { occasionLabel } from '@/lib/occasion';
import { colors, radius, spacing, type, scoreBandLabel, scoreColor } from '@/theme';

const STEPS = [-5, -1, 1, 5] as const;

/**
 * Calibration input: the user's own 0-100 score for this outfit. Starts on the
 * model's number so agreeing is one tap and disagreeing is a few.
 */
function UserScoreSection({
  modelScore,
  saved,
  onSave,
}: {
  modelScore: number;
  saved: number | null;
  onSave: (value: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(saved ?? modelScore);
  const dirty = draft !== saved;

  let verdict = 'Not rated yet. Your number is what the scale gets calibrated against.';
  if (saved !== null) {
    const gap = Math.abs(modelScore - saved);
    verdict = isAgreement(modelScore, saved)
      ? `You gave it ${saved}. The model is within ±${AGREEMENT_TOLERANCE}, so this one agrees.`
      : `You gave it ${saved}. The model is off by ${gap}, so this one disagrees.`;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>Your score</Text>
      <View style={styles.stepperRow}>
        {STEPS.slice(0, 2).map((step) => (
          <StepButton key={step} step={step} onPress={() => setDraft((d) => clampScore(d + step))} />
        ))}
        <Text
          style={[styles.draftValue, dirty && { color: colors.inkMuted }]}
          accessibilityLabel={`Your score: ${draft}${dirty ? ', not saved' : ''}`}
        >
          {draft}
        </Text>
        {STEPS.slice(2).map((step) => (
          <StepButton key={step} step={step} onPress={() => setDraft((d) => clampScore(d + step))} />
        ))}
      </View>
      <Text style={styles.caption}>{verdict}</Text>
      {dirty ? (
        <SecondaryButton
          label={saved === null ? 'Save my score' : 'Update my score'}
          onPress={() => void onSave(draft)}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => void onSave(null)}
          style={({ pressed }) => [styles.clearButton, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.clearLabel}>Clear my score</Text>
        </Pressable>
      )}
    </View>
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function StepButton({ step, onPress }: { step: number; onPress: () => void }) {
  const amount = Math.abs(step);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={step < 0 ? `Lower by ${amount}` : `Raise by ${amount}`}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.stepLabel}>{step < 0 ? `−${amount}` : `+${amount}`}</Text>
    </Pressable>
  );
}

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

  const saveUserScore = useCallback(
    async (value: number | null) => {
      if (!record) return;
      await setUserScore(db, record.id, value);
      setRecord({ ...record, userScore: value });
    },
    [record, db],
  );

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
              <Text style={styles.caption}>
                out of 100 · {occasionLabel(record.occasion)} · {dateLabel}
              </Text>
            </View>
          </View>
          {record.summary ? <Text style={styles.summary}>{record.summary}</Text> : null}
          {record.model ? (
            <Text style={styles.provenance}>
              Scored by {record.model}
              {record.fallback
                ? ', a fallback model. Its scale can differ from your usual one.'
                : ''}
            </Text>
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

        {/* ---- calibration: the user's own score ---- */}
        <UserScoreSection
          key={record.id}
          modelScore={record.score}
          saved={record.userScore}
          onSave={saveUserScore}
        />

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

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stepButton: {
    width: 52,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    ...type.body,
    fontWeight: '600',
    color: colors.ink,
  },
  draftValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -1,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  clearButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  clearLabel: {
    ...type.label,
    color: colors.inkMuted,
    textDecorationLine: 'underline',
  },

  actions: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
  },
});
