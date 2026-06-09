import type { LeagueView, Team, LeaderboardEntry } from '../lib/api'

export function Flag({ code, name, lg, className }: { code: string; name?: string; lg?: boolean; className?: string }) {
  return (
    <img
      className={['flag', lg && 'lg', className].filter(Boolean).join(' ')}
      src={`https://flagcdn.com/${code}.svg`}
      alt={name || code}
      loading="lazy"
    />
  )
}

export const teamMap = (teams: Team[]) => Object.fromEntries(teams.map((t) => [t.id, t]))

// Snake board: rounds (rows) x seats (cols). Mirrors the original draftboard layout.
function pickToCell(overall: number, n: number) {
  const round = Math.floor(overall / n)
  const pos = overall % n
  const col = round % 2 === 0 ? pos : n - 1 - pos
  return { round, col }
}

export function Board({ view }: { view: LeagueView }) {
  const n = view.league.nManagers
  const rounds = 6
  const tmap = teamMap(view.teams)
  const order = view.league.order
  const seatName = (seat: number) => {
    const mid = order[seat]
    return view.managers.find((m) => m.id === mid)?.name ?? `Seat ${seat + 1}`
  }
  // overall -> pick
  const byOverall: Record<number, { teamId: string }> = {}
  for (const p of view.picks) byOverall[p.overall] = { teamId: p.teamId }
  const live = view.league.status === 'drafting' ? view.league.currentOverall : -1

  const grid: Array<Array<{ overall: number; teamId?: string }>> = []
  for (let r = 0; r < rounds; r++) {
    const row: Array<{ overall: number; teamId?: string }> = []
    for (let col = 0; col < n; col++) {
      const pos = r % 2 === 0 ? col : n - 1 - col
      const overall = r * n + pos
      row.push({ overall, teamId: byOverall[overall]?.teamId })
    }
    grid.push(row)
  }

  return (
    <div className="board">
      <table>
        <thead>
          <tr>
            <th>Rd</th>
            {Array.from({ length: n }, (_, c) => <th key={c}>{order.length ? seatName(c) : `Seat ${c + 1}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              <th>{r + 1}</th>
              {row.map((cell, c) => {
                const t = cell.teamId ? tmap[cell.teamId] : null
                return (
                  <td key={c} className={cell.overall === live ? 'live' : ''}>
                    {t ? (
                      <div className="cell"><Flag code={t.code} name={t.name} /><span className="ab">{t.abbr}</span></div>
                    ) : cell.overall === live ? <span className="muted">on clock</span> : <span className="muted">·</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Leaderboard({ entries, teams, highlight }: {
  entries: LeaderboardEntry[]; teams: Team[]; highlight?: string
}) {
  const tmap = teamMap(teams)
  return (
    <div className="lb">
      {entries.map((row, i) => (
        <div
          key={row.managerId}
          className={'lb-row' + (i === 0 ? ' leader' : '')}
          style={{ ['--clk' as any]: row.color }}
        >
          <div className="pos">{i + 1}</div>
          <div>
            <div className="who">{row.name}{highlight === row.managerId ? ' · you' : ''}</div>
            <div className="meta">{row.advanced} advanced · deepest {row.deepestStage}</div>
            <div className="squad-chips">
              {row.squad.map((s) => {
                const t = tmap[s.teamId]
                if (!t) return null
                return (
                  <span className="chip" key={s.teamId} title={`${t.name}: ${s.points.total} pts`}>
                    <Flag code={t.code} name={t.name} /> {t.abbr} <b>{s.points.total}</b>
                  </span>
                )
              })}
            </div>
          </div>
          <div className="pts">{row.total}<small> pts</small></div>
        </div>
      ))}
    </div>
  )
}
