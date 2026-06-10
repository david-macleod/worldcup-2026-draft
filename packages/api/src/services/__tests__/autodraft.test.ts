import { describe, it, expect } from 'vitest'
import { resolveAutodraft } from '../autodraft'
import { N_PICKS } from '../../lib/snake'

// 48 fabricated teams t0..t47 with rank = index (t0 best).
const TEAMS = Array.from({ length: 48 }, (_, i) => ({ id: `t${i}`, rank: i }))
const ORDER = Array.from({ length: 8 }, (_, i) => `m${i}`)

describe('resolveAutodraft', () => {
  it('fills exactly 48 distinct picks', () => {
    const picks = resolveAutodraft(ORDER, {}, TEAMS, 8, 6)
    expect(picks).toHaveLength(N_PICKS)
    expect(new Set(picks.map((p) => p.teamId)).size).toBe(N_PICKS)
  })

  it('with empty wishlists, falls back to best-available by rank (snake order)', () => {
    const picks = resolveAutodraft(ORDER, {}, TEAMS, 8, 6)
    // overall 0 (seat 0) takes the best team t0; overall 1 takes t1; ...
    expect(picks[0]).toEqual({ overall: 0, managerId: 'm0', teamId: 't0' })
    expect(picks[1]).toEqual({ overall: 1, managerId: 'm1', teamId: 't1' })
    // snake: overall 8 is seat 7 again
    expect(picks[8].managerId).toBe('m7')
  })

  it('honours a wishlist then falls back when it is exhausted', () => {
    // m0 wishes for t40, t41 (low-ranked) before anything else
    const picks = resolveAutodraft(ORDER, { m0: ['t40', 't41'] }, TEAMS, 8, 6)
    const m0Picks = picks.filter((p) => p.managerId === 'm0').map((p) => p.teamId)
    expect(m0Picks[0]).toBe('t40') // first pick honours wishlist top
    expect(m0Picks[1]).toBe('t41') // second pick honours next wishlist entry
    expect(m0Picks).toHaveLength(6)
    // remaining 4 picks are best-available by rank (whatever's left)
    expect(m0Picks.slice(2).every((id) => id.startsWith('t'))).toBe(true)
  })

  it('never double-picks a team another manager already took', () => {
    const picks = resolveAutodraft(ORDER, { m0: ['t5'], m1: ['t5'] }, TEAMS, 8, 6)
    const owners = picks.filter((p) => p.teamId === 't5')
    expect(owners).toHaveLength(1) // only one manager can land t5
  })

  it('supports a configurable smaller league (5 managers x 4 rounds = 20 picks)', () => {
    const order5 = ['m0', 'm1', 'm2', 'm3', 'm4']
    const picks = resolveAutodraft(order5, {}, TEAMS, 5, 4)
    expect(picks).toHaveLength(20)
    expect(new Set(picks.map((p) => p.teamId)).size).toBe(20)
    for (const m of order5) expect(picks.filter((p) => p.managerId === m)).toHaveLength(4)
    // 28 teams go undrafted — fine, they're just unowned
  })
})
