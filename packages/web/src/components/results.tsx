// Results / standings — TSX port of the original comp.jsx, computed from the real
// league view (matches/teams/picks). Shows the leaderboard + the group-stage
// results feed (per-match tier-based scoring breakdown). Group tables and the
// knockout bracket are intentionally not shown.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type React from 'react'
import { Link } from '@tanstack/react-router'
import type { LeagueView, Match, Team } from '../lib/api'
import { Flag, teamMap } from './ui'
import { StatTable } from './StatTable'
import { GroupTable, OwnerChip } from './GroupTable'
import { Bracket } from './Bracket'
import { eliminatedTeams } from '../lib/elimination'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')
// rank-movement tooltip — change over the most recent completed matchday
const moveLabel = (d: number) => d > 0 ? `Up ${d} over the last matchday` : d < 0 ? `Down ${-d} over the last matchday` : 'No change over the last matchday'
const tierOf = (idx: number) => Math.min(3, Math.floor(idx / 2) + 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local kickoff time for the day-strip cards. Single-digit hours are zero-padded
// (9:00 PM -> 09:00 PM) so times align in the carousel. Group kickoffs are full UTC instants.
function fmtTime(iso: string): string {
  const t = new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return t.replace(/^(\d)\b/, '0$1')
}

type Owners = Record<string, { name: string; color: string; tier: number }>

// Per-match scoring — identical to the API's matchScore (services/scoring.ts).
// tier/oppTier: 1 (best)..3 (worst), or null if undrafted. gf/ga are the FINAL score
// (decide result + avoided-defeat); goals90 is goals in 90' only (goal points + per-goal
// bonus), defaulting to gf for groups and any match that didn't go to extra time.
function matchScore(gf: number, ga: number, tier: number | null, oppTier: number | null, goals90: number = gf) {
  const result = gf > ga ? 3 : gf === ga ? 1 : 0
  const goals = goals90
  let bonus = 0
  if (gf >= ga && tier != null && oppTier != null && oppTier < tier) {
    const diff = tier - oppTier
    bonus = diff * (1 + goals90)
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

// Shared "definitely out" set, provided once per view so every flag can fade.
const ElimCtx = createContext<Set<string>>(new Set())
const useElim = () => useContext(ElimCtx)

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
  const elim = useElim()
  if (!view.picks.length) return null
  return (
    <div className="tiers-panel">
      <b className="foot-h">Tiers</b>
      {[1, 2, 3].map((tier) => (
        <div className={clsx('tier-band', `t${tier}`)} key={tier}>
          <span className="tier-label">Tier {tier}</span>
          <div className="tier-teams">
            {byTier[tier].map((t) => (
              <span className={clsx('tier-team', elim.has(t.id) && 'out')} key={t.id} title={t.name}><Flag code={t.code} name={t.name} />{t.abbr}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface FeedMatch { a: Team; b: Team; ga: number | null; gb: number | null; ga90: number | null; gb90: number | null; played: boolean; kickoff: string | null }
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
      ga90: played ? m.home_g90 ?? m.home_goals : null, gb90: played ? m.away_g90 ?? m.away_goals : null,
      played, kickoff: m.kickoff, sort: m.kickoff || m.id,
    })
  }
  // chronological by kickoff within each group (falls back to match id)
  for (const g of Object.keys(byGroup)) byGroup[g].sort((x, y) => x.sort.localeCompare(y.sort))
  return Object.keys(byGroup).sort().map((g) => ({ group: g, matches: byGroup[g] }))
}

// Round of each match: within a group, the first two fixtures (by kickoff) are round 1,
// next two round 2, last two round 3 — i.e. each team's Nth game. Knockout games → 'ko'.
function roundOfMatches(view: LeagueView): Record<string, number | 'ko'> {
  const r: Record<string, number | 'ko'> = {}
  const byGroup: Record<string, Match[]> = {}
  for (const m of view.matches) {
    if (m.stage === 'group' && m.grp) (byGroup[m.grp] ||= []).push(m)
    else r[m.id] = 'ko'
  }
  for (const g of Object.keys(byGroup)) {
    byGroup[g].sort((a, b) => (a.kickoff || a.id).localeCompare(b.kickoff || b.id))
    byGroup[g].forEach((m, i) => { r[m.id] = Math.floor(i / 2) + 1 })
  }
  return r
}

// Recompute the leaderboard from ONLY one round's matches (isolated). Mirrors the API's
// matchScore/tier logic; movement deltas don't apply to a filtered view (delta: null).
function recomputeRound(view: LeagueView, round: 1 | 2 | 3 | 'ko', roundMap: Record<string, number | 'ko'>): LeagueView['leaderboard'] {
  const n = view.league.nManagers
  const tierByTeam: Record<string, number> = {}
  for (const p of view.picks) tierByTeam[p.teamId] = tierOf(Math.floor(p.overall / n))
  const teamTotal: Record<string, number> = {}
  for (const m of view.matches) {
    if (roundMap[m.id] !== round || m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    // mirror the league scoring options (services/scoring.ts): Final ×2, third-place off → 0.
    const mult = m.stage === 'Final' ? (view.league.finalDouble ? 2 : 1) : m.stage === '3P' ? (view.league.thirdPlaceScores ? 1 : 0) : 1
    if (mult === 0) continue
    const hT = m.home_team_id ? tierByTeam[m.home_team_id] ?? null : null
    const aT = m.away_team_id ? tierByTeam[m.away_team_id] ?? null : null
    const hG90 = m.home_g90 ?? m.home_goals, aG90 = m.away_g90 ?? m.away_goals
    if (m.home_team_id) teamTotal[m.home_team_id] = (teamTotal[m.home_team_id] || 0) + matchScore(m.home_goals, m.away_goals, hT, aT, hG90).total * mult
    if (m.away_team_id) teamTotal[m.away_team_id] = (teamTotal[m.away_team_id] || 0) + matchScore(m.away_goals, m.home_goals, aT, hT, aG90).total * mult
  }
  const squads: Record<string, string[]> = {}
  for (const p of [...view.picks].sort((a, b) => a.overall - b.overall)) (squads[p.managerId] ||= []).push(p.teamId)
  return view.managers.map((mgr) => {
    const squad = (squads[mgr.id] || []).map((teamId) => ({
      teamId,
      points: { teamId, total: teamTotal[teamId] || 0, tier: tierByTeam[teamId] ?? null, result: 0, goals: 0, bonus: 0, stage: 'Group' },
    }))
    const total = squad.reduce((s, x) => s + x.points.total, 0)
    return { managerId: mgr.id, name: mgr.name, color: mgr.color, seat: mgr.seat, total, advanced: 0, deepestStage: 'Group', delta: null, squad }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

function StandingsLeaderboard({ view, highlight }: { view: LeagueView; highlight?: string }) {
  const teamById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  const elim = useElim()
  const [byPpg, setByPpg] = useState(false)
  const [round, setRound] = useState<'all' | 1 | 2 | 3 | 'ko'>('all')
  // round filter: 'all' = everything; otherwise isolate just that round's matches
  const roundMap = useMemo(() => roundOfMatches(view), [view.matches])
  const filteredMatches = useMemo(
    () => (round === 'all' ? view.matches : view.matches.filter((m) => roundMap[m.id] === round)),
    [view.matches, round, roundMap])
  // finished-match appearances per team within the filter (a team playing twice counts 2)
  const playedByTeam = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of filteredMatches) {
      if (m.status !== 'finished') continue
      if (m.home_team_id) c[m.home_team_id] = (c[m.home_team_id] || 0) + 1
      if (m.away_team_id) c[m.away_team_id] = (c[m.away_team_id] || 0) + 1
    }
    return c
  }, [filteredMatches])
  // 'all' uses the server leaderboard (with movement deltas); a round recomputes client-side
  const lb = useMemo(
    () => (round === 'all' ? view.leaderboard : recomputeRound(view, round, roundMap)),
    [view, round, roundMap])
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
        <div className="std-controls">
          <div className="segctl" role="group" aria-label="Standings metric" data-pos={byPpg ? 1 : 0}>
            <span className="seg-ind" aria-hidden />
            <button className={clsx('seg', !byPpg && 'on')} aria-pressed={!byPpg} onClick={() => setByPpg(false)}>Totals</button>
            <button className={clsx('seg', byPpg && 'on')} aria-pressed={byPpg} onClick={() => setByPpg(true)}>PPG</button>
          </div>
          <div className="segctl rounds" role="group" aria-label="Round">
            {(['all', 1, 2, 3, 'ko'] as const).map((r) => (
              <button key={r} className={clsx('seg', round === r && 'on')} aria-pressed={round === r} onClick={() => setRound(r)}>
                {r === 'all' ? 'All' : r === 'ko' ? 'KO' : r}
              </button>
            ))}
          </div>
        </div>
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
              <span className="lb-place">
                <b className="lb-rank">{i + 1}</b>
                {/* movement vs the previous matchday; tied to the total-points order, so hidden in PPG view */}
                {!byPpg && row.delta != null && (
                  <i className={clsx('lb-move', row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'eq')} title={moveLabel(row.delta)}>
                    {row.delta === 0
                      ? '–'
                      : <><span className="lb-move-ar" aria-hidden>{row.delta > 0 ? '▲' : '▼'}</span>{Math.abs(row.delta)}</>}
                  </i>
                )}
              </span>
              <span className="lb-name">{row.name}{row.managerId === highlight ? ' · you' : ''}</span>
              <div className="lb-pts">
                <span className={clsx('lb-pts-cell', !byPpg && 'lb-pts-2nd')}><b>{ppg.toFixed(2)}</b><span className="lb-pts-lbl">PPG</span></span>
                <span className={clsx('lb-pts-cell', byPpg && 'lb-pts-2nd')}><b>{row.total}</b><span className="lb-pts-lbl">PTS</span></span>
              </div>
              <div className="lb-trk">
                <div className="lb-track">
                  <div className="lb-scoring">
                    <div className="lb-bar" style={{ width: `${barPct}%` }}>
                      {scoring.map((s) => (
                        <div className={clsx('lb-seg', `t${s.tier}`)} key={s.team.id} style={{ flexGrow: s.total }}
                          title={`${s.team.name} · ${s.total} pts · pick ${s.round}`}>
                          <span className="lb-seg-flag"><Flag code={s.team.code} name={s.team.name} faded={elim.has(s.team.id)} /></span>
                          <span className="lb-seg-block"><span className="lb-seg-n">{s.total}</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {maxHold > 0 && (
                    <div className={clsx('lb-hold', !holding.length && 'empty')}>
                      {holding.map((s) => (
                        <span className="lb-hold-fl" key={s.team.id} title={`${s.team.name} · 0 pts · pick ${s.round}`}>
                          <Flag code={s.team.code} name={s.team.name} faded={elim.has(s.team.id)} />
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
                  <StatTable
                    columns={[
                      { label: 'P', title: 'Matches played' },
                      { label: 'R', title: 'Result — win 3 / draw 1 / loss 0' },
                      { label: 'G', title: 'Goals — 1 per goal scored' },
                      { label: 'B', title: 'Bonus — upset bonus' },
                    ]}
                    totalLabel="Pts"
                    rows={ranked.map((s) => ({
                      id: s.team.id, code: s.team.code, name: s.team.name, accent: `t${s.tier}` as 't1' | 't2' | 't3',
                      cells: [playedByTeam[s.team.id] || 0, s.points.result, s.points.goals, s.points.bonus],
                      total: s.total, faded: elim.has(s.team.id),
                    }))}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ResultRow({ team, gf, ga, gf90, owner, oppTier, win, played = true }: {
  team: Team; gf: number; ga: number; gf90?: number; owner?: { name: string; tier: number }; oppTier: number | null; win: boolean; played?: boolean
}) {
  const o = owner || { name: '—', tier: 1 }
  const isOut = useElim().has(team.id)
  // Not played yet: same row format (flag, tier border, owner) minus score + R/G/B + total.
  if (!played) {
    return (
      <div className="rr">
        <div className={clsx('rr-box', `t${o.tier}`)}>
          <Flag code={team.code} name={team.name} faded={isOut} />
          <span className="rr-abbr">{team.abbr}</span>
        </div>
        <span className="rr-owner">{o.name}</span>
      </div>
    )
  }
  const s = matchScore(gf, ga, owner?.tier ?? null, oppTier, gf90 ?? gf)
  return (
    <div className={clsx('rr', win && 'win')}>
      <div className={clsx('rr-box', `t${o.tier}`)}>
        <Flag code={team.code} name={team.name} faded={isOut} />
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
function MatchCard({ m, owners, showTime }: { m: FeedMatch; owners: Owners; showTime?: boolean }) {
  if (!m.played) {
    // day-strip cards show the kickoff time for not-yet-played fixtures, set into the
    // empty space to the right of the teams (no score occupies it yet)
    return (
      <div className="gr-match pending">
        <div className="gr-rows">
          <ResultRow team={m.a} gf={0} ga={0} owner={owners[m.a.id]} oppTier={null} win={false} played={false} />
          <ResultRow team={m.b} gf={0} ga={0} owner={owners[m.b.id]} oppTier={null} win={false} played={false} />
        </div>
        {showTime && m.kickoff && <div className="gr-time">{fmtTime(m.kickoff)}</div>}
      </div>
    )
  }
  const aTier = owners[m.a.id]?.tier ?? null
  const bTier = owners[m.b.id]?.tier ?? null
  return (
    <div className="gr-match">
      <ResultRow team={m.a} gf={m.ga!} ga={m.gb!} gf90={m.ga90 ?? undefined} owner={owners[m.a.id]} oppTier={bTier} win={m.ga! > m.gb!} />
      <ResultRow team={m.b} gf={m.gb!} ga={m.ga!} gf90={m.gb90 ?? undefined} owner={owners[m.b.id]} oppTier={aTier} win={m.gb! > m.ga!} />
    </div>
  )
}

// Draft-scoring group table — ranks the group's teams by fantasy points (R/G/B per
// match, summed) instead of real-life W/D/L. Same shared <StatTable>; only the rows
// and columns differ from the real-life GroupTable.
function DraftGroupTable({ gms, tmap, owners }: { gms: Match[]; tmap: Record<string, Team>; owners: Owners }) {
  const elim = useElim()
  type Row = { team: Team; p: number; r: number; g: number; b: number; total: number }
  const acc = new Map<string, Row>()
  const ensure = (id: string) => {
    let row = acc.get(id)
    if (!row) { row = { team: tmap[id], p: 0, r: 0, g: 0, b: 0, total: 0 }; acc.set(id, row) }
    return row
  }
  for (const m of gms) {
    const hId = m.home_team_id, aId = m.away_team_id
    if (!hId || !aId || !tmap[hId] || !tmap[aId]) continue
    ensure(hId); ensure(aId) // include every team in the group, even before it plays
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) continue
    const hTier = owners[hId]?.tier ?? null, aTier = owners[aId]?.tier ?? null
    const hs = matchScore(m.home_goals, m.away_goals, hTier, aTier)
    const as = matchScore(m.away_goals, m.home_goals, aTier, hTier)
    const h = ensure(hId); h.p++; h.r += hs.result; h.g += hs.goals; h.b += hs.bonus; h.total += hs.total
    const a = ensure(aId); a.p++; a.r += as.result; a.g += as.goals; a.b += as.bonus; a.total += as.total
  }
  const rows = [...acc.values()].sort((x, y) => y.total - x.total || x.team.name.localeCompare(y.team.name))
  return (
    <StatTable
      teamWidth="40%"
      columns={[
        { label: 'P', title: 'Matches played' },
        { label: 'R', title: 'Result — win 3 / draw 1 / loss 0' },
        { label: 'G', title: 'Goals — 1 per goal scored' },
        { label: 'B', title: 'Bonus — upset bonus' },
      ]}
      totalLabel="Pts"
      rows={rows.map((r) => {
        const o = owners[r.team.id]
        return {
          id: r.team.id, code: r.team.code, name: r.team.name,
          accent: o ? (`t${o.tier}` as 't1' | 't2' | 't3') : null,
          cells: [r.p, r.r, r.g, r.b], total: r.total,
          meta: o ? <OwnerChip o={o} /> : undefined,
          faded: elim.has(r.team.id),
        }
      })}
    />
  )
}

// Groups tab — each real WC group as a card: the live group table (with each team's
// drafter overlaid) followed by that group's match feed with fantasy scoring. Merges
// what used to be a standalone "Results" feed into the group it belongs to. A toggle
// swaps the table between real-life W/D/L standings and draft (fantasy) scoring.
function GroupsBoard({ view, owners }: { view: LeagueView; owners: Owners }) {
  const tmap = useMemo(() => teamMap(view.teams), [view.teams])
  const elim = useElim()
  // raw group matches keyed by group letter — the standings table is computed from these
  const rawByGroup = useMemo(() => {
    const m: Record<string, Match[]> = {}
    for (const mt of view.matches) {
      if (mt.stage === 'group' && mt.grp) (m[mt.grp] ||= []).push(mt)
    }
    return m
  }, [view.matches])
  const groups = useMemo(() => groupResultsFeed(view), [view])
  // the per-group match feed is collapsed by default — the table is the headline,
  // the breakdown is on-demand (multiple groups may be open at once)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (g: string) => setOpen((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  // table mode: real-life W/D/L standings vs draft (fantasy) scoring
  const [byDraft, setByDraft] = useState(false)
  if (!groups.length) return <p className="empty">No fixtures yet — groups appear once the schedule is seeded.</p>
  return (
    <>
      <div className="sec-head">
        <h2>Groups</h2>
        <div className="segctl" role="group" aria-label="Standings scoring" data-pos={byDraft ? 1 : 0}>
          <span className="seg-ind" aria-hidden />
          <button className={clsx('seg', !byDraft && 'on')} aria-pressed={!byDraft} onClick={() => setByDraft(false)}>Real</button>
          <button className={clsx('seg', byDraft && 'on')} aria-pressed={byDraft} onClick={() => setByDraft(true)}>Fantasy</button>
        </div>
      </div>
      <div className="grp-board">
        {groups.map((gr) => {
          const isOpen = open.has(gr.group)
          const played = gr.matches.filter((m) => m.played).length
          const gms = rawByGroup[gr.group] ?? []
          return (
            <div className="grp-card" key={gr.group}>
              <div className="gr-h">Group <b>{gr.group}</b></div>
              <div className="grp-tbl" key={byDraft ? 'fantasy' : 'real'}>
                {byDraft
                  ? <DraftGroupTable gms={gms} tmap={tmap} owners={owners} />
                  : <GroupTable gms={gms} tmap={tmap} owners={owners} teamWidth="40%" out={elim} />}
              </div>
              <button className={clsx('grp-results-h', isOpen && 'open')} aria-expanded={isOpen} onClick={() => toggle(gr.group)}>
                <svg className="grp-chev" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                <span>Results</span>
                <span className="grp-results-meta">{played}/{gr.matches.length}</span>
              </button>
              {isOpen && (
                <div className="gr-matches">
                  {gr.matches.map((m, i) => <MatchCard key={i} m={m} owners={owners} />)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

const TABS = [
  { id: 'league', label: 'League' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'groups', label: 'Groups' },
] as const
type TabId = (typeof TABS)[number]['id']

// Line icons for the mobile tab bar: trophy (League), table-grid (Groups),
// calendar (Fixtures). Inherit the tab's text colour via currentColor.
function TabIcon({ id }: { id: TabId }) {
  const p = { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (id === 'league') return (
    <svg {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5v1a3 3 0 0 0 3 3" />
      <path d="M16 6h3v1a3 3 0 0 1-3 3" /><path d="M12 13v3M9.5 20h5M10.5 16h3" /></svg>
  )
  if (id === 'groups') return (
    <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></svg>
  )
  return (
    <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  )
}

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
    ;(byKey[key] ||= []).push({ a, b, ga: played ? m.home_goals : null, gb: played ? m.away_goals : null, ga90: played ? m.home_g90 ?? m.home_goals : null, gb90: played ? m.away_g90 ?? m.away_goals : null, played, kickoff: m.kickoff })
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
        {day.matches.map((m, k) => <MatchCard key={k} m={m} owners={owners} showTime />)}
      </div>
    </section>
  )
}

export function OverviewView({ view, highlight }: { view: LeagueView; highlight?: string }) {
  const owners = useMemo(() => buildOwners(view), [view])
  const days = useMemo(() => buildCarouselDays(view), [view])
  const elim = useMemo(() => eliminatedTeams(view), [view])
  return (
    <ElimCtx.Provider value={elim}>
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
    </ElimCtx.Provider>
  )
}

export function ResultsView({ view, homeHref, highlight }: { view: LeagueView; homeHref?: ReactNode; highlight?: string }) {
  const owners = useMemo(() => buildOwners(view), [view])
  const days = useMemo(() => buildCarouselDays(view), [view])
  const [tab, setTab] = useState<TabId>('league')
  const elim = useMemo(() => eliminatedTeams(view), [view])

  // Tabs are mobile-only (CSS-gated): on desktop every panel is shown stacked, on
  // mobile the tab bar appears and `data-tab` toggles which panel is visible.
  return (
    <ElimCtx.Provider value={elim}>
    <div className="results" data-tab={tab}>
      <div className="hero">
        <Link to="/l/$leagueId/overview" params={{ leagueId: view.league.id }} className="hero-globe" title="Open overview">🌍</Link>
        <div className="hero-txt">
          <div className="hero-kick">Competition standings</div>
          <h1 className="hero-h1">{view.league.name}</h1>
          <div className="hero-links">
            <Link to="/l/$leagueId/trends" params={{ leagueId: view.league.id }} className="hero-link">📈 Form guide — points per round</Link>
            <Link to="/l/$leagueId/countries" params={{ leagueId: view.league.id }} className="hero-link">🌐 Country rankings — points by nation</Link>
          </div>
        </div>
        {homeHref}
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={clsx('tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>
            <TabIcon id={t.id} />{t.label}
          </button>
        ))}
      </nav>

      <div className="tab-panel" data-panel="fixtures">
        <div className="sec-head"><h2>Fixtures</h2></div>
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

      <div className="tab-panel" data-panel="groups">
        <div className="sec-head"><h2>Knockout bracket</h2></div>
        <Bracket matches={view.matches} teams={view.teams} tierOf={(id) => owners[id]?.tier} ownerOf={(id) => owners[id]?.name}
          finalDouble={view.league.finalDouble} thirdPlaceScores={view.league.thirdPlaceScores} />
        <GroupsBoard view={view} owners={owners} />
      </div>
    </div>
    </ElimCtx.Provider>
  )
}
