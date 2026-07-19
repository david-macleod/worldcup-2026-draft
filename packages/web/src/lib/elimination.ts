// Teams mathematically OUT of the World Cup — used to fade their flags everywhere
// (leaderboard, tier overview, group results feed, day-strip, group tables, and the
// per-player squad breakdown). Shared so the league view and the standalone Fixtures
// page (which has no LeagueView, only teams + matches) compute it identically.
//
// Out = lost a knockout tie, OR can no longer qualify from the group: already guaranteed
// to finish bottom of its group (a last-place team can never be a best-3rd) — including
// mid-group, as soon as it's mathematically certain rather than once the group finishes —
// and once every group is complete, anyone outside the 32 qualifiers (top-2 + 8 best thirds).
import type { Match, Team } from './api'

export function eliminatedTeams(view: { teams: Team[]; matches: Match[] }): Set<string> {
  const out = new Set<string>()
  const fin = (m: Match) => m.status === 'finished' && m.home_goals != null && m.away_goals != null
  // knockout losers
  for (const m of view.matches) {
    if (m.stage === 'group' || !fin(m) || !m.home_team_id || !m.away_team_id) continue
    let winner: string | null = null
    if (m.home_goals! > m.away_goals!) winner = m.home_team_id
    else if (m.away_goals! > m.home_goals!) winner = m.away_team_id
    else if (m.home_pens != null && m.away_pens != null) winner = m.home_pens > m.away_pens ? m.home_team_id : m.away_team_id
    if (winner) out.add(winner === m.home_team_id ? m.away_team_id! : m.home_team_id!)
  }
  // group standings
  const groups: Record<string, Team[]> = {}
  for (const t of view.teams) if (t.grp) (groups[t.grp] ||= []).push(t)
  const gms: Record<string, Match[]> = {}
  for (const m of view.matches) if (m.stage === 'group' && m.grp) (gms[m.grp] ||= []).push(m)
  const keys = Object.keys(groups)
  const done: Record<string, boolean> = {}
  for (const g of keys) done[g] = (gms[g]?.length ?? 0) > 0 && gms[g].every(fin)
  const table = (g: string) => {
    const st: Record<string, { id: string; pts: number; gd: number; gf: number; played: number }> = {}
    for (const t of groups[g]) st[t.id] = { id: t.id, pts: 0, gd: 0, gf: 0, played: 0 }
    for (const m of gms[g] ?? []) {
      if (!fin(m) || !st[m.home_team_id!] || !st[m.away_team_id!]) continue
      const h = st[m.home_team_id!], a = st[m.away_team_id!]
      h.gf += m.home_goals!; a.gf += m.away_goals!
      h.gd += m.home_goals! - m.away_goals!; a.gd += m.away_goals! - m.home_goals!
      h.played++; a.played++
      if (m.home_goals! > m.away_goals!) h.pts += 3
      else if (m.away_goals! > m.home_goals!) a.pts += 3
      else { h.pts++; a.pts++ }
    }
    return Object.values(st).sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf)
  }
  // Out the moment elimination is mathematically certain, not only once the group is
  // fully played: a team guaranteed to finish bottom (≥3 others already have more points
  // than its best achievable total — 3 per remaining group game) can never be a best-3rd.
  // Each group team plays 3 group games. Catches the latest teams knocked out mid-group.
  for (const g of keys) {
    const tb = table(g)
    for (const y of tb) {
      const yMax = y.pts + 3 * (3 - y.played)
      if (tb.filter((x) => x.id !== y.id && x.pts > yMax).length >= 3) out.add(y.id)
    }
  }
  const allDone = keys.length > 0 && keys.every((g) => done[g])
  if (allDone) {
    const qualified = new Set<string>()
    const thirds: { id: string; pts: number; gd: number; gf: number }[] = []
    for (const g of keys) {
      const tb = table(g)
      if (tb[0]) qualified.add(tb[0].id)
      if (tb[1]) qualified.add(tb[1].id)
      if (tb[2]) thirds.push(tb[2])
    }
    thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf)
    thirds.slice(0, 8).forEach((t) => qualified.add(t.id))
    for (const t of view.teams) if (!qualified.has(t.id)) out.add(t.id)
  } else {
    // Some groups still in progress. A team already 3rd or lower in a FINISHED group is
    // out once 8 thirds from other finished groups outrank it — those are locked (their
    // groups are done), so teams from unfinished groups can only push it further down,
    // never lift it into the best-8. Catches best-third eliminations before the last group.
    const lockedThirds: { id: string; pts: number; gd: number; gf: number }[] = []
    for (const g of keys) {
      if (!done[g]) continue
      const tb = table(g)
      if (tb[3]) out.add(tb[3].id) // last in a finished group can never be a best-3rd
      if (tb[2]) lockedThirds.push(tb[2])
    }
    lockedThirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf)
    const better = (a: typeof lockedThirds[number], b: typeof lockedThirds[number]) =>
      a.pts !== b.pts ? a.pts > b.pts : a.gd !== b.gd ? a.gd > b.gd : a.gf > b.gf
    for (const g of keys) {
      if (!done[g]) continue
      const third = table(g)[2]
      if (!third) continue
      // count locked thirds strictly ahead of this one; ≥8 ⇒ can never reach the best-8
      if (lockedThirds.filter((t) => t.id !== third.id && better(t, third)).length >= 8) out.add(third.id)
    }
  }
  return out
}
