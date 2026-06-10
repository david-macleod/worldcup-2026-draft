import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type FixturesView, type Match, type Team } from '../lib/api'
import { Flag, teamMap } from '../components/ui'

const KO_STAGES = ['R32', 'R16', 'QF', 'SF', 'Final'] as const
const KO_LABEL: Record<string, string> = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final',
}
// Local kickoff time, with single-digit AM hours zero-padded (9:00 AM -> 09:00 AM;
// PM and 10/11/12 AM are left as-is).
function fmtTime(d: Date): string {
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return /\bAM\b/i.test(t) ? t.replace(/^(\d)\b/, '0$1') : t
}

// A kickoff is stored either as a full UTC instant (group games — has a 'T') or a
// date-only string (knockout slots, teams/venues TBD). For instants we render in
// the viewer's local timezone; for date-only we format the bare date (no TZ shift).
function kickoffParts(iso: string | null): { key: string; dateLabel: string; time: string | null } {
  if (!iso) return { key: '~', dateLabel: 'Date TBD', time: null }
  if (iso.includes('T')) {
    const d = new Date(iso)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return {
      key,
      dateLabel: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      time: fmtTime(d),
    }
  }
  const [y, m, dd] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd))
  return {
    key: iso,
    dateLabel: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    time: null,
  }
}

const byKickoff = (a: Match, b: Match) =>
  (a.kickoff ?? '').localeCompare(b.kickoff ?? '') || a.id.localeCompare(b.id)

type Standing = {
  team: Team
  p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number
}

// Build a group table from finished group matches. Sorted points → GD → GF.
function groupTable(teams: Team[], matches: Match[]): Standing[] {
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

// One group's standings table, computed from its finished matches.
function GroupTable({ gms, tmap }: { gms: Match[]; tmap: Record<string, Team> }) {
  const teamIds = new Set<string>()
  for (const m of gms) {
    if (m.home_team_id) teamIds.add(m.home_team_id)
    if (m.away_team_id) teamIds.add(m.away_team_id)
  }
  const groupTeams = [...teamIds].map((id) => tmap[id]).filter(Boolean)
  const table = groupTable(groupTeams, gms)
  return (
    <table className="gtable">
      <thead>
        <tr>
          <th className="t-team">Team</th>
          <th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {table.map((r, i) => (
          <tr key={r.team.id} className={i < 2 ? 'qualifies' : ''}>
            <td className="t-team">
              <Flag code={r.team.code} name={r.team.name} />
              <span className="t-name">{r.team.name}</span>
            </td>
            <td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td>
            <td>{r.gf}</td><td>{r.ga}</td><td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
            <td className="t-pts">{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Bucket fixtures by their (local) calendar date, in date order. A World Cup
// "matchday" can straddle two calendar days, so we group by the real date rather
// than label rounds.
function byDate(matches: Match[]): Array<{ key: string; label: string; matches: Match[] }> {
  const buckets = new Map<string, { label: string; matches: Match[] }>()
  for (const m of [...matches].sort(byKickoff)) {
    const { key, dateLabel } = kickoffParts(m.kickoff)
    if (!buckets.has(key)) buckets.set(key, { label: dateLabel, matches: [] })
    buckets.get(key)!.matches.push(m)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, label: v.label, matches: v.matches }))
}

// A date-grouped list of fixtures: each calendar date heads its matches.
function FixtureDays({ matches, tmap }: { matches: Match[]; tmap: Record<string, Team> }) {
  return (
    <div className="fx-list">
      {byDate(matches).map((day) => (
        <div className="fx-day" key={day.key}>
          <div className="fx-day-head">{day.label}</div>
          {day.matches.map((m) => <Fixture key={m.id} m={m} tmap={tmap} />)}
        </div>
      ))}
    </div>
  )
}

function Score({ m, time }: { m: Match; time: string | null }) {
  if (m.status === 'finished' && m.home_goals != null && m.away_goals != null) {
    const pens = m.home_pens != null && m.away_pens != null ? ` (${m.home_pens}–${m.away_pens} pens)` : ''
    return <b className="fx-score">{m.home_goals} – {m.away_goals}<small className="muted">{pens}</small></b>
  }
  return <span className="fx-vs">{time ?? 'v'}</span>
}

function Fixture({ m, tmap }: { m: Match; tmap: Record<string, Team> }) {
  const h = m.home_team_id ? tmap[m.home_team_id] : null
  const a = m.away_team_id ? tmap[m.away_team_id] : null
  return (
    <div className="fx-row">
      <span className="fx-team home">
        <span className="fx-name">{h?.abbr ?? 'TBD'}</span>
        {h ? <Flag code={h.code} name={h.name} /> : <span className="flag flag-tbd" />}
      </span>
      <Score m={m} time={kickoffParts(m.kickoff).time} />
      <span className="fx-team away">
        {a ? <Flag code={a.code} name={a.name} /> : <span className="flag flag-tbd" />}
        <span className="fx-name">{a?.abbr ?? 'TBD'}</span>
      </span>
    </div>
  )
}

type View = 'standings' | 'fixtures'

export function Fixtures() {
  const [view, setView] = useState<View>('standings')
  const q = useQuery({
    queryKey: ['fixtures'],
    queryFn: () => apiFetch<FixturesView>('/fixtures'),
    refetchInterval: 8000,
  })

  if (q.isLoading) return <div className="wrap"><p className="muted">Loading fixtures…</p></div>
  if (q.isError) return <div className="wrap"><p className="err">{(q.error as Error).message}</p></div>
  const { teams, matches } = q.data!
  const tmap = teamMap(teams)

  const groupMatches = matches.filter((m) => m.stage === 'group')
  const groups = [...new Set(groupMatches.map((m) => m.grp).filter(Boolean) as string[])].sort()
  const finished = matches.filter((m) => m.status === 'finished').length
  const hasKnockouts = KO_STAGES.some((s) => matches.some((m) => m.stage === s))
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <h1>World Cup <span className="yr">2026</span></h1>
          <span className="sub">{groups.length} groups · {finished} results in · times in {tz}</span>
        </div>
        <div className="crumbs"><Link to="/">home</Link></div>
      </div>

      <div className="tabs" role="tablist">
        <button className={'tab' + (view === 'standings' ? ' on' : '')} onClick={() => setView('standings')}>Standings</button>
        <button className={'tab' + (view === 'fixtures' ? ' on' : '')} onClick={() => setView('fixtures')}>Fixtures</button>
      </div>

      {view === 'standings' ? (
        <div className="group-grid">
          {groups.map((g) => (
            <div className="panel group-panel" key={g}>
              <h2>Group {g}</h2>
              <GroupTable gms={groupMatches.filter((m) => m.grp === g)} tmap={tmap} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="group-grid">
            {groups.map((g) => (
              <div className="panel group-panel" key={g}>
                <h2>Group {g}</h2>
                <FixtureDays matches={groupMatches.filter((m) => m.grp === g)} tmap={tmap} />
              </div>
            ))}
          </div>

          {hasKnockouts && (
            <div className="panel">
              <h2>Knockouts</h2>
              <div className="ko-grid">
                {KO_STAGES.map((s) => {
                  const sms = matches.filter((m) => m.stage === s)
                  if (!sms.length) return null
                  return (
                    <div className="ko-stage" key={s}>
                      <h3 className="ko-label">{KO_LABEL[s]}</h3>
                      <FixtureDays matches={sms} tmap={tmap} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
