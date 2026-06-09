import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type LeagueView } from '../lib/api'
import { Board, Leaderboard, Flag, teamMap } from '../components/ui'

const MODE_LABEL: Record<string, string> = { sequential: 'Live snake', autodraft: 'Autodraft', imported: 'Imported' }

export function PublicLeague({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => apiFetch<LeagueView>(`/leagues/${leagueId}`),
    refetchInterval: 8000,
  })

  if (q.isLoading) return <div className="wrap"><p className="muted">Loading league…</p></div>
  if (q.isError) return <div className="wrap"><p className="err">{(q.error as Error).message}</p></div>
  const v = q.data!
  const finished = v.matches.filter((m) => m.status === 'finished')
  const tmap = teamMap(v.teams)

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <h1>{v.league.name}</h1>
          <span className="sub">{MODE_LABEL[v.league.mode]} · {v.league.status}</span>
        </div>
        <div className="crumbs"><Link to="/">home</Link></div>
      </div>

      <div className="panel">
        <h2>Standings</h2>
        <p className="sec-sub">points = per-match fantasy + stage progression · {finished.length} results in</p>
        {v.leaderboard.every((r) => r.total === 0)
          ? <p className="muted">No results entered yet — the table lights up once the commissioner enters scorelines.</p>
          : <Leaderboard entries={v.leaderboard} teams={v.teams} />}
      </div>

      <div className="panel">
        <h2>Draft board</h2>
        <Board view={v} />
      </div>

      {finished.length > 0 && (
        <div className="panel">
          <h2>Results</h2>
          <div className="stack">
            {finished.map((m) => {
              const h = m.home_team_id ? tmap[m.home_team_id] : null
              const a = m.away_team_id ? tmap[m.away_team_id] : null
              if (!h || !a) return null
              return (
                <div key={m.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="pill">{m.stage === 'group' ? `Group ${m.grp}` : m.stage}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Flag code={h.code} name={h.name} />{h.abbr}</span>
                  <b>{m.home_goals} – {m.away_goals}</b>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{a.abbr}<Flag code={a.code} name={a.name} /></span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
