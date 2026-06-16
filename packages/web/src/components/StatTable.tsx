// Shared stat table — the standings expand/collapse breakdown, reused for the
// fixtures group tables. Self-contained styling (.btable in app.css) so it looks
// identical wherever it's used; the only thing callers vary is the team-vs-numbers
// split (teamWidth). The final column is always the emphasised total.
import type { CSSProperties, ReactNode } from 'react'
import { Flag } from './ui'

export interface StatColumn { label: string; title?: string }
export interface StatTableRow {
  id: string
  code: string
  name: string
  accent?: 't1' | 't2' | 't3' | 'q' | null // left-edge accent (tier or "qualifies")
  cells: Array<number | string> // stat values in column order, excluding the total
  total: number | string
  meta?: ReactNode // optional second line under the team name (e.g. the owner chip)
}

export function StatTable({ columns, rows, totalLabel, teamWidth }: {
  columns: StatColumn[]
  rows: StatTableRow[]
  totalLabel: string
  teamWidth?: string // CSS width of the team column; the numbers share the rest
}) {
  const style = { '--bt-team': teamWidth, '--bt-cols': columns.length + 1 } as CSSProperties
  return (
    <div className="btable" style={style}>
      <div className="bt-head">
        <span className="bt-team">Team</span>
        {columns.map((c, i) => <span className="bt-stat" key={i} title={c.title}>{c.label}</span>)}
        <span className="bt-total">{totalLabel}</span>
      </div>
      {rows.map((r) => (
        <div className={'bt-row' + (r.accent ? ' ' + r.accent : '')} key={r.id}>
          <span className="bt-team">
            <Flag code={r.code} name={r.name} />
            <span className="bt-team-txt">
              <b className="bt-name">{r.name}</b>
              {r.meta}
            </span>
          </span>
          {r.cells.map((v, i) => <span className="bt-stat" key={i}>{v}</span>)}
          <span className="bt-total">{r.total}</span>
        </div>
      ))}
    </div>
  )
}
