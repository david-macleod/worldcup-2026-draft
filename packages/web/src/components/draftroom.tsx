// Draft room — faithful TSX port of the original draftboard.jsx / reveal.jsx,
// wired to the API ManagerView. Snake board + order-by panel + bar-chart team
// strip + pick reveal. Keeps the rounded-rectangle flag style.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ManagerView, Team } from '../lib/api'
import { Flag } from './ui'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')

function pickToCell(overall: number, n: number) {
  const round = Math.floor(overall / n)
  const pos = overall % n
  return { round, col: round % 2 === 0 ? pos : n - 1 - pos }
}
function cellToOverall(round: number, col: number, n: number) {
  const pos = round % 2 === 0 ? col : n - 1 - col
  return round * n + pos
}

type Manager = ManagerView['managers'][number]

function PlayerDot({ player, size = 34, ring = false }: { player: Manager; size?: number; ring?: boolean }) {
  return (
    <span className="player-dot" style={{
      width: size, height: size, fontSize: size * 0.4, background: player.color,
      boxShadow: ring ? `0 0 0 2px var(--panel), 0 0 0 4px ${player.color}` : 'none',
    }}>
      {(player.name.trim().slice(0, 2).toUpperCase()) || 'M'}
    </span>
  )
}

// Order-by metrics (haggis dropped — not carried in the API team catalog).
type SortOpt = { id: string; emoji: string; label: string; unit: string; asc: boolean; invert?: boolean; get: (t: Team) => number; fmt: (t: Team) => string }
const SORT_OPTS: SortOpt[] = [
  { id: 'rank', emoji: '🏆', label: 'Overall rank', unit: '', asc: true, invert: true, get: (t) => t.rank || 999, fmt: (t) => `#${t.rank}` },
  { id: 'pop', emoji: '👥', label: 'Population', unit: 'M', asc: false, get: (t) => t.pop ?? 0, fmt: (t) => `${t.pop}M` },
  { id: 'temp', emoji: '🌡️', label: 'Avg temperature', unit: '°C', asc: false, get: (t) => t.temp ?? 0, fmt: (t) => `${t.temp}°` },
  { id: 'rain', emoji: '🌧️', label: 'Avg rainfall', unit: 'mm', asc: false, get: (t) => t.rain ?? 0, fmt: (t) => `${t.rain}mm` },
  { id: 'age', emoji: '🎂', label: 'Avg team age', unit: 'y', asc: false, get: (t) => t.age ?? 0, fmt: (t) => `${(t.age ?? 0).toFixed(1)}y` },
  { id: 'hgt', emoji: '📏', label: 'Avg height', unit: 'cm', asc: false, get: (t) => t.hgt ?? 0, fmt: (t) => `${t.hgt}cm` },
  { id: 'light', emoji: '⚡', label: 'Lightning strikes', unit: '/km²', asc: false, get: (t) => t.light ?? 0, fmt: (t) => `${t.light}/km²` },
  { id: 'dogs', emoji: '🐕', label: 'Dogs per capita', unit: '/1k', asc: false, get: (t) => t.dogs ?? 0, fmt: (t) => `${t.dogs}/1k` },
  { id: 'coffee', emoji: '☕', label: 'Coffee per capita', unit: 'kg', asc: false, get: (t) => t.coffee ?? 0, fmt: (t) => `${t.coffee}kg` },
]

function BoardGrid({ view, zoomOverall }: { view: ManagerView; zoomOverall: number | null }) {
  const order = view.league.order
  const n = view.league.nManagers
  const rounds = 6
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  const mgrById = useMemo(() => Object.fromEntries(view.managers.map((m) => [m.id, m])), [view.managers])
  const picksByOverall = useMemo(() => {
    const o: Record<number, string> = {}
    for (const p of view.picks) o[p.overall] = p.teamId
    return o
  }, [view.picks])
  const current = view.league.status === 'drafting' ? view.league.currentOverall : -1
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (zoomOverall == null) return
    const wrap = scrollRef.current
    const cell = wrap?.querySelector(`[data-overall="${zoomOverall}"]`) as HTMLElement | null
    if (!wrap || !cell) return
    wrap.scrollTo({
      left: Math.max(0, cell.offsetLeft + cell.offsetWidth / 2 - wrap.clientWidth / 2),
      top: Math.max(0, cell.offsetTop + cell.offsetHeight / 2 - wrap.clientHeight / 2),
      behavior: 'smooth',
    })
  }, [zoomOverall])

  return (
    <div className="board-scroll" ref={scrollRef}>
      <div className="board" style={{ ['--cols' as string]: n }}>
        <div className="board-corner">PICK</div>
        {order.map((pid, c) => {
          const p = mgrById[pid]
          return (
            <div className="col-head" key={pid}>
              {p && <PlayerDot player={p} size={26} />}
              <span>{p?.name || `M${c + 1}`}</span>
            </div>
          )
        })}
        {Array.from({ length: rounds }).map((_, r) => (
          <div key={r} style={{ display: 'contents' }}>
            <div className="row-head">
              <span className="rnd-num">{r + 1}</span>
              <span className="rnd-dir">{r % 2 === 0 ? '→' : '←'}</span>
            </div>
            {order.map((pid, c) => {
              const overall = cellToOverall(r, c, n)
              const teamId = picksByOverall[overall]
              const team = teamId ? teamsById[teamId] : null
              const isCurrent = overall === current
              const p = mgrById[pid]
              return (
                <div
                  key={c}
                  data-overall={overall}
                  className={clsx('cell', team && 'filled', isCurrent && 'current', overall === zoomOverall && 'zoomed')}
                  style={(isCurrent || team) && p ? { ['--clk' as string]: p.color } : undefined}
                >
                  {team ? (
                    <>
                      <Flag code={team.code} name={team.name} />
                      <span className="cell-name">{team.name}</span>
                      <span className="cell-pick">{overall + 1}</span>
                    </>
                  ) : isCurrent ? (
                    <span className="cell-onclock">On the clock</span>
                  ) : (
                    <span className="cell-empty">{overall + 1}</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function SortPanel({ sortId, onSort }: { sortId: string; onSort: (id: string) => void }) {
  return (
    <aside className="sort-panel">
      <div className="sort-list">
        {SORT_OPTS.map((o) => (
          <button key={o.id} className={clsx('sort-opt', sortId === o.id && 'active')}
            title={o.asc ? 'Low to high' : 'High to low'} onClick={() => onSort(o.id)}>
            <span className="sort-emoji">{o.emoji}</span>
            <span className="sort-label">{o.label}</span>
            <span className="sort-dir">{o.asc ? '↑' : '↓'}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}

function TeamStrip({ teams, total, onPick, disabled, sortId }: {
  teams: Team[]; total: number; onPick: (id: string) => void; disabled: boolean; sortId: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [colW, setColW] = useState(28)
  const opt = SORT_OPTS.find((o) => o.id === sortId) || SORT_OPTS[0]
  const GAP = 1

  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const measure = () => setColW(Math.max(14, (el.clientWidth - GAP * (total - 1)) / total))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [total])

  const { list, frac } = useMemo(() => {
    const sorted = [...teams].sort((a, b) => (opt.asc ? opt.get(a) - opt.get(b) : opt.get(b) - opt.get(a)))
    const vals = sorted.map(opt.get)
    const min = Math.min(...vals), max = Math.max(...vals)
    const frac = (t: Team) => {
      const f = max === min ? 1 : (opt.get(t) - min) / (max - min)
      return opt.invert ? 1 - f : f
    }
    return { list: sorted, frac }
  }, [teams, sortId])

  // FLIP — slide bars to new positions when the sort changes.
  const posRef = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = chartRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('.chart-col').forEach((node) => {
      const id = node.dataset.id!
      const left = node.offsetLeft
      const prev = posRef.current.get(id)
      if (prev != null && prev !== left) {
        node.animate([{ transform: `translateX(${prev - left}px)` }, { transform: 'translateX(0)' }],
          { duration: 1440, easing: 'cubic-bezier(.33,0,.15,1)' })
      }
      posRef.current.set(id, left)
    })
  }, [list, colW])

  return (
    <section className="team-strip">
      <div className="strip-head">
        <span className="strip-by">Sorted by {opt.label.toLowerCase()}{opt.unit ? ` (${opt.unit})` : ''} {opt.emoji}</span>
      </div>
      <div className="team-chart" ref={chartRef}>
        {list.length === 0 && <span className="strip-empty">No teams left.</span>}
        {list.map((t) => {
          const fr = frac(t)
          const h = Math.round(fr * 100)
          const off = Math.round((1 - fr) * 180)
          const valLabel = opt.fmt(t)
          return (
            <button key={t.id} data-id={t.id} className="chart-col" style={{ width: colW }}
              onClick={() => !disabled && onPick(t.id)} disabled={disabled}
              title={`${t.name} · ${opt.label}: ${valLabel}`}>
              <span className="col-val-wrap" style={{ transform: `translateY(${off}px)` }}>
                <span className={clsx('col-val', sortId !== 'rank' && 'rot')}>{valLabel}</span>
              </span>
              <span className="col-bar-track"><span className="col-bar" style={{ height: `${h}%` }} /></span>
              <Flag code={t.code} name={t.name} />
              <span className="col-name">{t.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function DraftReveal({ team, player, teams, onConfirm, onCancel, busy, err }: {
  team: Team; player: Manager; teams: Team[]; onConfirm: () => void; onCancel: () => void; busy: boolean; err?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onConfirm()
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  const mates = teams.filter((x) => x.grp === team.grp && x.id !== team.id).sort((a, b) => a.rank - b.rank)
  const tier = team.rank <= 8 ? 'elite' : team.rank <= 20 ? 'strong' : 'mid'

  return (
    <div className="reveal-backdrop" onClick={onCancel}>
      <div className="reveal-card" style={{ ['--clk' as string]: player.color }} onClick={(e) => e.stopPropagation()}>
        <div className="reveal-top">
          <PlayerDot player={player} size={42} ring />
          <span>Your pick — <b>{player.name}</b></span>
        </div>
        <div className="reveal-hero">
          <Flag code={team.code} name={team.name} className="hero" />
          <div>
            <span className="reveal-name">{team.name}</span>
            <div className="reveal-tags">
              <span className={`rank-pill rank-${tier}`}>#{team.rank}</span>
              <span className="conf-tag">{team.conf}</span>
            </div>
          </div>
        </div>
        <div className="reveal-rows">
          <div className="reveal-row">
            <span className="rl">Group {team.grp}</span>
            <div className="reveal-group">
              {mates.map((g) => (
                <span className="gm" key={g.id} title={g.name}><Flag code={g.code} name={g.name} /><b>{g.abbr}</b></span>
              ))}
            </div>
          </div>
          {team.star && <div className="reveal-row"><span className="rl">★ Star</span><span className="rv">{team.star}</span></div>}
        </div>
        {err && <p style={{ color: '#ff8b8b', fontFamily: 'var(--mono)', fontSize: 13, margin: '0 0 12px' }}>{err}</p>}
        <div className="reveal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? 'Drafting…' : 'Confirm pick →'}</button>
        </div>
      </div>
    </div>
  )
}

const THEMES = [
  { id: 'midnight', accent: '#2bd47d', swatch: '#10151e' },
  { id: 'broadcast', accent: '#0a7d4d', swatch: '#ffffff' },
  { id: 'pitch', accent: '#ffd34d', swatch: '#0e2a1f' },
]

export function DraftRoom({ view, onPick, onExit }: {
  view: ManagerView
  onPick: (teamId: string) => Promise<void>
  onExit: () => void
}) {
  const [theme, setTheme] = useState(() => localStorage.getItem('wc-theme') || 'midnight')
  const accent = THEMES.find((t) => t.id === theme)?.accent || '#2bd47d'
  const [sortId, setSortId] = useState('rank')
  const [pending, setPending] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState<{ teamId: string; color: string } | null>(null)

  const n = view.league.nManagers
  const done = view.league.status === 'complete'
  const current = view.league.currentOverall
  const teamsById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  const onClockSeat = done ? null : pickToCell(current, n).col
  const onClockManager = onClockSeat != null ? view.managers.find((m) => m.id === view.league.order[onClockSeat]) : undefined
  const me = view.managers.find((m) => m.id === view.me.id) || view.me

  const setThemePersist = (id: string) => { setTheme(id); localStorage.setItem('wc-theme', id) }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    setErr('')
    try {
      await onPick(pending)
      setToast({ teamId: pending, color: me.color })
      setZoom(current)
      setPending(null)
      setTimeout(() => setToast(null), 2200)
      setTimeout(() => setZoom(null), 1500)
    } catch (e) {
      setErr((e as Error).message || 'Pick failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="draft-room" data-theme={theme} style={{ ['--accent' as string]: accent }}>
      <div className="draft">
        <header className="masthead">
          <button className="mh-brand" onClick={onExit} title="Back to standings">
            <span className="mh-trophy" aria-hidden>🌍</span>
            <span className="mh-title">{view.league.name}</span>
          </button>
          {!done && onClockManager && (
            <div className="mh-turn" style={{ ['--clk' as string]: onClockManager.color }}>
              <span className="mh-turn-lbl">On the clock</span>
              <span className="mh-turn-name"><PlayerDot player={onClockManager} size={22} />{onClockManager.name}</span>
            </div>
          )}
          <div className="mh-remain"><b>{48 - view.picks.length}</b>/48 teams remaining</div>
          <div className="mh-themes">
            {THEMES.map((t) => (
              <button key={t.id} className={clsx('mh-theme', theme === t.id && 'active')}
                style={{ background: t.swatch }} title={t.id} onClick={() => setThemePersist(t.id)} />
            ))}
          </div>
        </header>

        {done && (
          <div className="finale">
            <span className="finale-kick">Draft complete</span>
            <span className="finale-txt">All 48 teams drafted — head to the standings.</span>
            <button className="btn btn-primary sm" onClick={onExit}>View standings →</button>
          </div>
        )}
        {!done && !view.onClock && (
          <div className="waitbar" style={{ ['--clk' as string]: onClockManager?.color }}>
            <span className="dot" />
            Waiting for <b style={{ color: 'var(--text)', margin: '0 4px' }}>{onClockManager?.name}</b> to pick — your turn is coming. This page updates on its own.
          </div>
        )}

        <div className="draft-body">
          <div className="draft-main">
            <BoardGrid view={view} zoomOverall={zoom} />
            <SortPanel sortId={sortId} onSort={setSortId} />
          </div>
          <TeamStrip
            teams={view.available}
            total={view.teams.length}
            sortId={sortId}
            disabled={done || !view.onClock || busy}
            onPick={(id) => setPending(id)}
          />
        </div>

        {toast && teamsById[toast.teamId] && (
          <div className="toast" style={{ ['--clk' as string]: toast.color }}>
            <Flag code={teamsById[toast.teamId].code} name={teamsById[toast.teamId].name} />
            <div className="toast-txt"><b>{teamsById[toast.teamId].name}</b><span>drafted to {me.name}</span></div>
          </div>
        )}

        {pending && teamsById[pending] && (
          <DraftReveal
            team={teamsById[pending]} player={me} teams={view.teams}
            onConfirm={confirm} onCancel={() => !busy && setPending(null)} busy={busy} err={err}
          />
        )}
      </div>
    </div>
  )
}
