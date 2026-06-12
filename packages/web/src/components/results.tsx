// Results / standings — TSX port of the original comp.jsx, computed from the real
// league view (matches/teams/picks). Shows the leaderboard + the group-stage
// results feed (per-match tier-based scoring breakdown). Group tables and the
// knockout bracket are intentionally not shown.
import { useMemo, useState, type ReactNode } from 'react'
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

// ── Fixtures — yesterday / today / tomorrow. A day runs 11:00→11:00 UTC so
// late-night kickoffs group with the prior calendar day. ────────────────────
const dayKey = (ms: number) => new Date(ms - 11 * 3600_000).toISOString().slice(0, 10)
function labelForKey(key: string) {
  const d = new Date(`${key}T12:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

interface Day { key: string; label: string; matches: FeedMatch[] }
function buildDays(view: LeagueView): Day[] {
  const teamById = Object.fromEntries(view.teams.map((t) => [t.id, t]))
  const byKey: Record<string, FeedMatch[]> = {}
  for (const m of view.matches) {
    const a = teamById[m.home_team_id!], b = teamById[m.away_team_id!]
    if (!a || !b || !m.kickoff) continue
    const ms = Date.parse(m.kickoff)
    if (isNaN(ms)) continue
    const played = m.status === 'finished' && m.home_goals != null && m.away_goals != null
    ;(byKey[dayKey(ms)] ||= []).push({ a, b, ga: played ? m.home_goals : null, gb: played ? m.away_goals : null, played, kickoff: m.kickoff })
  }
  return Object.keys(byKey).sort().map((key) => ({
    key, label: labelForKey(key),
    matches: byKey[key].sort((x, y) => (x.kickoff || '').localeCompare(y.kickoff || '')),
  }))
}

// Yesterday / today / tomorrow relative to now — empty days still render so the
// three-slot rhythm is preserved.
function FixturesView({ days, owners }: { days: Day[]; owners: Owners }) {
  const byKey = useMemo(() => Object.fromEntries(days.map((d) => [d.key, d])), [days])
  const now = Date.now()
  const slots = [
    { rel: 'Yesterday', key: dayKey(now - 86_400_000) },
    { rel: 'Today', key: dayKey(now) },
    { rel: 'Tomorrow', key: dayKey(now + 86_400_000) },
  ]
  return (
    <div className="fx-days">
      {slots.map(({ rel, key }) => {
        const matches = byKey[key]?.matches ?? []
        return (
          <section className="fx-day" key={rel}>
            <div className="fx-day-head">
              <span className="fx-rel">{rel}</span>
              <span className="fx-date">{labelForKey(key)}</span>
              <span className="fx-count">{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
            </div>
            {matches.length === 0
              ? <p className="empty">No matches scheduled.</p>
              : <div className="fx-matches">{matches.map((m, k) => <MatchCard key={k} m={m} owners={owners} />)}</div>}
          </section>
        )
      })}
    </div>
  )
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
  const top = lb[0]?.total || 1
  const topTotal = lb[0]?.total || 0
  const allZero = lb.every((r) => r.total === 0)
  return (
    <>
      <div className="lb-legend">
        <span className="lg t1">Tier 1</span><span className="lg t2">Tier 2</span>
        <span className="lg t3">Tier 3</span><span className="lg held">Yet to score</span>
      </div>
      {allZero && <p className="empty">No results entered yet — the table fills in as the commissioner enters scorelines.</p>}
      <div className="lb-grid">
        {lb.map((row, i) => {
          const segs = row.squad.map((x, idx) => ({ team: teamById[x.teamId], total: x.points.total, tier: tierOf(idx), round: idx + 1 }))
            .filter((s) => s.team)
          const scoring = segs.filter((s) => s.total > 0)
          const holding = segs.filter((s) => s.total <= 0)
          const barPct = (row.total / top) * 100
          const played = row.squad.reduce((s, x) => s + (playedByTeam[x.teamId] || 0), 0)
          return (
            <div className={clsx('lb-row', topTotal > 0 && row.total === topTotal && 'leader', row.managerId === highlight && 'you')} key={row.managerId} style={{ ['--clk' as string]: row.color }}>
              <span className="lb-place">{i + 1}</span>
              <span className="lb-name">{row.name}{row.managerId === highlight ? ' · you' : ''}</span>
              <div className="lb-pts"><b>{row.total}</b><span>PTS</span></div>
              <div className="lb-track">
                <div className="lb-bar" style={{ flex: `0 1 ${barPct}%` }}>
                  {scoring.map((s) => (
                    <div className={clsx('lb-seg', `t${s.tier}`)} key={s.team.id} style={{ flexGrow: s.total }}
                      title={`${s.team.name} · ${s.total} pts · pick ${s.round}`}>
                      <span className="lb-seg-flag"><Flag code={s.team.code} name={s.team.name} /></span>
                      <span className="lb-seg-block"><span className="lb-seg-n">{s.total}</span></span>
                    </div>
                  ))}
                </div>
                {holding.length > 0 && (
                  <div className="lb-hold">
                    {holding.map((s) => (
                      <span className="lb-hold-fl" key={s.team.id} title={`${s.team.name} · 0 pts · pick ${s.round}`}>
                        <Flag code={s.team.code} name={s.team.name} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="lb-mp" title={`${played} matches played by this squad`}>
                <b>{played}</b><span className="lb-mp-lbl"><i>matches</i><i>played</i></span>
              </span>
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

export function ResultsView({ view, homeHref, highlight }: { view: LeagueView; homeHref?: ReactNode; highlight?: string }) {
  const groups = useMemo(() => groupResultsFeed(view), [view])
  const owners = useMemo(() => buildOwners(view), [view])
  const days = useMemo(() => buildDays(view), [view])
  const [tab, setTab] = useState<TabId>('league')

  // Tabs are mobile-only (CSS-gated): on desktop every panel is shown stacked, on
  // mobile the tab bar appears and `data-tab` toggles which panel is visible.
  return (
    <div className="results" data-tab={tab}>
      <div className="hero">
        <span className="hero-globe">🌍</span>
        <div className="hero-txt">
          <div className="hero-kick">Competition standings</div>
          <h1 className="hero-h1">{view.league.name}</h1>
        </div>
        {homeHref}
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={clsx('tab', tab === t.id && 'active')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="tab-panel" data-panel="fixtures">
        <div className="sec-head"><h2>Fixtures</h2><span className="sec-sub">yesterday · today · tomorrow</span></div>
        <FixturesView days={days} owners={owners} />
      </div>

      <div className="tab-panel" data-panel="league">
        <div className="sec-head"><h2>Standings</h2><span className="sec-sub">managers ranked by total points</span></div>
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
