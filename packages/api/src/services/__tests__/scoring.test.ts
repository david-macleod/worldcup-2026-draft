import { describe, it, expect } from 'vitest'
import { scoreBreakdown, computeLeaderboard } from '../scoring'
import type { TeamRow, MatchRow, ManagerRow, PickRow } from '../../db/types'

describe('scoreBreakdown (per-match fantasy)', () => {
  it('win + clean sheet + 3 goals', () => {
    expect(scoreBreakdown(3, 0)).toEqual({ result: 5, goals: 3, bonus: 3, total: 11 })
  })
  it('1-1 draw', () => {
    expect(scoreBreakdown(1, 1)).toEqual({ result: 2, goals: 1, bonus: 0, total: 3 })
  })
  it('0-2 loss scores nothing', () => {
    expect(scoreBreakdown(0, 2)).toEqual({ result: 0, goals: 0, bonus: 0, total: 0 })
  })
})

// Minimal fixture: a single 4-team group A, fully played out.
function team(id: string, rank: number): TeamRow {
  return {
    id, name: id.toUpperCase(), abbr: id.toUpperCase(), code: 'xx', rank, conf: 'X', grp: 'A',
    star: null, host: 0, pop: null, temp: null, rain: null, dogs: null, age: null,
    hgt: null, light: null, coffee: null, hue: null,
  }
}
function gm(id: string, home: string, away: string, hg: number, ag: number): MatchRow {
  return {
    id, stage: 'group', grp: 'A', home_team_id: home, away_team_id: away,
    kickoff: null, home_goals: hg, away_goals: ag, home_pens: null, away_pens: null, status: 'finished',
  }
}

describe('computeLeaderboard', () => {
  const teams = [team('a1', 1), team('a2', 2), team('a3', 3), team('a4', 4)]
  // a1 wins everything, a2 second; a3/a4 lose. Round robin = 6 matches.
  const matches: MatchRow[] = [
    gm('G-A-1', 'a1', 'a2', 1, 0),
    gm('G-A-2', 'a1', 'a3', 3, 0),
    gm('G-A-3', 'a1', 'a4', 2, 0),
    gm('G-A-4', 'a2', 'a3', 2, 1),
    gm('G-A-5', 'a2', 'a4', 1, 0),
    gm('G-A-6', 'a3', 'a4', 2, 0),
  ]
  const managers: ManagerRow[] = [
    { id: 'm1', league_id: 'L', name: 'Ann', token: 't1', seat: 0, color: '#fff' },
    { id: 'm2', league_id: 'L', name: 'Bob', token: 't2', seat: 1, color: '#000' },
  ]
  const picks: PickRow[] = [
    { id: 'p1', league_id: 'L', overall: 0, manager_id: 'm1', team_id: 'a1', created_at: '' },
    { id: 'p2', league_id: 'L', overall: 1, manager_id: 'm2', team_id: 'a2', created_at: '' },
    { id: 'p3', league_id: 'L', overall: 2, manager_id: 'm1', team_id: 'a3', created_at: '' },
    { id: 'p4', league_id: 'L', overall: 3, manager_id: 'm2', team_id: 'a4', created_at: '' },
  ]

  it('awards qualification bonus to the top two; last place never qualifies', () => {
    const { perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)
    expect(perTeamPoints.a1.qualifyBonus).toBe(4)
    expect(perTeamPoints.a2.qualifyBonus).toBe(4)
    // a3 finishes 3rd and, as the only "best third" available here, also qualifies
    // (the rule takes up to 8 thirds across all groups); a4 (last) does not.
    expect(perTeamPoints.a3.qualifyBonus).toBe(4)
    expect(perTeamPoints.a4.qualifyBonus).toBe(0)
  })

  it('a1 fantasy = sum of its three winning matches', () => {
    const { perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)
    // 1-0 (5+1+2=8) + 3-0 (5+3+3=11) + 2-0 (5+2+2=9) = 28
    expect(perTeamPoints.a1.fantasy).toBe(28)
    expect(perTeamPoints.a1.total).toBe(28 + 4)
    expect(perTeamPoints.a1.stage).toBe('R32')
  })

  it('manager total = sum of squad team totals, sorted desc', () => {
    const { leaderboard, perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)
    const m1 = leaderboard.find((r) => r.managerId === 'm1')!
    expect(m1.total).toBe(perTeamPoints.a1.total + perTeamPoints.a3.total)
    expect(leaderboard[0].total).toBeGreaterThanOrEqual(leaderboard[1].total)
  })

  it('does not rank a group until all its matches are finished', () => {
    const partial = matches.map((m, i) => (i === 0 ? { ...m, status: 'scheduled' as const } : m))
    const { perTeamPoints } = computeLeaderboard(teams, partial, picks, managers)
    expect(perTeamPoints.a1.qualifyBonus).toBe(0) // group incomplete → no qualification yet
  })
})
