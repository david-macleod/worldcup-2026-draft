// Snake-draft seat math — ported verbatim from the original draftboard.jsx
// (already correct). N managers, 6 rounds → 48 overall picks for the WC field.
export const N_MANAGERS = 8
export const N_ROUNDS = 6
export const N_PICKS = N_MANAGERS * N_ROUNDS // 48

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
