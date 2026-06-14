// Results / standings — TSX port of the original comp.jsx, computed from the real
// league view (matches/teams/picks). Shows the leaderboard + the group-stage
// results feed (per-match tier-based scoring breakdown). Group tables and the
// knockout bracket are intentionally not shown.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type React from 'react'
import { Link } from '@tanstack/react-router'
import type { LeagueView, Team } from '../lib/api'
import { Flag } from './ui'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')
const tierOf = (idx: number) => Math.min(3, Math.floor(idx / 2) + 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Owners = Record<string, { name: string; color: string; tier: number }>

// Per-match scoring — identical to the API's matchScore (services/scoring.ts).
// tier/oppTier: 1 (best)..3 (worst), or null if undrafted.
function matchScore(gf: number, ga: number, tier: number | null, oppTier: number | null) {
  const result = gf > ga ? 3 : gf === ga ? 1 : 0
  const goals = gf
  let bonus = 0
  if (gf >= ga && tier != null && oppTier != null && oppTier < tier) {
    const diff = tier - oppTier
    bonus = diff * (1 + gf)
  }
  return { result, goals, bonus, total: result + goals + bonus }
}

// teamId -> { managerName, color, tier } from the draft
function buildOwners(view: LeagueView): Owners {
  const mgr = Object.fromEntries(view.managers.map((m) => [m.id, m]))
  const n = view.league.nManagers
  const owners: Owners = {}
  for (const p of view.picks) {
    const m = mgr[p.managerId]
    if (m) owners[p.teamId] = { name: m.name, color: m.color, tier: tierOf(Math.floor(p.overall / n)) }
  }
  return owners
}

// ── Tier reference — every drafted team grouped by tier, banded in tier colour ──
function tiersOf(view: LeagueView): Record<number, Team[]> {
  const n = view.league.nManagers
  const teamById = Object.fromEntries(view.teams.map((t) => [t.id, t]))
  const byTier: Record<number, Team[]> = { 1: [], 2: [], 3: [] }
  for (const p of [...view.picks].sort((a, b) => a.overall - b.overall)) {
    const t = teamById[p.teamId]
    if (t) byTier[tierOf(Math.floor(p.overall / n))].push(t)
  }
  return byTier
}
function TiersPanel({ view }: { view: LeagueView }) {
  const byTier = useMemo(() => tiersOf(view), [view])
  if (!view.picks.length) return null
  return (
    <div className="tiers-panel">
      <b className="foot-h">Tiers</b>
      {[1, 2, 3].map((tier) => (
        <div className={clsx('tier-band', `t${tier}`)} key={tier}>
          <span className="tier-label">Tier {tier}</span>
          <div className="tier-teams">
            {byTier[tier].map((t) => (
              <span className="tier-team" key={t.id} title={t.name}><Flag code={t.code} name={t.name} />{t.abbr}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface FeedMatch { a: Team; b: Team; ga: number | null; gb: number | null; played: boolean; kickoff: string | null }
function groupResultsFeed(view: LeagueView): Array<{ group: string; matches: FeedMatch[] }> {
  const teamById = Object.fromEntries(view.teams.map((t) => [t.id, t]))
  const byGroup: Record<string, Array<FeedMatch & { sort: string }>> = {}
  for (const m of view.matches) {
    if (m.stage !== 'group' || !m.grp) continue
    const a = teamById[m.home_team_id!], b = teamById[m.away_team_id!]
    if (!a || !b) continue
    const played = m.status === 'finished' && m.home_goals != null && m.away_goals != null
    ;(byGroup[m.grp] ||= []).push({
      a, b, ga: played ? m.home_goals : null, gb: played ? m.away_goals : null,
      played, kickoff: m.kickoff, sort: m.kickoff || m.id,
    })
  }
  // chronological by kickoff within each group (falls back to match id)
  for (const g of Object.keys(byGroup)) byGroup[g].sort((x, y) => x.sort.localeCompare(y.sort))
  return Object.keys(byGroup).sort().map((g) => ({ group: g, matches: byGroup[g] }))
}

function StandingsLeaderboard({ view, highlight }: { view: LeagueView; highlight?: string }) {
  const teamById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  // finished-match appearances per team (a team that has played twice counts 2)
  const playedByTeam = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of view.matches) {
      if (m.status !== 'finished') continue
      if (m.home_team_id) c[m.home_team_id] = (c[m.home_team_id] || 0) + 1
      if (m.away_team_id) c[m.away_team_id] = (c[m.away_team_id] || 0) + 1
    }
    return c
  }, [view.matches])
  const lb = view.leaderboard
  const [byPpg, setByPpg] = useState(false)
  // which rows are expanded into the vertical per-team breakdown (multiple allowed)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // Bar scaling stays tied to the highest TOTAL points regardless of sort, so bars never change.
  const top = Math.max(1, ...lb.map((r) => r.total))
  const allZero = lb.every((r) => r.total === 0)
  // Reserve the "yet to score" cluster's width by the manager with the MOST remaining
  // (0-pt) teams, so every row's dashed divider lines up. Desktop = one row; mobile
  // wraps to 2 rows (3 cols), snapping narrower as the global max drops.
  const maxHold = Math.max(0, ...lb.map((r) => r.squad.filter((x) => (x.points?.total ?? 0) <= 0).length))
  const holdColsD = Math.max(1, maxHold)
  const holdColsM = Math.min(3, Math.max(1, Math.ceil(maxHold / 2)))

  // games played (squad match appearances) + points-per-game; resort by the active metric
  const rows = lb.map((row) => {
    const played = row.squad.reduce((s, x) => s + (playedByTeam[x.teamId] || 0), 0)
    return { row, played, ppg: played > 0 ? row.total / played : 0 }
  })
  const sorted = byPpg
    ? [...rows].sort((a, b) => b.ppg - a.ppg || b.row.total - a.row.total || a.row.name.localeCompare(b.row.name))
    : rows

  return (
    <>
      <div className="sec-head">
        <h2>Standings</h2>
        <button className="sec-toggle" onClick={() => setByPpg((v) => !v)}>
          {byPpg ? 'Show total points' : 'Show points-per-game'}
        </button>
      </div>
      <div className="lb-legend">
        <span className="lg t1">Tier 1</span><span className="lg t2">Tier 2</span>
        <span className="lg t3">Tier 3</span><span className="lg held">Yet to score</span>
      </div>
      {allZero && <p className="empty">No results entered yet — the table fills in as the commissioner enters scorelines.</p>}
      <div className="lb-grid" style={{ ['--hcols-d' as string]: holdColsD, ['--hcols-m' as string]: holdColsM }}>
        {sorted.map(({ row, played, ppg }, i) => {
          const segs = row.squad.map((x, idx) => ({ team: teamById[x.teamId], points: x.points, total: x.points.total, tier: tierOf(idx), round: idx + 1 }))
            .filter((s) => s.team)
          const scoring = segs.filter((s) => s.total > 0)
          const holding = segs.filter((s) => s.total <= 0)
          // expanded view: every team ranked by points (ties keep draft order)
          const ranked = [...segs].sort((a, b) => b.total - a.total || a.round - b.round)
          const barPct = (row.total / top) * 100
          // top three (with a positive score) get gold/silver/bronze medal styling
          const medal = (byPpg ? ppg : row.total) > 0 && i < 3 ? (['gold', 'silver', 'bronze'] as const)[i] : null
          const isOpen = open.has(row.managerId)
          return (
            <div className={clsx('lb-row', medal, row.managerId === highlight && 'you', isOpen && 'open')}
              key={row.managerId} style={{ ['--clk' as string]: row.color, ['--row' as string]: i }}
              role="button" tabIndex={0} aria-expanded={isOpen}
              onClick={() => toggle(row.managerId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row.managerId) } }}>
              <span className="lb-place">{i + 1}</span>
              <span className="lb-name">{row.name}{row.managerId === highlight ? ' · you' : ''}</span>
              <div className="lb-pts"><b>{byPpg ? ppg.toFixed(2) : row.total}</b><span>{byPpg ? 'PPG' : 'PTS'}</span></div>
              <div className="lb-trk">
                <div className="lb-track">
                  <div className="lb-scoring">
                    <div className="lb-bar" style={{ width: `${barPct}%` }}>
                      {scoring.map((s) => (
                        <div className={clsx('lb-seg', `t${s.tier}`)} key={s.team.id} style={{ flexGrow: s.total }}
                          title={`${s.team.name} · ${s.total} pts · pick ${s.round}`}>
                          <span className="lb-seg-flag"><Flag code={s.team.code} name={s.team.name} /></span>
                          <span className="lb-seg-block"><span className="lb-seg-n">{s.total}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {maxHold > 0 && (
                    <div className={clsx('lb-hold', !holding.length && 'empty')}>
                      {holding.map((s) => (
                        <span className="lb-hold-fl" key={s.team.id} title={`${s.team.name} · 0 pts · pick ${s.round}`}>
                          <Flag code={s.team.code} name={s.team.name} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <span className="lb-mp" title={`${played} matches played by this squad`}>
                <b>{played}</b><span className="lb-mp-lbl"><i>matches</i><i>played</i></span>
              </span>
              <div className="lb-bd">
                <div className="lb-breakdown">
                  <div className="lb-bd-head">
                    <span className="lb-bd-team">Team</span>
                    <span className="lb-bd-stat" title="Matches played">P</span>
                    <span className="lb-bd-stat" title="Result — win 3 / draw 1 / loss 0">R</span>
                    <span className="lb-bd-stat" title="Goals — 1 per goal scored">G</span>
                    <span className="lb-bd-stat" title="Bonus — upset bonus">B</span>
                    <span className="lb-bd-total">Pts</span>
                  </div>
                  {ranked.map((s) => (
                    <div className={clsx('lb-bd-row', `t${s.tier}`)} key={s.team.id}>
                      <span className="lb-bd-team">
                        <Flag code={s.team.code} name={s.team.name} />
                        <b className="lb-bd-name">{s.team.name}</b>
                      </span>
                      <span className="lb-bd-stat">{playedByTeam[s.team.id] || 0}</span>
                      <span className="lb-bd-stat">{s.points.result}</span>
                      <span className="lb-bd-stat">{s.points.goals}</span>
                      <span className="lb-bd-stat">{s.points.bonus}</span>
                      <span className="lb-bd-total">{s.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ResultRow({ team, gf, ga, owner, oppTier, win, played = true }: {
  team: Team; gf: number; ga: number; owner?: { name: string; tier: number }; oppTier: number | null; win: boolean; played?: boolean
}) {
  const o = owner || { name: '—', tier: 1 }
  // Not played yet: same row format (flag, tier border, owner) minus score + R/G/B + total.
  if (!played) {
    return (
      <div className="rr">
        <div className={clsx('rr-box', `t${o.tier}`)}>
          <Flag code={team.code} name={team.name} />
          <span className="rr-abbr">{team.abbr}</span>
        </div>
        <span className="rr-owner">{o.name}</span>
      </div>
    )
  }
  const s = matchScore(gf, ga, owner?.tier ?? null, oppTier)
  return (
    <div className={clsx('rr', win && 'win')}>
      <div className={clsx('rr-box', `t${o.tier}`)}>
        <Flag code={team.code} name={team.name} />
        <span className="rr-abbr">{team.abbr}</span>
        <span className="rr-score">{gf}</span>
      </div>
      <span className="rr-owner">{o.name}</span>
      <span className="rr-stats">
        <span className="rs"><i>R</i>{s.result}</span>
        <span className="rs"><i>G</i>{s.goals}</span>
        <span className="rs"><i>B</i>{s.bonus}</span>
        <span className={clsx('rr-total', s.total === 0 && 'zero')}>
          +{s.total}
          <span className="rr-tip">
            <span><i>Result</i><b>{s.result}</b></span>
            <span><i>Goals</i><b>{s.goals}</b></span>
            <span><i>Upset bonus</i><b>{s.bonus}</b></span>
            <span className="tot"><i>Total</i><b>+{s.total}</b></span>
          </span>
        </span>
      </span>
    </div>
  )
}

// One match card — two stacked rows (home + away). Shared by the results feed and
// the day strip (which lays these out side by side). Pending = greyed, no R/G/B/total.
function MatchCard({ m, owners }: { m: FeedMatch; owners: Owners }) {
  if (!m.played) {
    return (
      <div className="gr-match pending">
        <ResultRow team={m.a} gf={0} ga={0} owner={owners[m.a.id]} oppTier={null} win={false} played={false} />
        <ResultRow team={m.b} gf={0} ga={0} owner={owners[m.b.id]} oppTier={null} win={false} played={false} />
      </div>
    )
  }
  const aTier = owners[m.a.id]?.tier ?? null
  const bTier = owners[m.b.id]?.tier ?? null
  return (
    <div className="gr-match">
      <ResultRow team={m.a} gf={m.ga!} ga={m.gb!} owner={owners[m.a.id]} oppTier={bTier} win={m.ga! > m.gb!} />
      <ResultRow team={m.b} gf={m.gb!} ga={m.ga!} owner={owners[m.b.id]} oppTier={aTier} win={m.gb! > m.ga!} />
    </div>
  )
}

function GroupResultsFeed({ groups, owners }: {
  groups: Array<{ group: string; matches: FeedMatch[] }>; owners: Owners
}) {
  if (!groups.length) return <p className="empty">No results entered yet — they'll appear here as games are played.</p>
  return (
    <div className="gr-groups">
      {groups.map((gr) => (
        <div className="gr-grp" key={gr.group}>
          <div className="gr-h">Group <b>{gr.group}</b></div>
          <div className="gr-matches">
            {gr.matches.map((m, i) => <MatchCard key={i} m={m} owners={owners} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { id: 'league', label: 'League' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'results', label: 'Results' },
] as const
type TabId = (typeof TABS)[number]['id']

// ── Overview page — the original prev/next carousel (11:00→11:00 UTC day buckets,
// so late kickoffs group with the prior day) + the standings below. Screenshot view. ──
interface CDay { key: string; label: string; startMs: number; endMs: number; matches: FeedMatch[] }
function buildCarouselDays(view: LeagueView): CDay[] {
  const teamById = Object.fromEntries(view.teams.map((t) => [t.id, t]))
  const byKey: Record<string, FeedMatch[]> = {}
  for (const m of view.matches) {
    const a = teamById[m.home_team_id!], b = teamById[m.away_team_id!]
    if (!a || !b || !m.kickoff) continue
    const ms = Date.parse(m.kickoff)
    if (isNaN(ms)) continue
    const played = m.status === 'finished' && m.home_goals != null && m.away_goals != null
    const key = new Date(ms - 11 * 3600_000).toISOString().slice(0, 10)
    ;(byKey[key] ||= []).push({ a, b, ga: played ? m.home_goals : null, gb: played ? m.away_goals : null, played, kickoff: m.kickoff })
  }
  return Object.keys(byKey).sort().map((key) => {
    const startMs = Date.parse(`${key}T11:00:00Z`)
    const d = new Date(`${key}T12:00:00Z`)
    return {
      key, label: `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      startMs, endMs: startMs + 86_400_000,
      matches: byKey[key].sort((x, y) => (x.kickoff || '').localeCompare(y.kickoff || '')),
    }
  })
}

function DayStrip({ days, owners }: { days: CDay[]; owners: Owners }) {
  // index of the bucket containing "now" — used both as the default view and to
  // label days relative to today (yesterday / today / tomorrow).
  const todayIdx = useMemo(() => {
    const now = Date.now()
    const i = days.findIndex((d) => d.endMs > now)
    return i === -1 ? Math.max(0, days.length - 1) : i
  }, [days])
  const [idx, setIdx] = useState(todayIdx)
  const touch = useRef<number | null>(null)
  if (!days.length) return null
  const i = Math.max(0, Math.min(idx, days.length - 1))
  const day = days[i]
  const go = (next: number) => setIdx(Math.max(0, Math.min(next, days.length - 1)))
  const rel = { [-1]: 'Yesterday', [0]: 'Today', [1]: 'Tomorrow' }[i - todayIdx]

  // horizontal swipe on touch devices navigates between days
  const onTouchStart = (e: React.TouchEvent) => { touch.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current == null) return
    const dx = e.changedTouches[0].clientX - touch.current
    touch.current = null
    if (Math.abs(dx) > 45) go(dx < 0 ? i + 1 : i - 1)
  }

  return (
    <section className="daystrip" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="ds-head">
        <button className="ds-nav" aria-label="Previous day" disabled={i <= 0} onClick={() => go(i - 1)}>‹<span className="ds-nav-lbl"> Prev</span></button>
        <div className="ds-title">
          <span className="ds-title-row">{day.label}</span>
          {/* badge sits below the date; render it even when empty (visibility hidden via
              .is-empty) so the header height is identical with or without a badge */}
          <span className={clsx('ds-rel', !rel && 'is-empty')}>{rel || ' '}</span>
        </div>
        <button className="ds-nav" aria-label="Next day" disabled={i >= days.length - 1} onClick={() => go(i + 1)}><span className="ds-nav-lbl">Next </span>›</button>
      </div>
      <div className="ds-matches" key={day.key}>
        {day.matches.map((m, k) => <MatchCard key={k} m={m} owners={owners} />)}
      </div>
    </section>
  )
}

export function OverviewView({ view, highlight }: { view: LeagueView; highlight?: string }) {
  const owners = useMemo(() => buildOwners(view), [view])
  const days = useMemo(() => buildCarouselDays(view), [view])
  return (
    <div className="results">
      <div className="hero">
        <Link to="/l/$leagueId" params={{ leagueId: view.league.id }} className="hero-globe" title="Back to standings">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Overview</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
      </div>
      <DayStrip days={days} owners={owners} />
      <section><StandingsLeaderboard view={view} highlight={highlight} /></section>
    </div>
  )
}

export function ResultsView({ view, homeHref, highlight }: { view: LeagueView; homeHref?: ReactNode; highlight?: string }) {
  const groups = useMemo(() => groupResultsFeed(view), [view])
  const owners = useMemo(() => buildOwners(view), [view])
  const days = useMemo(() => buildCarouselDays(view), [view])
  const [tab, setTab] = useState<TabId>('league')

  // Tabs are mobile-only (CSS-gated): on desktop every panel is shown stacked, on
  // mobile the tab bar appears and `data-tab` toggles which panel is visible.
  return (
    <div className="results" data-tab={tab}>
      <div className="hero">
        <Link to="/l/$leagueId/overview" params={{ leagueId: view.league.id }} className="hero-globe" title="Open overview">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Competition standings</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
        {homeHref}
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={clsx('tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tab-panel" data-panel="fixtures">
        <div className="sec-head"><h2>Fixtures</h2><span className="sec-sub">browse results day by day</span></div>
        <DayStrip days={days} owners={owners} />
      </div>

      <div className="tab-panel" data-panel="league">
        <section><StandingsLeaderboard view={view} highlight={highlight} /></section>

        <div className="legend-row">
          <div className="foot">
            <b className="foot-h">How points work</b>
            <ul>
              <li>Win <b>3</b> · Draw <b>1</b> · Loss <b>0</b></li>
              <li><b>+1</b> for every goal scored</li>
              <li><b>Tiers</b> are set by draft round — picks 1–2 = tier 1, 3–4 = tier 2, 5–6 = tier 3</li>
              <li><b>Upset bonus</b>, only if the team avoids defeat against a higher tier:
                <ul>
                  <li><b>+1</b> for a win/draw vs one tier above · <b>+2</b> vs two tiers above</li>
                  <li><b>+1</b> per goal scored vs one tier above · <b>+2</b> per goal vs two above</li>
                </ul>
              </li>
              <li>Standings update live as real scorelines are entered.</li>
            </ul>
          </div>
          <TiersPanel view={view} />
        </div>
      </div>

      <div className="tab-panel" data-panel="results">
        <div className="sec-head"><h2>Match results</h2><span className="sec-sub"><b>R</b> result · <b>G</b> goals · <b>B</b> upset bonus · total</span></div>
        <GroupResultsFeed groups={groups} owners={owners} />
      </div>
    </div>
  )
}
