// Real World Cup group standings table, computed from finished group matches.
// One component, two lenses: pass `owners` (from a league's draft) to overlay who
// drafted each team — the /fixtures page renders it lens-off, the league Groups tab
// renders it with the owner chip. The table itself is the shared <StatTable>.
import type { CSSProperties } from 'react'
import type { Match, Team } from '../lib/api'
import { StatTable } from './StatTable'

export interface OwnerInfo { name: string; color: string; tier: number }
export type Owners = Record<string, OwnerInfo>

export type Standing = {
  team: Team
  p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number
}

// Build a group table from finished group matches. Sorted points → GD → GF → name.
export function groupTable(teams: Team[], matches: Match[]): Standing[] {
  const rows = new Map<string, Standing>()
  for (const t of teams) rows.set(t.id, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })

  for (const m of matches) {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    const h = m.home_team_id && rows.get(m.home_team_id)
    const a = m.away_team_id && rows.get(m.away_team_id)
    if (!h || !a) continue
    h.p++; a.p++
    h.gf += m.home_goals; h.ga += m.away_goals
    a.gf += m.away_goals; a.ga += m.home_goals
    if (m.home_goals > m.away_goals) { h.w++; a.l++; h.pts += 3 }
    else if (m.home_goals < m.away_goals) { a.w++; h.l++; a.pts += 3 }
    else { h.d++; a.d++; h.pts++; a.pts++ }
  }

  return [...rows.values()]
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.name.localeCompare(y.team.name))
}

// Manager chip shown under the team name when an owner overlay is supplied.
export function OwnerChip({ o }: { o: OwnerInfo }) {
  return (
    <span className="bt-owner" style={{ '--oc': o.color } as CSSProperties}>
      <i className="bt-owner-dot" aria-hidden />{o.name}
    </span>
  )
}

// One group's standings table, computed from its finished matches. Top-two carry the
// "qualifies" left accent; with `owners`, each row gains the drafter's chip.
export function GroupTable({ gms, tmap, owners, teamWidth }: {
  gms: Match[]; tmap: Record<string, Team>; owners?: Owners; teamWidth?: string
}) {
  const teamIds = new Set<string>()
  for (const m of gms) {
    if (m.home_team_id) teamIds.add(m.home_team_id)
    if (m.away_team_id) teamIds.add(m.away_team_id)
  }
  const groupTeams = [...teamIds].map((id) => tmap[id]).filter(Boolean)
  const table = groupTable(groupTeams, gms)
  return (
    <StatTable
      teamWidth={teamWidth ?? '34%'}
      columns={[
        { label: 'P', title: 'Played' }, { label: 'W', title: 'Won' }, { label: 'D', title: 'Drawn' }, { label: 'L', title: 'Lost' },
        { label: 'GF', title: 'Goals for' }, { label: 'GA', title: 'Goals against' }, { label: 'GD', title: 'Goal difference' },
      ]}
      totalLabel="Pts"
      rows={table.map((r, i) => {
        const o = owners?.[r.team.id]
        // league lens: left border by the drafter's tier. fixtures lens (no owners):
        // top-two carry the "qualifies" accent instead.
        const accent = o ? (`t${o.tier}` as 't1' | 't2' | 't3') : (i < 2 ? 'q' as const : null)
        return {
          id: r.team.id, code: r.team.code, name: r.team.name, accent,
          cells: [r.p, r.w, r.d, r.l, r.gf, r.ga, r.gd > 0 ? `+${r.gd}` : r.gd],
          total: r.pts,
          meta: o ? <OwnerChip o={o} /> : undefined,
        }
      })}
    />
  )
}
