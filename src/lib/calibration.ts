/**
 * Calibration — how often the model's score matches the user's own.
 * M1 acceptance: agreement within ±5 on at least 16 of 20 real outfits.
 */

/** Model and user scores this close count as agreement. */
export const AGREEMENT_TOLERANCE = 5;

export function isAgreement(score: number, userScore: number): boolean {
  return Math.abs(score - userScore) <= AGREEMENT_TOLERANCE;
}

export interface AgreementStats {
  /** Outfits the user has scored themselves. */
  rated: number;
  /** Of those, how many the model scored within the tolerance. */
  agreed: number;
}

export function agreementStats(
  records: { score: number; userScore: number | null }[],
): AgreementStats {
  let rated = 0;
  let agreed = 0;
  for (const record of records) {
    if (record.userScore === null) continue;
    rated += 1;
    if (isAgreement(record.score, record.userScore)) agreed += 1;
  }
  return { rated, agreed };
}
