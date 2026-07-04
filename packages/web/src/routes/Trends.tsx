import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type LeagueView, type Match } from '../lib/api'

// Cumulative points-per-round for every manager. Each group game is its own round
// (a team's 1st/2nd/3rd group match → rounds 1/2/3), then the knockout stages follow
// (R32=4 … Final=8). At round N the y-value is the squad's cumulative points ÷ N.

const KO_ROUND: Record<string, number> = { R32: 4, R16: 5, QF: 6, SF: 7, Final: 8 }
const ROUND_LABEL: Record<number, string> = { 1: 'G1', 2: 'G2', 3: 'G3', 4: 'R32', 5: 'R16', 6: 'QF', 7: 'SF', 8: 'F' }
const tierOfRound = (round0: number) => Math.min(3, Math.floor(round0 / 2) + 1)
const finished = (m: Match) => m.status === 'finished' && m.home_goals != null && m.away_goals != null

function matchPoints(gf: number, ga: number, goals90: number, tier?: number, oppTier?: number): number {
  const result = gf > ga ? 3 : gf === ga ? 1 : 0
  let bonus = 0
  if (gf >= ga && tier != null && oppTier != null && oppTier < tier) bonus = (tier - oppTier) * (1 + goals90)
  return result + goals90 + bonus
}

interface Series { id: string; name: string; color: string; pts: number[]; games: number[] /* per round: points earned + matches played that round */ }

function buildSeries(view: LeagueView): { series: Series[]; maxRound: number } {
  const n = view.league.nManagers
  const tierByTeam: Record<string, number> = {}
  for (const p of view.picks) tierByTeam[p.teamId] = tierOfRound(Math.floor(p.overall / n))

  // round + points for each team's finished matches
  const perTeam: Record<string, Array<{ round: number; pts: number }>> = {}
  for (const t of view.teams) perTeam[t.id] = []
  const side = (m: Match, home: boolean) => {
    const id = home ? m.home_team_id : m.away_team_id
    const oppId = home ? m.away_team_id : m.home_team_id
    if (!id) return null
    const gf = (home ? m.home_goals : m.away_goals)!
    const ga = (home ? m.away_goals : m.home_goals)!
    const g90 = (home ? m.home_g90 : m.away_g90) ?? gf
    return { id, pts: matchPoints(gf, ga, g90, tierByTeam[id], oppId ? tierByTeam[oppId] : undefined) }
  }
  // group games → rounds 1..3 by each team's own kickoff order
  for (const t of view.teams) {
    const gms = view.matches
      .filter((m) => m.stage === 'group' && finished(m) && (m.home_team_id === t.id || m.away_team_id === t.id))
      .sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''))
    gms.forEach((m, i) => {
      const s = side(m, m.home_team_id === t.id)
      if (s) perTeam[t.id].push({ round: i + 1, pts: s.pts })
    })
  }
  // knockout games → fixed round per stage
  for (const m of view.matches) {
    if (m.stage === 'group' || !finished(m)) continue
    const round = KO_ROUND[m.stage]
    if (!round) continue
    for (const home of [true, false]) {
      const s = side(m, home)
      if (s) perTeam[s.id].push({ round, pts: s.pts })
    }
  }

  const maxRound = Math.max(0, ...Object.values(perTeam).flat().map((x) => x.round))
  const squads: Record<string, string[]> = {}
  for (const p of view.picks) (squads[p.managerId] ||= []).push(p.teamId)

  const series: Series[] = view.managers.map((mgr) => {
    const pts = Array(maxRound + 1).fill(0)   // points earned in each round
    const games = Array(maxRound + 1).fill(0) // matches played in each round
    for (const teamId of squads[mgr.id] || []) {
      for (const r of perTeam[teamId] || []) { pts[r.round] += r.pts; games[r.round] += 1 }
    }
    return { id: mgr.id, name: mgr.name, color: mgr.color, pts: pts.slice(1), games: games.slice(1) }
  })
  return { series, maxRound }
}

export function Trends({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => apiFetch<LeagueView>(`/leagues/${leagueId}`),
    refetchInterval: 8000,
  })
  const data = useMemo(() => (q.data ? buildSeries(q.data) : null), [q.data])

  if (q.isLoading) return <div className="results"><p className="empty">Loading…</p></div>
  if (q.isError) return <div className="results"><p className="empty">{(q.error as Error).message}</p></div>
  const view = q.data!
  const { series, maxRound } = data!

  // running points-per-round: cumulative points ÷ cumulative matches played (each match
  // counts as a round). The last value equals the manager's overall PPG.
  const lines = series.map((s) => {
    let cumP = 0, cumG = 0
    const ys = s.pts.map((p, i) => { cumP += p; cumG += s.games[i]; return cumG > 0 ? cumP / cumG : 0 })
    return { ...s, ys }
  })
  const maxY = Math.max(1, ...lines.flatMap((l) => l.ys))

  // geometry
  const W = 760, H = 430, mL = 40, mR = 16, mT = 16, mB = 40
  const plotW = W - mL - mR, plotH = H - mT - mB
  const xFor = (round: number) => maxRound <= 1 ? mL + plotW / 2 : mL + ((round - 1) / (maxRound - 1)) * plotW
  const yFor = (v: number) => mT + (1 - v / maxY) * plotH
  const yTicks = Array.from({ length: 5 }, (_, i) => (maxY * i) / 4)

  return (
    <div className="results">
      <div className="hero">
        <Link to="/l/$leagueId" params={{ leagueId }} className="hero-globe" title="Back to standings">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Form guide</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
      </div>

      <section>
        <div className="sec-head"><h2>Points per round</h2></div>
        {maxRound === 0 ? (
          <p className="empty">No results yet.</p>
        ) : (
          <>
            <div className="trend-wrap">
              <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative points per round by manager">
                {yTicks.map((v, i) => (
                  <g key={i}>
                    <line className="trend-grid" x1={mL} y1={yFor(v)} x2={W - mR} y2={yFor(v)} />
                    <text className="trend-axis" x={mL - 6} y={yFor(v) + 3} textAnchor="end">{v.toFixed(1)}</text>
                  </g>
                ))}
                {Array.from({ length: maxRound }, (_, i) => i + 1).map((r) => (
                  <text key={r} className="trend-axis" x={xFor(r)} y={H - mB + 16} textAnchor="middle">{ROUND_LABEL[r] ?? r}</text>
                ))}
                <text className="trend-axis-title" x={mL + plotW / 2} y={H - 4} textAnchor="middle">Round</text>
                {lines.map((l) => (
                  <g key={l.id}>
                    <polyline className="trend-line" points={l.ys.map((v, i) => `${xFor(i + 1)},${yFor(v)}`).join(' ')} style={{ stroke: l.color }} />
                    {l.ys.map((v, i) => <circle key={i} cx={xFor(i + 1)} cy={yFor(v)} r={2.6} style={{ fill: l.color }} />)}
                  </g>
                ))}
              </svg>
            </div>
            <div className="trend-legend">
              {lines.map((l) => (
                <span className="trend-key" key={l.id}>
                  <span className="trend-swatch" style={{ background: l.color }} />
                  {l.name}<b>{l.ys.length ? l.ys[l.ys.length - 1].toFixed(2) : '—'}</b>
                </span>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
