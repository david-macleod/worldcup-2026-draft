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
  /** Rank change vs the previous matchday: +up / −down / 0 held; null = no prior matchday. */
  delta: number | null
  squad: Array<{ teamId: string; points: TeamPoints }>
}

export interface Leaderboard {
  leaderboard: LeaderboardEntry[]
  perTeamPoints: Record<string, TeamPoints>
}

/** 11:00→11:00 UTC day bucket for a kickoff (matches the web day-strip grouping). null if undated. */
function matchdayKey(kickoff: string | null | undefined): string | null {
  if (!kickoff) return null
  const ms = Date.parse(kickoff)
  if (isNaN(ms)) return null
  return new Date(ms - 11 * 3600_000).toISOString().slice(0, 10)
}

/** Per-team total points across a set of matches (the scoring loop, totals only). */
function teamTotals(matches: MatchRow[], tierByTeam: Record<string, number>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    const hTier = m.home_team_id ? tierByTeam[m.home_team_id] ?? null : null
    const aTier = m.away_team_id ? tierByTeam[m.away_team_id] ?? null : null
    if (m.home_team_id) totals[m.home_team_id] = (totals[m.home_team_id] || 0) + matchScore(m.home_goals, m.away_goals, hTier, aTier).total
    if (m.away_team_id) totals[m.away_team_id] = (totals[m.away_team_id] || 0) + matchScore(m.away_goals, m.home_goals, aTier, hTier).total
  }
  return totals
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
    return { managerId: m.id, name: m.name, color: m.color, seat: m.seat, total, advanced, deepestStage, delta: null as number | null, squad }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  // Rank movement — computed on read, never stored. A "matchday" is one 11:00→11:00 day
  // bucket (same grouping as the fixtures strip) and only counts once COMPLETE (every match
  // scheduled that day is finished). The in-progress day is ignored, so a lone straggler
  // result can't reset everyone's arrow to nil. Movement runs from the end of the matchday
  // BEFORE the most recent completed one up to the live standings; since both orderings are
  // permutations of the same managers the deltas net to zero.
  const dayFinished: Record<string, number> = {}
  const dayTotal: Record<string, number> = {}
  for (const m of matches) {
    const k = matchdayKey(m.kickoff)
    if (!k) continue
    dayTotal[k] = (dayTotal[k] || 0) + 1
    if (m.status === 'finished') dayFinished[k] = (dayFinished[k] || 0) + 1
  }
  const completeDays = Object.keys(dayTotal).filter((k) => dayFinished[k] === dayTotal[k]).sort()
  const latestComplete = completeDays[completeDays.length - 1]
  // reference day = the most recent day with results strictly before that completed matchday
  const refDay = latestComplete
    ? Object.keys(dayFinished).filter((d) => d < latestComplete).sort().pop()
    : undefined
  if (refDay) {
    // standings through refDay; undated finished matches (knockouts w/o kickoff) always count
    const refMatches = matches.filter((m) => {
      if (m.status !== 'finished') return false
      const k = matchdayKey(m.kickoff)
      return k == null || k <= refDay
    })
    const refTotals = teamTotals(refMatches, tierByTeam)
    const refRank: Record<string, number> = {}
    managers
      .map((m) => ({ id: m.id, name: m.name, total: (squads[m.id] || []).reduce((s, tid) => s + (refTotals[tid] || 0), 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .forEach((x, i) => { refRank[x.id] = i })
    leaderboard.forEach((e, i) => { e.delta = (refRank[e.managerId] ?? i) - i })
  }

  return { leaderboard, perTeamPoints }
}
