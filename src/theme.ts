/**
 * StyleUp design tokens — dark, photography-first, editorial.
 * See PRODUCT.md: score is the hero, gold is the only accent,
 * green/red are reserved for score semantics (never used for UI chrome).
 */

export const colors = {
  bg: '#0D0D0F',
  surface: '#17171A',
  surfaceAlt: '#202024',
  border: '#2B2B31',
  ink: '#F2F0EA',
  inkMuted: '#A3A3AB',
  accent: '#E5C07B',
  accentInk: '#0D0D0F',
  good: '#7BC96F',
  bad: '#F26D6D',
  scrim: 'rgba(0,0,0,0.55)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
} as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 14, lineHeight: 19 },
  body: { fontSize: 16, lineHeight: 23 },
  bodyLg: { fontSize: 18, lineHeight: 26 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const },
  screenTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.6,
  },
  score: {
    fontSize: 96,
    lineHeight: 104,
    fontWeight: '800' as const,
    letterSpacing: -4,
  },
} as const;

export type ScoreBand = 'great' | 'solid' | 'off';

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'great';
  if (score >= 60) return 'solid';
  return 'off';
}

/** Color for a score value. 'solid' is neutral ink by design — gold is UI-only. */
export function scoreColor(score: number): string {
  const band = scoreBand(score);
  if (band === 'great') return colors.good;
  if (band === 'off') return colors.bad;
  return colors.ink;
}

/** Band label — score meaning never rides on color alone. */
export function scoreBandLabel(score: number): string {
  const band = scoreBand(score);
  if (band === 'great') return 'Great';
  if (band === 'solid') return 'Solid';
  return 'Needs work';
}
