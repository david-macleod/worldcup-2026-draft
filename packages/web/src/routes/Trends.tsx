import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type LeagueView, type Match } from '../lib/api'

// Two per-manager charts over the competition. Each group game is its own round (a team's
// 1st/2nd/3rd group match → rounds 1/2/3), then the knockout stages (R32=4 … Final=8).
//   1. Points per round — cumulative points ÷ matches played (running PPG).
//   2. Total points — cumulative points over time.

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

interface Series { id: string; name: string; color: string; pts: number[]; games: number[] }

function buildSeries(view: LeagueView): { series: Series[]; maxRound: number } {
  const n = view.league.nManagers
  const tierByTeam: Record<string, number> = {}
  for (const p of view.picks) tierByTeam[p.teamId] = tierOfRound(Math.floor(p.overall / n))

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
  for (const t of view.teams) {
    const gms = view.matches
      .filter((m) => m.stage === 'group' && finished(m) && (m.home_team_id === t.id || m.away_team_id === t.id))
      .sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''))
    gms.forEach((m, i) => {
      const s = side(m, m.home_team_id === t.id)
      if (s) perTeam[t.id].push({ round: i + 1, pts: s.pts })
    })
  }
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
    const pts = Array(maxRound + 1).fill(0)
    const games = Array(maxRound + 1).fill(0)
    for (const teamId of squads[mgr.id] || []) {
      for (const r of perTeam[teamId] || []) { pts[r.round] += r.pts; games[r.round] += 1 }
    }
    return { id: mgr.id, name: mgr.name, color: mgr.color, pts: pts.slice(1), games: games.slice(1) }
  })
  return { series, maxRound }
}

interface Line { id: string; name: string; color: string; ys: number[] }

// Reusable SVG line chart with a crosshair hover tooltip listing every manager at the
// nearest round.
function Chart({ labels, lines, fmt }: { labels: string[]; lines: Line[]; fmt: (n: number) => string }) {
  const [hi, setHi] = useState<number | null>(null)
  const W = 760, H = 420, mL = 40, mR = 14, mT = 14, mB = 34
  const plotW = W - mL - mR, plotH = H - mT - mB
  const nR = labels.length
  const maxY = Math.max(1, ...lines.flatMap((l) => l.ys))
  const xFor = (i: number) => nR <= 1 ? mL + plotW / 2 : mL + (i / (nR - 1)) * plotW
  const yFor = (v: number) => mT + (1 - v / maxY) * plotH
  const yTicks = Array.from({ length: 5 }, (_, i) => (maxY * i) / 4)

  const onMove = (e: React.MouseEvent) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!
    const rect = svg.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (W / rect.width)
    const i = nR <= 1 ? 0 : Math.round(((x - mL) / plotW) * (nR - 1))
    setHi(Math.max(0, Math.min(nR - 1, i)))
  }

  // tooltip contents (managers sorted by value at the hovered round)
  const tip = hi == null ? null : [...lines].sort((a, b) => b.ys[hi] - a.ys[hi])
  const tipW = 132, tipLH = 15, tipH = tip ? 20 + tip.length * tipLH : 0
  const tipX = hi == null ? 0 : Math.min(Math.max(xFor(hi) + 10, mL), W - mR - tipW)

  return (
    <div className="trend-wrap">
      <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line className="trend-grid" x1={mL} y1={yFor(v)} x2={W - mR} y2={yFor(v)} />
            <text className="trend-axis" x={mL - 6} y={yFor(v) + 3} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {labels.map((lab, i) => <text key={i} className="trend-axis" x={xFor(i)} y={H - mB + 16} textAnchor="middle">{lab}</text>)}
        {lines.map((l) => (
          <g key={l.id}>
            <polyline className="trend-line" points={l.ys.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')} style={{ stroke: l.color }} />
            {l.ys.map((v, i) => <circle key={i} cx={xFor(i)} cy={yFor(v)} r={2.4} style={{ fill: l.color }} />)}
          </g>
        ))}
        {hi != null && tip && (
          <g pointerEvents="none">
            <line className="trend-cross" x1={xFor(hi)} y1={mT} x2={xFor(hi)} y2={H - mB} />
            {lines.map((l) => <circle key={l.id} cx={xFor(hi)} cy={yFor(l.ys[hi])} r={3.6} style={{ fill: l.color, stroke: 'var(--bg)', strokeWidth: 1.5 }} />)}
            <g transform={`translate(${tipX},${mT})`}>
              <rect className="trend-tip-bg" width={tipW} height={tipH} rx={7} />
              <text className="trend-tip-h" x={8} y={14}>{labels[hi]}</text>
              {tip.map((l, i) => (
                <g key={l.id} transform={`translate(8,${24 + i * tipLH})`}>
                  <circle cx={4} cy={-3} r={4} style={{ fill: l.color }} />
                  <text className="trend-tip-n" x={14} y={0}>{l.name}</text>
                  <text className="trend-tip-v" x={tipW - 16} y={0} textAnchor="end">{fmt(l.ys[hi])}</text>
                </g>
              ))}
            </g>
          </g>
        )}
        <rect x={mL} y={mT} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHi(null)} />
      </svg>
    </div>
  )
}

export function Trends({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => apiFetch<LeagueView>(`/leagues/${leagueId}`),
    refetchInterval: 8000,
  })
  const built = useMemo(() => (q.data ? buildSeries(q.data) : null), [q.data])

  if (q.isLoading) return <div className="results"><p className="empty">Loading…</p></div>
  if (q.isError) return <div className="results"><p className="empty">{(q.error as Error).message}</p></div>
  const view = q.data!
  const { series, maxRound } = built!
  const labels = Array.from({ length: maxRound }, (_, i) => ROUND_LABEL[i + 1] ?? String(i + 1))

  // 1) running points per round (cumulative points ÷ matches played)
  const ppg: Line[] = series.map((s) => {
    let cumP = 0, cumG = 0
    return { id: s.id, name: s.name, color: s.color, ys: s.pts.map((p, i) => { cumP += p; cumG += s.games[i]; return cumG > 0 ? cumP / cumG : 0 }) }
  })
  // 2) total points over time (cumulative)
  const totals: Line[] = series.map((s) => {
    let cum = 0
    return { id: s.id, name: s.name, color: s.color, ys: s.pts.map((p) => (cum += p)) }
  })

  return (
    <div className="results">
      <div className="hero">
        <Link to="/l/$leagueId" params={{ leagueId }} className="hero-globe" title="Back to standings">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Form guide</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
      </div>

      {maxRound === 0 ? (
        <p className="empty">No results yet.</p>
      ) : (
        <>
          <section>
            <div className="sec-head"><h2>Points per round</h2></div>
            <Chart labels={labels} lines={ppg} fmt={(n) => n.toFixed(1)} />
          </section>
          <section>
            <div className="sec-head"><h2>Total points</h2></div>
            <Chart labels={labels} lines={totals} fmt={(n) => String(Math.round(n))} />
          </section>
          <div className="trend-legend">
            {series.map((s) => (
              <span className="trend-key" key={s.id}>
                <span className="trend-swatch" style={{ background: s.color }} />{s.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
