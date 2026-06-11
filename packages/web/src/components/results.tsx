// Results / standings — TSX port of the original comp.jsx, computed from the real
// league view (matches/teams/picks). Shows the leaderboard + the group-stage
// results feed (per-match tier-based scoring breakdown). Group tables and the
// knockout bracket are intentionally not shown.
import { useMemo, type ReactNode } from 'react'
import type { LeagueView, Team } from '../lib/api'
import { Flag } from './ui'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')
const tierOf = (idx: number) => Math.min(3, Math.floor(idx / 2) + 1)

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
function buildOwners(view: LeagueView) {
  const mgr = Object.fromEntries(view.managers.map((m) => [m.id, m]))
  const n = view.league.nManagers
  const owners: Record<string, { name: string; color: string; tier: number }> = {}
  for (const p of view.picks) {
    const m = mgr[p.managerId]
    if (m) owners[p.teamId] = { name: m.name, color: m.color, tier: tierOf(Math.floor(p.overall / n)) }
  }
  return owners
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtKickoff(iso: string | null): string {
  if (!iso) return 'TBC'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'TBC'
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
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

function StandingsLeaderboard({ view }: { view: LeagueView }) {
  const teamById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  const lb = view.leaderboard
  const top = lb[0]?.total || 1
  const allZero = lb.every((r) => r.total === 0)
  return (
    <>
      <div className="lb-legend">
        <span className="lg t1">Tier 1 · Picks 1–2</span><span className="lg t2">Tier 2 · Picks 3–4</span>
        <span className="lg t3">Tier 3 · Picks 5–6</span><span className="lg held">Yet to score</span>
      </div>
      {allZero && <p className="empty">No results entered yet — the table fills in as the commissioner enters scorelines.</p>}
      <div className="lb-grid">
        {lb.map((row, i) => {
          const segs = row.squad.map((x, idx) => ({ team: teamById[x.teamId], total: x.points.total, tier: tierOf(idx), round: idx + 1 }))
            .filter((s) => s.team)
          const scoring = segs.filter((s) => s.total > 0)
          const holding = segs.filter((s) => s.total <= 0)
          const barPct = (row.total / top) * 100
          return (
            <div className={clsx('lb-row', i === 0 && 'leader')} key={row.managerId} style={{ ['--clk' as string]: row.color }}>
              <span className="lb-place">{i + 1}</span>
              <span className="lb-name">{row.name}</span>
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
            </div>
          )
        })}
      </div>
    </>
  )
}

function ResultRow({ team, gf, ga, owner, oppTier, win }: {
  team: Team; gf: number; ga: number; owner?: { name: string; tier: number }; oppTier: number | null; win: boolean
}) {
  const s = matchScore(gf, ga, owner?.tier ?? null, oppTier)
  const o = owner || { name: '—', tier: 1 }
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

function GroupResultsFeed({ groups, owners }: {
  groups: Array<{ group: string; matches: FeedMatch[] }>
  owners: Record<string, { name: string; color: string; tier: number }>
}) {
  if (!groups.length) return <p className="empty">No results entered yet — they'll appear here as games are played.</p>
  return (
    <div className="gr-groups">
      {groups.map((gr) => (
        <div className="gr-grp" key={gr.group}>
          <div className="gr-h">Group <b>{gr.group}</b></div>
          <div className="gr-matches">
            {gr.matches.map((m, i) => {
              if (!m.played) {
                return (
                  <div className="gr-match pending" key={i}>
                    <div className="pm">
                      <span className="pm-team"><Flag code={m.a.code} name={m.a.name} /><b>{m.a.abbr}</b></span>
                      <span className="pm-v">{fmtKickoff(m.kickoff)}</span>
                      <span className="pm-team end"><b>{m.b.abbr}</b><Flag code={m.b.code} name={m.b.name} /></span>
                    </div>
                  </div>
                )
              }
              const aTier = owners[m.a.id]?.tier ?? null
              const bTier = owners[m.b.id]?.tier ?? null
              return (
                <div className="gr-match" key={i}>
                  <ResultRow team={m.a} gf={m.ga!} ga={m.gb!} owner={owners[m.a.id]} oppTier={bTier} win={m.ga! > m.gb!} />
                  <ResultRow team={m.b} gf={m.gb!} ga={m.ga!} owner={owners[m.b.id]} oppTier={aTier} win={m.gb! > m.ga!} />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ResultsView({ view, homeHref }: { view: LeagueView; homeHref?: ReactNode }) {
  const groups = useMemo(() => groupResultsFeed(view), [view])
  const owners = useMemo(() => buildOwners(view), [view])
  const finished = view.matches.filter((m) => m.status === 'finished').length
  const MODE: Record<string, string> = { sequential: 'Live snake draft', autodraft: 'Autodraft', imported: 'Imported draft' }

  return (
    <div className="results">
      <div className="hero">
        <span className="hero-globe">🌍</span>
        <div className="hero-txt">
          <div className="hero-kick">Competition standings</div>
          <h1 className="hero-h1">{view.league.name}</h1>
          <div className="hero-sub">{MODE[view.league.mode]} · {view.league.nManagers} managers · {finished} results in</div>
        </div>
        {finished > 0 && <span className="hero-live">LIVE</span>}
        {homeHref}
      </div>

      <section><StandingsLeaderboard view={view} /></section>

      <div className="sec-head"><h2>Match results</h2><span className="sec-sub"><b>R</b> result · <b>G</b> goals · <b>B</b> upset bonus · total</span></div>
      <GroupResultsFeed groups={groups} owners={owners} />

      <div className="foot">
        Points = win 3 / draw 1 / loss 0, +1 per goal. Upset bonus when a lower-tier team avoids
        defeat against a higher tier: +1/+2 (one/two tiers above) plus +1/+2 per goal. Tiers come
        from the draft round (picks 1–2 / 3–4 / 5–6). Standings update live as real scorelines are entered.
      </div>
    </div>
  )
}
