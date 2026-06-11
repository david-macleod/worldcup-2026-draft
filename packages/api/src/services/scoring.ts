// Scoring — the league's real formula, behind one pure function. Raw match
// results are the source of truth; points are computed on read, never persisted.
//
// Teams are split into 3 TIERS by the round they were drafted in (per league):
//   rounds 1–2 → tier 1 (strongest)   3–4 → tier 2   5–6 → tier 3 (weakest)
//
// Per finished match, for each team:
//   base   = win 3 / draw 1 / loss 0   +  1 per goal scored
//   upset  = only if the team AVOIDS DEFEAT (win or draw) against a higher tier:
//            flat   +1 (opponent one tier above) / +2 (two above)
//            goals  +1 (one above) / +2 (two above) per goal scored
//          = diff × (1 + goalsScored), where diff = opponentTiersAbove ∈ {1,2}
//
// To change the rules, edit ONLY matchScore() below.

import type { TeamRow, MatchRow, ManagerRow, PickRow } from '../db/types'

export interface MatchScore {
  result: number
  goals: number
  bonus: number
  total: number
}

/** Points a team earns in one match. tier/oppTier: 1 (best)..3 (worst), or null if undrafted. */
export function matchScore(gf: number, ga: number, tier: number | null, oppTier: number | null): MatchScore {
  const result = gf > ga ? 3 : gf === ga ? 1 : 0
  const goals = gf
  let bonus = 0
  const avoidedDefeat = gf >= ga
  if (avoidedDefeat && tier != null && oppTier != null && oppTier < tier) {
    const diff = tier - oppTier // opponent is this many tiers above (better): 1 or 2
    bonus = diff * (1 + gf) // flat upset (diff) + per-goal upset (diff each)
  }
  return { result, goals, bonus, total: result + goals + bonus }
}

/** Tier from a 0-indexed draft round: rounds 0–1 → 1, 2–3 → 2, 4+ → 3. */
export const tierForRound = (round0: number) => Math.min(3, Math.floor(round0 / 2) + 1)

const KO_REACH: Record<string, string> = { R32: 'R16', R16: 'QF', QF: 'SF', SF: 'Final', Final: 'Champion' }
const STAGE_ORD: Record<string, number> = { Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, Final: 5, Champion: 6 }
export const STAGE_LABEL: Record<string, string> = {
  Group: 'Group', R32: 'Last 32', R16: 'Last 16', QF: 'Quarter-final', SF: 'Semi-final', Final: 'Final', Champion: 'Champion',
}

export interface TeamPoints {
  teamId: string
  result: number
  goals: number
  bonus: number
  total: number
  tier: number | null
  stage: string // furthest stage reached (display only)
}

export interface LeaderboardEntry {
  managerId: string
  name: string
  color: string
  seat: number | null
  total: number
  advanced: number
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
  if (m.home_pens != null && m.away_pens != null) return m.home_pens > m.away_pens ? m.home_team_id : m.away_team_id
  return null
}

/** Qualified set from finished group matches (top-2 + 8 best thirds) — for display only. */
function computeQualified(teams: TeamRow[], matches: MatchRow[]): Set<string> {
  const byGroup: Record<string, TeamRow[]> = {}
  for (const t of teams) (byGroup[t.grp] ||= []).push(t)
  type Row = { id: string; rank: number; GF: number; GA: number; Pts: number }
  const qualified = new Set<string>()
  const thirds: Row[] = []
  for (const g of Object.keys(byGroup).sort()) {
    const gms = matches.filter((m) => m.stage === 'group' && m.grp === g)
    if (!(gms.length > 0 && gms.every((m) => m.status === 'finished'))) continue
    const rows: Record<string, Row> = {}
    for (const t of byGroup[g]) rows[t.id] = { id: t.id, rank: t.rank, GF: 0, GA: 0, Pts: 0 }
    for (const m of gms) {
      if (m.home_goals == null || m.away_goals == null || !m.home_team_id || !m.away_team_id) continue
      const ra = rows[m.home_team_id], rb = rows[m.away_team_id]
      if (!ra || !rb) continue
      ra.GF += m.home_goals; ra.GA += m.away_goals; rb.GF += m.away_goals; rb.GA += m.home_goals
      if (m.home_goals > m.away_goals) ra.Pts += 3
      else if (m.home_goals < m.away_goals) rb.Pts += 3
      else { ra.Pts++; rb.Pts++ }
    }
    const table = Object.values(rows).sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.rank - y.rank)
    qualified.add(table[0].id); qualified.add(table[1].id)
    if (table[2]) thirds.push(table[2])
  }
  thirds.sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.rank - y.rank)
  for (const t of thirds.slice(0, 8)) qualified.add(t.id)
  return qualified
}

export function computeLeaderboard(
  teams: TeamRow[],
  matches: MatchRow[],
  picks: PickRow[],
  managers: ManagerRow[],
): Leaderboard {
  const nManagers = managers.length || 8
  // Each drafted team's tier comes from the round it was picked in (this league).
  const tierByTeam: Record<string, number> = {}
  for (const p of picks) tierByTeam[p.team_id] = tierForRound(Math.floor(p.overall / nManagers))

  const perTeamPoints: Record<string, TeamPoints> = {}
  for (const t of teams) {
    perTeamPoints[t.id] = { teamId: t.id, result: 0, goals: 0, bonus: 0, total: 0, tier: tierByTeam[t.id] ?? null, stage: 'Group' }
  }
  const bump = (id: string | null, stage: string) => {
    if (!id) return
    const p = perTeamPoints[id]
    if (p && STAGE_ORD[stage] > STAGE_ORD[p.stage]) p.stage = stage
  }

  // points: every finished match, both sides, with tier-aware upset bonuses
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    const hTier = m.home_team_id ? tierByTeam[m.home_team_id] ?? null : null
    const aTier = m.away_team_id ? tierByTeam[m.away_team_id] ?? null : null
    if (m.home_team_id && perTeamPoints[m.home_team_id]) {
      const s = matchScore(m.home_goals, m.away_goals, hTier, aTier)
      const p = perTeamPoints[m.home_team_id]; p.result += s.result; p.goals += s.goals; p.bonus += s.bonus; p.total += s.total
    }
    if (m.away_team_id && perTeamPoints[m.away_team_id]) {
      const s = matchScore(m.away_goals, m.home_goals, aTier, hTier)
      const p = perTeamPoints[m.away_team_id]; p.result += s.result; p.goals += s.goals; p.bonus += s.bonus; p.total += s.total
    }
  }

  // stage progression — display only (advanced count + deepest stage), not points
  const qualified = computeQualified(teams, matches)
  for (const id of qualified) bump(id, 'R32')
  for (const m of matches) {
    if (m.stage === 'group' || m.status !== 'finished') continue
    const w = winnerOf(m)
    if (w) bump(w, KO_REACH[m.stage] ?? 'R32')
  }

  const squads: Record<string, string[]> = {}
  for (const m of managers) squads[m.id] = []
  for (const pk of picks) (squads[pk.manager_id] ||= []).push(pk.team_id)

  const leaderboard: LeaderboardEntry[] = managers.map((m) => {
    const squad = (squads[m.id] || []).map((teamId) => ({ teamId, points: perTeamPoints[teamId] })).filter((x) => x.points)
    const total = squad.reduce((s, x) => s + x.points.total, 0)
    const advanced = squad.filter((x) => qualified.has(x.teamId)).length
    const deepest = squad.reduce((d, x) => Math.max(d, STAGE_ORD[x.points.stage] || 0), 0)
    const deepestStage = STAGE_LABEL[Object.keys(STAGE_ORD).find((k) => STAGE_ORD[k] === deepest) || 'Group']
    return { managerId: m.id, name: m.name, color: m.color, seat: m.seat, total, advanced, deepestStage, squad }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return { leaderboard, perTeamPoints }
}
