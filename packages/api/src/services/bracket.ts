// Knockout bracket — derived, never stored. Knockout match rows hold only scores;
// who plays in each is computed from the group standings (Round of 32) and then the
// winners cascade through the fixed tree (R16 → Final). The whole thing is a pure
// function of the global teams + match results, so every league sees the same bracket.
//
// Structure is the official 2026 FIFA World Cup template (matches 73–88 → R32-1…R32-16,
// 89–96 → R16-1…R16-8, 97–100 → QF, 101–102 → SF, 104 → Final-1).

import type { TeamRow, MatchRow } from '../db/types'

export interface BracketPair { home: string | null; away: string | null }

// R32 slots. '1X' = winner of group X, '2X' = runner-up, '3@X' = the third-placed team
// allocated to the winner of group X (resolved via the third-place table below).
const R32_SLOTS: Record<string, [string, string]> = {
  'R32-1': ['2A', '2B'],
  'R32-2': ['1E', '3@E'],
  'R32-3': ['1F', '2C'],
  'R32-4': ['1C', '2F'],
  'R32-5': ['1I', '3@I'],
  'R32-6': ['2E', '2I'],
  'R32-7': ['1A', '3@A'],
  'R32-8': ['1L', '3@L'],
  'R32-9': ['1D', '3@D'],
  'R32-10': ['1G', '3@G'],
  'R32-11': ['2K', '2L'],
  'R32-12': ['1H', '2J'],
  'R32-13': ['1B', '3@B'],
  'R32-14': ['1J', '2H'],
  'R32-15': ['1K', '3@K'],
  'R32-16': ['2D', '2G'],
}

// Each later match = winners of its two feeders (official tree, by match number).
const KO_FEEDS: Record<string, [string, string]> = {
  'R16-1': ['R32-2', 'R32-5'],
  'R16-2': ['R32-1', 'R32-3'],
  'R16-3': ['R32-4', 'R32-6'],
  'R16-4': ['R32-7', 'R32-8'],
  'R16-5': ['R32-11', 'R32-12'],
  'R16-6': ['R32-9', 'R32-10'],
  'R16-7': ['R32-14', 'R32-16'],
  'R16-8': ['R32-13', 'R32-15'],
  'QF-1': ['R16-1', 'R16-2'],
  'QF-2': ['R16-5', 'R16-6'],
  'QF-3': ['R16-3', 'R16-4'],
  'QF-4': ['R16-7', 'R16-8'],
  'SF-1': ['QF-1', 'QF-2'],
  'SF-2': ['QF-3', 'QF-4'],
  'Final-1': ['SF-1', 'SF-2'],
}
const FEED_ORDER = Object.keys(KO_FEEDS) // R16 → QF → SF → Final, dependency-ordered

// Winner groups that face a third-placed team, and the official allocation for the exact
// set of groups whose thirds qualified in this tournament: {B,D,E,F,I,J,K,L}.
// Maps winner-group → the group whose third it plays. (e.g. 1A plays the 3rd of group E.)
const THIRD_SLOT_WINNERS = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L']
const REAL_QUAL_THIRDS = ['B', 'D', 'E', 'F', 'I', 'J', 'K', 'L']
const REAL_ALLOC: Record<string, string> = { A: 'E', B: 'J', D: 'B', E: 'D', G: 'I', I: 'F', K: 'L', L: 'K' }

function buildAlloc(qualGroups: Set<string>): Record<string, string> {
  const real = new Set(REAL_QUAL_THIRDS)
  if (qualGroups.size === real.size && [...qualGroups].every((g) => real.has(g))) return REAL_ALLOC
  // Fallback for any other combination (never happens with real results): assign the
  // qualifying third-groups to the winner slots in sorted order. Always a valid bracket.
  const qs = [...qualGroups].sort()
  const alloc: Record<string, string> = {}
  THIRD_SLOT_WINNERS.forEach((w, i) => { if (qs[i]) alloc[w] = qs[i] })
  return alloc
}

interface Standings {
  winner: Record<string, string | null>
  runnerUp: Record<string, string | null>
  thirdQ: Record<string, string | null> // third-placed team, only if it qualified
  alloc: Record<string, string>
}

function standings(teams: TeamRow[], matches: MatchRow[]): Standings {
  const byGroup: Record<string, TeamRow[]> = {}
  for (const t of teams) (byGroup[t.grp] ||= []).push(t)
  type Row = { id: string; rank: number; GF: number; GA: number; Pts: number }
  const winner: Record<string, string | null> = {}
  const runnerUp: Record<string, string | null> = {}
  const order: Record<string, Row[]> = {}
  const thirds: Array<Row & { group: string }> = []
  for (const g of Object.keys(byGroup).sort()) {
    const gms = matches.filter((m) => m.stage === 'group' && m.grp === g)
    const complete = gms.length > 0 && gms.every((m) => m.status === 'finished')
    winner[g] = runnerUp[g] = null
    if (!complete) continue
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
    order[g] = table
    winner[g] = table[0]?.id ?? null
    runnerUp[g] = table[1]?.id ?? null
    if (table[2]) thirds.push({ ...table[2], group: g })
  }
  thirds.sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.rank - y.rank)
  const qual = thirds.slice(0, 8)
  const thirdQ: Record<string, string | null> = {}
  for (const t of qual) thirdQ[t.group] = t.id
  return { winner, runnerUp, thirdQ, alloc: buildAlloc(new Set(qual.map((t) => t.group))) }
}

/** Map of every knockout match id → its two teams (null until the feeding result is in). */
export function deriveBracket(teams: TeamRow[], matches: MatchRow[]): Record<string, BracketPair> {
  const st = standings(teams, matches)
  const resolve = (spec: string): string | null => {
    const kind = spec[0]
    if (kind === '1') return st.winner[spec.slice(1)] ?? null
    if (kind === '2') return st.runnerUp[spec.slice(1)] ?? null
    if (kind === '3') { // '3@X' → third of group alloc[X]
      const g = st.alloc[spec.slice(2)]
      return g ? st.thirdQ[g] ?? null : null
    }
    return null
  }
  const mById: Record<string, MatchRow> = Object.fromEntries(matches.map((m) => [m.id, m]))
  const koWinner = (id: string, home: string | null, away: string | null): string | null => {
    const m = mById[id]
    if (!m || m.status !== 'finished' || home == null || away == null || m.home_goals == null || m.away_goals == null) return null
    if (m.home_goals > m.away_goals) return home
    if (m.away_goals > m.home_goals) return away
    if (m.home_pens != null && m.away_pens != null) return m.home_pens > m.away_pens ? home : away
    return null
  }
  const pairs: Record<string, BracketPair> = {}
  const winner: Record<string, string | null> = {}
  for (const [id, [a, b]] of Object.entries(R32_SLOTS)) {
    const home = resolve(a), away = resolve(b)
    pairs[id] = { home, away }
    winner[id] = koWinner(id, home, away)
  }
  for (const id of FEED_ORDER) {
    const [f1, f2] = KO_FEEDS[id]
    const home = winner[f1] ?? null, away = winner[f2] ?? null
    pairs[id] = { home, away }
    winner[id] = koWinner(id, home, away)
  }
  // Third-place playoff — the two semi-final losers (the non-winner of each finished SF).
  const loserOf = (id: string): string | null => {
    const w = winner[id], p = pairs[id]
    if (w == null || !p) return null
    return w === p.home ? p.away : p.home
  }
  pairs['3P-1'] = { home: loserOf('SF-1'), away: loserOf('SF-2') }
  return pairs
}

/** Return a copy of matches with knockout home/away team ids filled in from the bracket. */
export function applyBracket(teams: TeamRow[], matches: MatchRow[]): MatchRow[] {
  const pairs = deriveBracket(teams, matches)
  return matches.map((m) => {
    const p = pairs[m.id]
    return p ? { ...m, home_team_id: p.home, away_team_id: p.away } : m
  })
}
