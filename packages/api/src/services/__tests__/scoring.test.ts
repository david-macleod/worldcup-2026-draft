import { describe, it, expect } from 'vitest'
import { matchScore, tierForRound, computeLeaderboard } from '../scoring'
import type { TeamRow, MatchRow, ManagerRow, PickRow } from '../../db/types'

describe('tierForRound', () => {
  it('rounds 1-2 → tier 1, 3-4 → tier 2, 5-6 → tier 3 (0-indexed)', () => {
    expect([0, 1, 2, 3, 4, 5].map(tierForRound)).toEqual([1, 1, 2, 2, 3, 3])
  })
})

describe('matchScore (tier-based)', () => {
  it('win 3-0 vs same tier: 3 + 3 goals, no upset', () => {
    expect(matchScore(3, 0, 2, 2)).toEqual({ result: 3, goals: 3, bonus: 0, total: 6 })
  })
  it('tier 3 beats tier 1 (two above) 2-0: upset = 2×(1+2)=6', () => {
    expect(matchScore(2, 0, 3, 1)).toEqual({ result: 3, goals: 2, bonus: 6, total: 11 })
  })
  it('tier 3 draws tier 1 1-1: upset = 2×(1+1)=4', () => {
    expect(matchScore(1, 1, 3, 1)).toEqual({ result: 1, goals: 1, bonus: 4, total: 6 })
  })
  it('tier 2 draws tier 1 (one above) 0-0: upset = 1×(1+0)=1', () => {
    expect(matchScore(0, 0, 2, 1)).toEqual({ result: 1, goals: 0, bonus: 1, total: 2 })
  })
  it('losing earns no upset bonus even against a higher tier', () => {
    expect(matchScore(0, 2, 3, 1)).toEqual({ result: 0, goals: 0, bonus: 0, total: 0 })
  })
  it('beating a LOWER tier gives no upset bonus', () => {
    expect(matchScore(4, 0, 1, 3)).toEqual({ result: 3, goals: 4, bonus: 0, total: 7 })
  })
  it('undrafted opponent (null tier): no upset bonus', () => {
    expect(matchScore(2, 0, 3, null)).toEqual({ result: 3, goals: 2, bonus: 0, total: 5 })
  })
})

function team(id: string, grp = 'A', rank = 10): TeamRow {
  return {
    id, name: id.toUpperCase(), abbr: id.toUpperCase(), code: 'xx', rank, conf: 'X', grp,
    star: null, host: 0, pop: null, temp: null, rain: null, dogs: null, age: null, hgt: null, light: null, coffee: null, hue: null,
  }
}

describe('computeLeaderboard (tiers derived from draft round)', () => {
  // 2 managers. a1 picked round 0 (tier 1), a3 picked round 4 (tier 3).
  const teams = [team('a1'), team('a2'), team('a3'), team('a4')]
  const managers: ManagerRow[] = [
    { id: 'm1', league_id: 'L', name: 'Ann', token: 't1', seat: 0, color: '#fff' },
    { id: 'm2', league_id: 'L', name: 'Bob', token: 't2', seat: 1, color: '#000' },
  ]
  const picks: PickRow[] = [
    { id: 'p1', league_id: 'L', overall: 0, manager_id: 'm1', team_id: 'a1', created_at: '' }, // tier 1
    { id: 'p2', league_id: 'L', overall: 1, manager_id: 'm2', team_id: 'a2', created_at: '' }, // tier 1
    { id: 'p3', league_id: 'L', overall: 8, manager_id: 'm1', team_id: 'a3', created_at: '' }, // tier 3
    { id: 'p4', league_id: 'L', overall: 9, manager_id: 'm2', team_id: 'a4', created_at: '' }, // tier 3
  ]
  // a3 (tier3) beats a1 (tier1) 2-0 → big upset
  const matches: MatchRow[] = [{
    id: 'G-A-1', stage: 'group', grp: 'A', home_team_id: 'a3', away_team_id: 'a1',
    kickoff: '2026-06-11T15:00:00Z', home_goals: 2, away_goals: 0, home_pens: null, away_pens: null, status: 'finished',
  }]

  it('assigns tiers from the round each team was drafted', () => {
    const { perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)
    expect(perTeamPoints.a1.tier).toBe(1)
    expect(perTeamPoints.a3.tier).toBe(3)
  })
  it('awards the tier-3-over-tier-1 upset (2-0 → 11) and 0 to the beaten tier-1 team', () => {
    const { perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)
    expect(perTeamPoints.a3.total).toBe(11)
    expect(perTeamPoints.a1.total).toBe(0)
  })
  it("rolls up to the owning manager's total", () => {
    const { leaderboard } = computeLeaderboard(teams, matches, picks, managers)
    expect(leaderboard.find((r) => r.managerId === 'm1')!.total).toBe(11) // a1(0) + a3(11)
    expect(leaderboard[0].managerId).toBe('m1')
  })
})
