import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { PrimaryButton, TopBar } from '@/components/ui';
import { deleteOutfit, listOutfits, type OutfitRecord } from '@/lib/db';
import { colors, radius, spacing, type, scoreColor } from '@/theme';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<OutfitRecord[] | null>(null);

  const load = useCallback(async () => {
    setRecords(await listOutfits(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmDelete = useCallback(
    (record: OutfitRecord) => {
      Alert.alert('Delete this score?', 'The photo and its score will be removed.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteOutfit(db, record.id);
            await load();
          },
        },
      ]);
    },
    [db, load],
  );

  const count = records?.length ?? 0;
  const average = count > 0 ? Math.round(records!.reduce((a, r) => a + r.score, 0) / count) : null;

  return (
    <View style={styles.fill}>
      <TopBar showBack />
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        {count > 0 ? (
          <Text style={styles.subtitle}>
            {count} {count === 1 ? 'outfit' : 'outfits'} · average {average}
          </Text>
        ) : null}
      </View>

      {records !== null && count === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="image-outline" size={44} color={colors.inkMuted} />
          <Text style={styles.emptyTitle}>Nothing scored yet</Text>
          <Text style={styles.emptyBody}>
            Photos you score collect here. This is your calibration set — the more you score,
            the better StyleUp matches your taste.
          </Text>
          <PrimaryButton
            label="Score an outfit"
            onPress={() => router.replace('/')}
            style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
          />
        </View>
      ) : null}

      {count > 0 ? (
        <FlatList
          data={records ?? []}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{
            paddingHorizontal: spacing.xl,
            paddingBottom: insets.bottom + spacing.xxxl,
            gap: spacing.md,
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Outfit scored ${item.score} out of 100`}
              onPress={() => router.push({ pathname: '/score', params: { id: String(item.id) } })}
              onLongPress={() => confirmDelete(item)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
            >
              <Image
                source={{ uri: item.photoUri }}
                style={styles.tileImage}
                contentFit="cover"
                transition={100}
              />
              <View style={styles.badge}>
                <Text style={[styles.badgeText, { color: scoreColor(item.score) }]}>
                  {item.score}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    ...type.screenTitle,
    color: colors.ink,
  },
  subtitle: {
    ...type.caption,
    color: colors.inkMuted,
  },

  row: { gap: spacing.md },
  tile: {
    flex: 1,
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tileImage: { flex: 1 },
  badge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.scrim,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    minWidth: 40,
    alignItems: 'center',
  },
  badgeText: {
    ...type.label,
    fontWeight: '800',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  emptyTitle: {
    ...type.title,
    color: colors.ink,
    marginTop: spacing.lg,
  },
  emptyBody: {
    ...type.body,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
