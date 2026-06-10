// Autodraft resolution — run the snake in the locked order, giving each manager
// on the clock their highest-ranked still-available wishlist team, falling back
// to best-available by FIFA rank when their list is empty/exhausted (mirrors the
// original app.jsx autoPick).
import { seatForOverall, picksFor } from '../lib/snake'

export interface ResolvedPick {
  overall: number
  managerId: string
  teamId: string
}

export function resolveAutodraft(
  order: string[], // manager ids in locked seat order, length = nManagers
  wishlists: Record<string, string[]>, // managerId -> ordered team ids
  teams: Array<{ id: string; rank: number }>,
  nManagers: number,
  nRounds: number,
): ResolvedPick[] {
  const taken = new Set<string>()
  const byRank = [...teams].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  const picks: ResolvedPick[] = []
  const total = picksFor(nManagers, nRounds)

  for (let overall = 0; overall < total; overall++) {
    const seat = seatForOverall(overall, nManagers)
    const managerId = order[seat]
    const wishlist = wishlists[managerId] || []

    let teamId = wishlist.find((id) => !taken.has(id))
    if (!teamId) {
      const best = byRank.find((t) => !taken.has(t.id))
      teamId = best?.id
    }
    if (!teamId) break // shouldn't happen while total <= the 48-team field
    taken.add(teamId)
    picks.push({ overall, managerId, teamId })
  }
  return picks
}
