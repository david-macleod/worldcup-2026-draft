import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type LeagueView } from '../lib/api'
import { Flag } from '../components/ui'
import { eliminatedTeams } from '../lib/elimination'

// Country rankings — every drafted nation on its own row, ordered by points scored, with a
// tier-coloured bar sized relative to the top scorer. Same visual language as the main
// league table's squad bars, but one country per row instead of one manager.
const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')

interface Row { id: string; name: string; code: string; tier: number; total: number; owner: string | null }

function buildRows(view: LeagueView): Row[] {
  const owner: Record<string, string> = {}
  const mgrName = Object.fromEntries(view.managers.map((m) => [m.id, m.name]))
  for (const p of view.picks) if (mgrName[p.managerId]) owner[p.teamId] = mgrName[p.managerId]
  const teamById = Object.fromEntries(view.teams.map((t) => [t.id, t]))
  return Object.values(view.perTeamPoints)
    .filter((p) => p.tier != null && teamById[p.teamId]) // drafted nations only (they carry a tier)
    .map((p) => {
      const t = teamById[p.teamId]
      return { id: t.id, name: t.name, code: t.code, tier: p.tier as number, total: p.total, owner: owner[t.id] ?? null }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export function Countries({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => apiFetch<LeagueView>(`/leagues/${leagueId}`),
    refetchInterval: 8000,
  })
  const rows = useMemo(() => (q.data ? buildRows(q.data) : []), [q.data])
  const out = useMemo(() => (q.data ? eliminatedTeams(q.data) : new Set<string>()), [q.data])

  if (q.isLoading) return <div className="results"><p className="empty">Loading…</p></div>
  if (q.isError) return <div className="results"><p className="empty">{(q.error as Error).message}</p></div>
  const view = q.data!
  const top = Math.max(1, ...rows.map((r) => r.total)) // longest bar = the top scorer

  return (
    <div className="results">
      <div className="hero">
        <Link to="/l/$leagueId" params={{ leagueId }} className="hero-globe" title="Back to standings">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Country rankings</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
      </div>

      <section>
        <div className="sec-head"><h2>Nations by points scored</h2></div>
        {rows.length === 0 ? (
          <p className="empty">No drafted nations yet — countries appear once the draft is done.</p>
        ) : (
          <>
            <div className="cr-list">
              {rows.map((r, i) => (
                <div className="cr-row" key={r.id}>
                  <b className="cr-rank">{i + 1}</b>
                  <span className="cr-flag"><Flag code={r.code} name={r.name} faded={out.has(r.id)} /></span>
                  <span className="cr-name">
                    {r.name}
                    {r.owner && <span className="cr-owner"> · {r.owner}</span>}
                  </span>
                  <div className="cr-track">
                    <div className={clsx('cr-bar', `t${r.tier}`)} style={{ width: `${(r.total / top) * 100}%` }} title={`Tier ${r.tier}`} />
                  </div>
                  <b className={clsx('cr-pts', r.total === 0 && 'zero')}>{r.total}</b>
                </div>
              ))}
            </div>
            <div className="cr-legend">
              {[1, 2, 3].map((t) => (
                <span className={clsx('cr-key', `t${t}`)} key={t}><i className="cr-swatch" />Tier {t}</span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
