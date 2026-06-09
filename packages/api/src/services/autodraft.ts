// Autodraft resolution — run the snake in the locked order, giving each manager
// on the clock their highest-ranked still-available wishlist team, falling back
// to best-available by FIFA rank when their list is empty/exhausted (mirrors the
// original app.jsx autoPick).
import { seatForOverall, N_PICKS, N_MANAGERS } from '../lib/snake'

export interface ResolvedPick {
  overall: number
  managerId: string
  teamId: string
}

export function resolveAutodraft(
  order: string[], // manager ids in locked seat order, length = N_MANAGERS
  wishlists: Record<string, string[]>, // managerId -> ordered team ids
  teams: Array<{ id: string; rank: number }>,
): ResolvedPick[] {
  const taken = new Set<string>()
  const byRank = [...teams].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  const picks: ResolvedPick[] = []

  for (let overall = 0; overall < N_PICKS; overall++) {
    const seat = seatForOverall(overall, N_MANAGERS)
    const managerId = order[seat]
    const wishlist = wishlists[managerId] || []

    let teamId = wishlist.find((id) => !taken.has(id))
    if (!teamId) {
      const best = byRank.find((t) => !taken.has(t.id))
      teamId = best?.id
    }
    if (!teamId) break // shouldn't happen with 48 teams / 48 picks
    taken.add(teamId)
    picks.push({ overall, managerId, teamId })
  }
  return picks
}
