// Snake-draft seat math — ported verbatim from the original draftboard.jsx
// (already correct). A league has N managers x R rounds = N*R overall picks,
// drawn from the 48-team field (so N*R must be <= 48).
export const N_MANAGERS = 8 // default participants
export const N_ROUNDS = 6 // default squad size
export const N_PICKS = N_MANAGERS * N_ROUNDS // default total picks (48)
export const FIELD_SIZE = 48 // total WC nations available to draft

// Configuration bounds for a league.
export const MIN_MANAGERS = 2
export const MAX_MANAGERS = 24
export const MIN_ROUNDS = 1
export const MAX_ROUNDS = 12

/** Total picks in a league of this size. */
export function picksFor(nManagers: number, nRounds: number): number {
  return nManagers * nRounds
}

/** Validate a requested league size against the bounds + the 48-team field. */
export function validateLeagueSize(nManagers: number, nRounds: number): string | null {
  if (!Number.isInteger(nManagers) || nManagers < MIN_MANAGERS || nManagers > MAX_MANAGERS) {
    return `managers must be between ${MIN_MANAGERS} and ${MAX_MANAGERS}`
  }
  if (!Number.isInteger(nRounds) || nRounds < MIN_ROUNDS || nRounds > MAX_ROUNDS) {
    return `teams per manager must be between ${MIN_ROUNDS} and ${MAX_ROUNDS}`
  }
  if (nManagers * nRounds > FIELD_SIZE) {
    return `managers x teams-per-manager (${nManagers * nRounds}) cannot exceed the ${FIELD_SIZE}-team field`
  }
  return null
}

/** Map an overall pick number to {round, col}. col = seat in the locked order. */
export function pickToCell(overall: number, n: number = N_MANAGERS): { round: number; col: number } {
  const round = Math.floor(overall / n)
  const pos = overall % n
  const col = round % 2 === 0 ? pos : n - 1 - pos
  return { round, col }
}

/** Seat (0..n-1) that is on the clock for a given overall pick. */
export function seatForOverall(overall: number, n: number = N_MANAGERS): number {
  return pickToCell(overall, n).col
}
