import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type FixturesView, type Match, type Team } from '../lib/api'
import { Flag, teamMap } from '../components/ui'
import { GroupTable } from '../components/GroupTable'
import { Bracket } from '../components/Bracket'

const KO_STAGES = ['R32', 'R16', 'QF', 'SF', 'Final'] as const
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
              <Bracket matches={matches} teams={teams} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
