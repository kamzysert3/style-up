/**
 * What the outfit is for. The proxy scores through this lens, so the same
 * outfit can fairly score differently for the gym and for a wedding.
 * Keep the ids in sync with OCCASIONS in proxy/src/rubric.ts.
 */
export const OCCASIONS = [
  { id: 'everyday', label: 'Everyday' },
  { id: 'work', label: 'Work' },
  { id: 'evening', label: 'Evening out' },
  { id: 'formal', label: 'Formal' },
  { id: 'active', label: 'Active' },
] as const;

export type Occasion = (typeof OCCASIONS)[number]['id'];

export const DEFAULT_OCCASION: Occasion = 'everyday';

export function isOccasion(value: unknown): value is Occasion {
  return OCCASIONS.some((o) => o.id === value);
}

export function occasionLabel(occasion: Occasion): string {
  return OCCASIONS.find((o) => o.id === occasion)?.label ?? 'Everyday';
}
