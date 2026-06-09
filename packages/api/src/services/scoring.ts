// Scoring — DELIBERATELY a stub behind one pure function so the formula is
// swappable. Raw match results are the source of truth; manager points are
// computed on read and never persisted.
//
// "Combined" model (ported from the original client app):
//   • per-match fantasy  (comp.jsx::scoreBreakdown): result W5/D2/L0 + 1/goal
//                         + clean-sheet +2 + scored-3+ +1, summed over every
//                         finished match a team played (group and knockout).
//   • stage progression  (sim.js STAGES): +4 for qualifying out of the group,
//                         then a win bonus for each knockout round won.
//
// To change the scoring rules, edit ONLY this file.

import type { TeamRow, MatchRow, ManagerRow, PickRow } from '../db/types'

export interface ScoreBreakdown {
  result: number
  goals: number
  bonus: number
  total: number
}

/** Per-match fantasy points for the team that scored `gf`, conceded `ga`. */
export function scoreBreakdown(gf: number, ga: number): ScoreBreakdown {
  const result = gf > ga ? 5 : gf === ga ? 2 : 0
  const goals = gf
  const bonus = (ga === 0 ? 2 : 0) + (gf >= 3 ? 1 : 0)
  return { result, goals, bonus, total: result + goals + bonus }
}

// Knockout win bonuses keyed by the stage that was won (mirrors sim.js STAGES).
const KO_WIN: Record<string, number> = { R32: 6, R16: 8, QF: 12, SF: 16, Final: 26 }
// The stage a team reaches by winning the keyed stage.
const KO_REACH: Record<string, string> = {
  R32: 'R16', R16: 'QF', QF: 'SF', SF: 'Final', Final: 'Champion',
}
const STAGE_ORD: Record<string, number> = {
  Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, Final: 5, Champion: 6,
}
export const STAGE_LABEL: Record<string, string> = {
  Group: 'Group', R32: 'Last 32', R16: 'Last 16', QF: 'Quarter-final',
  SF: 'Semi-final', Final: 'Final', Champion: 'Champion',
}

export interface TeamPoints {
  teamId: string
  fantasy: number
  qualifyBonus: number
  knockoutBonus: number
  total: number
  stage: string // furthest stage reached: 'Group' | 'R32' | ... | 'Champion'
}

export interface LeaderboardEntry {
  managerId: string
  name: string
  color: string
  seat: number | null
  total: number
  advanced: number // teams that reached the knockouts
  deepestStage: string
  squad: Array<{ teamId: string; points: TeamPoints }>
}

export interface Leaderboard {
  leaderboard: LeaderboardEntry[]
  perTeamPoints: Record<string, TeamPoints>
}

function winnerOf(m: MatchRow): string | null {
  if (m.home_goals == null || m.away_goals == null) return null
  if (m.home_goals > m.away_goals) return m.home_team_id
  if (m.away_goals > m.home_goals) return m.away_team_id
  // level after normal time → penalties decide knockout ties
  if (m.home_pens != null && m.away_pens != null) {
    return m.home_pens > m.away_pens ? m.home_team_id : m.away_team_id
  }
  return null
}

/** Compute the qualified set from finished group matches (top-2 + 8 best thirds). */
function computeQualified(teams: TeamRow[], matches: MatchRow[]): Set<string> {
  const byGroup: Record<string, TeamRow[]> = {}
  for (const t of teams) (byGroup[t.grp] ||= []).push(t)

  type Row = { id: string; rank: number; P: number; W: number; D: number; L: number; GF: number; GA: number; Pts: number }
  const qualified = new Set<string>()
  const thirds: Array<{ row: Row }> = []

  for (const g of Object.keys(byGroup).sort()) {
    const gt = byGroup[g]
    const groupMatches = matches.filter((m) => m.stage === 'group' && m.grp === g)
    // Only rank a group once every fixture is in — partial tables aren't trustworthy.
    const allFinished = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'finished')
    if (!allFinished) continue

    const rows: Record<string, Row> = {}
    for (const t of gt) rows[t.id] = { id: t.id, rank: t.rank, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 }
    for (const m of groupMatches) {
      if (m.home_goals == null || m.away_goals == null || !m.home_team_id || !m.away_team_id) continue
      const ra = rows[m.home_team_id], rb = rows[m.away_team_id]
      if (!ra || !rb) continue
      ra.P++; rb.P++; ra.GF += m.home_goals; ra.GA += m.away_goals; rb.GF += m.away_goals; rb.GA += m.home_goals
      if (m.home_goals > m.away_goals) { ra.W++; rb.L++; ra.Pts += 3 }
      else if (m.home_goals < m.away_goals) { rb.W++; ra.L++; rb.Pts += 3 }
      else { ra.D++; rb.D++; ra.Pts++; rb.Pts++ }
    }
    const table = Object.values(rows).sort((x, y) =>
      y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || (x.rank - y.rank))
    qualified.add(table[0].id)
    qualified.add(table[1].id)
    if (table[2]) thirds.push({ row: table[2] })
  }

  thirds.sort((a, b) =>
    b.row.Pts - a.row.Pts ||
    (b.row.GF - b.row.GA) - (a.row.GF - a.row.GA) ||
    b.row.GF - a.row.GF || (a.row.rank - b.row.rank))
  for (const t of thirds.slice(0, 8)) qualified.add(t.row.id)
  return qualified
}

export function computeLeaderboard(
  teams: TeamRow[],
  matches: MatchRow[],
  picks: PickRow[],
  managers: ManagerRow[],
): Leaderboard {
  const perTeamPoints: Record<string, TeamPoints> = {}
  for (const t of teams) {
    perTeamPoints[t.id] = { teamId: t.id, fantasy: 0, qualifyBonus: 0, knockoutBonus: 0, total: 0, stage: 'Group' }
  }
  const bump = (id: string | null, stage: string) => {
    if (!id) return
    const p = perTeamPoints[id]
    if (p && STAGE_ORD[stage] > STAGE_ORD[p.stage]) p.stage = stage
  }

  // 1) per-match fantasy over every finished match
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    if (m.home_team_id && perTeamPoints[m.home_team_id]) {
      perTeamPoints[m.home_team_id].fantasy += scoreBreakdown(m.home_goals, m.away_goals).total
    }
    if (m.away_team_id && perTeamPoints[m.away_team_id]) {
      perTeamPoints[m.away_team_id].fantasy += scoreBreakdown(m.away_goals, m.home_goals).total
    }
  }

  // 2) qualification bonus (+4, reaches R32)
  const qualified = computeQualified(teams, matches)
  for (const id of qualified) {
    if (perTeamPoints[id]) { perTeamPoints[id].qualifyBonus += 4; bump(id, 'R32') }
  }

  // 3) knockout win bonuses
  for (const m of matches) {
    if (m.stage === 'group' || m.status !== 'finished') continue
    const w = winnerOf(m)
    if (!w || !perTeamPoints[w]) continue
    perTeamPoints[w].knockoutBonus += KO_WIN[m.stage] ?? 0
    bump(w, KO_REACH[m.stage] ?? 'R32')
  }

  for (const id of Object.keys(perTeamPoints)) {
    const p = perTeamPoints[id]
    p.total = p.fantasy + p.qualifyBonus + p.knockoutBonus
  }

  // 4) roll up to managers
  const squads: Record<string, string[]> = {}
  for (const m of managers) squads[m.id] = []
  for (const pk of picks) (squads[pk.manager_id] ||= []).push(pk.team_id)

  const leaderboard: LeaderboardEntry[] = managers.map((m) => {
    const squad = (squads[m.id] || []).map((teamId) => ({ teamId, points: perTeamPoints[teamId] }))
      .filter((x) => x.points)
    const total = squad.reduce((s, x) => s + x.points.total, 0)
    const advanced = squad.filter((x) => qualified.has(x.teamId)).length
    const deepest = squad.reduce((d, x) => Math.max(d, STAGE_ORD[x.points.stage] || 0), 0)
    const deepestStage = STAGE_LABEL[Object.keys(STAGE_ORD).find((k) => STAGE_ORD[k] === deepest) || 'Group']
    return { managerId: m.id, name: m.name, color: m.color, seat: m.seat, total, advanced, deepestStage, squad }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return { leaderboard, perTeamPoints }
}
