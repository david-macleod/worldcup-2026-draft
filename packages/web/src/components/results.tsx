// Results / standings — TSX port of the original comp.jsx (leaderboard bars,
// group results breakdown, group tables, knockout bracket), computed from the
// real league view (matches/teams/picks) instead of the old simulator.
import { useMemo, type ReactNode } from 'react'
import type { LeagueView, Team, Match } from '../lib/api'
import { Flag } from './ui'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')
const STAGE_LABEL: Record<string, string> = {
  R32: 'Last 32', R16: 'Last 16', QF: 'Quarter-final', SF: 'Semi-final', Final: 'Final',
}
const tierOf = (idx: number) => Math.min(3, Math.floor(idx / 2) + 1)

// Per-match fantasy breakdown — identical to the API scoring stub.
function scoreBreakdown(gf: number, ga: number) {
  const result = gf > ga ? 5 : gf === ga ? 2 : 0
  const goals = gf
  const bonus = (ga === 0 ? 2 : 0) + (gf >= 3 ? 1 : 0)
  return { result, goals, bonus, total: result + goals + bonus }
}

interface Row { id: string; team: Team; pos: number; P: number; W: number; D: number; L: number; GF: number; GA: number; Pts: number }
interface GroupData { group: string; table: Row[]; matches: Array<{ a: Team; b: Team; ga: number; gb: number }> }

function computeGroups(teams: Team[], matches: Match[]): { groups: GroupData[]; qualified: Set<string> } {
  const byGroup: Record<string, Team[]> = {}
  for (const t of teams) (byGroup[t.grp] ||= []).push(t)
  const groups: GroupData[] = []
  const thirds: Row[] = []
  const qualified = new Set<string>()

  for (const g of Object.keys(byGroup).sort()) {
    const gt = byGroup[g]
    const gms = matches.filter((m) => m.stage === 'group' && m.grp === g)
    const finished = gms.filter((m) => m.status === 'finished' && m.home_goals != null && m.away_goals != null)
    const rows: Record<string, Row> = {}
    for (const t of gt) rows[t.id] = { id: t.id, team: t, pos: 0, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 }
    for (const m of finished) {
      const ra = rows[m.home_team_id!], rb = rows[m.away_team_id!]
      if (!ra || !rb) continue
      const hg = m.home_goals!, ag = m.away_goals!
      ra.P++; rb.P++; ra.GF += hg; ra.GA += ag; rb.GF += ag; rb.GA += hg
      if (hg > ag) { ra.W++; rb.L++; ra.Pts += 3 } else if (hg < ag) { rb.W++; ra.L++; rb.Pts += 3 } else { ra.D++; rb.D++; ra.Pts++; rb.Pts++ }
    }
    const table = Object.values(rows).sort((x, y) =>
      y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.team.rank - y.team.rank)
    table.forEach((r, i) => (r.pos = i + 1))
    const allFinished = gms.length > 0 && gms.every((m) => m.status === 'finished')
    if (allFinished) { qualified.add(table[0].id); qualified.add(table[1].id); if (table[2]) thirds.push(table[2]) }
    const matchList = finished.map((m) => ({
      a: rows[m.home_team_id!]?.team, b: rows[m.away_team_id!]?.team, ga: m.home_goals!, gb: m.away_goals!,
    })).filter((x) => x.a && x.b)
    groups.push({ group: g, table, matches: matchList })
  }
  thirds.sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.team.rank - y.team.rank)
  thirds.slice(0, 8).forEach((r) => qualified.add(r.id))
  return { groups, qualified }
}

interface Tie { a: Team; b: Team; ga: number | null; gb: number | null; pens: [number, number] | null; winner: string | null }
function computeBracket(teams: Team[], matches: Match[]): { rounds: Array<{ stage: string; ties: Tie[] }>; champion: Team | null } {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]))
  const winnerOf = (m: Match): string | null => {
    if (m.status !== 'finished' || m.home_goals == null || m.away_goals == null) return null
    if (m.home_goals > m.away_goals) return m.home_team_id
    if (m.away_goals > m.home_goals) return m.away_team_id
    if (m.home_pens != null && m.away_pens != null) return m.home_pens > m.away_pens ? m.home_team_id : m.away_team_id
    return null
  }
  const rounds: Array<{ stage: string; ties: Tie[] }> = []
  for (const stage of ['R32', 'R16', 'QF', 'SF', 'Final']) {
    const ms = matches.filter((m) => m.stage === stage && m.home_team_id && m.away_team_id)
    if (!ms.length) continue
    const ties: Tie[] = ms.map((m) => ({
      a: byId[m.home_team_id!], b: byId[m.away_team_id!], ga: m.home_goals, gb: m.away_goals,
      pens: m.home_pens != null && m.away_pens != null ? [m.home_pens, m.away_pens] : null,
      winner: winnerOf(m),
    }))
    rounds.push({ stage, ties })
  }
  const finalM = matches.find((m) => m.stage === 'Final' && m.home_team_id && m.away_team_id)
  const champ = finalM ? winnerOf(finalM) : null
  return { rounds, champion: champ ? byId[champ] : null }
}

// teamId -> { managerName, color, tier } from the draft
function buildOwners(view: LeagueView) {
  const mgr = Object.fromEntries(view.managers.map((m) => [m.id, m]))
  const n = view.league.nManagers
  const owners: Record<string, { name: string; color: string; tier: number }> = {}
  for (const p of view.picks) {
    const round = Math.floor(p.overall / n)
    const m = mgr[p.managerId]
    if (m) owners[p.teamId] = { name: m.name, color: m.color, tier: tierOf(round) }
  }
  return owners
}

function StandingsLeaderboard({ view }: { view: LeagueView }) {
  const teamById = useMemo(() => Object.fromEntries(view.teams.map((t) => [t.id, t])), [view.teams])
  const lb = view.leaderboard
  const top = lb[0]?.total || 1
  const allZero = lb.every((r) => r.total === 0)
  return (
    <>
      <div className="lb-legend">
        <span className="lg t1">Picks 1–2</span><span className="lg t2">Picks 3–4</span>
        <span className="lg t3">Picks 5–6</span><span className="lg held">Yet to score</span>
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

function ResultRow({ team, gf, ga, owner, win }: {
  team: Team; gf: number; ga: number; owner?: { name: string; tier: number }; win: boolean
}) {
  const s = scoreBreakdown(gf, ga)
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
            <span><i>Bonus</i><b>{s.bonus}</b></span>
            <span className="tot"><i>Total</i><b>+{s.total}</b></span>
          </span>
        </span>
      </span>
    </div>
  )
}

function GroupResultsFeed({ groups, owners }: {
  groups: GroupData[]; owners: Record<string, { name: string; color: string; tier: number }>
}) {
  const withResults = groups.filter((g) => g.matches.length > 0)
  if (!withResults.length) return <p className="empty">No group results entered yet.</p>
  return (
    <div className="gr-groups">
      {withResults.map((gr) => (
        <div className="gr-grp" key={gr.group}>
          <div className="gr-h">Group <b>{gr.group}</b></div>
          <div className="gr-matches">
            {gr.matches.map((m, i) => (
              <div className="gr-match" key={i}>
                <ResultRow team={m.a} gf={m.ga} ga={m.gb} owner={owners[m.a.id]} win={m.ga > m.gb} />
                <ResultRow team={m.b} gf={m.gb} ga={m.ga} owner={owners[m.b.id]} win={m.gb > m.ga} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function GroupTables({ groups, qualified }: { groups: GroupData[]; qualified: Set<string> }) {
  const played = groups.filter((g) => g.table.some((r) => r.P > 0))
  if (!played.length) return <p className="empty">Group tables appear once results are in.</p>
  return (
    <>
      <div className="groups">
        {played.map((gr) => (
          <div className="grp" key={gr.group}>
            <div className="grp-head">Group {gr.group}</div>
            <table className="grp-table">
              <thead><tr><th></th><th className="tl">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
              <tbody>
                {gr.table.map((r) => {
                  const q = qualified.has(r.id)
                  const gd = r.GF - r.GA
                  return (
                    <tr key={r.id} className={clsx(q && 'q', r.pos === 3 && q && 'q3')}>
                      <td className="pos">{r.pos}</td>
                      <td className="tl"><Flag code={r.team.code} name={r.team.name} /><span className="gt-name">{r.team.name}</span></td>
                      <td>{r.P}</td><td>{r.W}</td><td>{r.D}</td><td>{r.L}</td>
                      <td>{gd > 0 ? '+' + gd : gd}</td><td className="pts">{r.Pts}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="lg-q" /> Through to the knockouts</span>
        <span><i className="lg-q3" /> Qualified as a best third</span>
      </div>
    </>
  )
}

function KnockoutBracket({ rounds, champion }: { rounds: Array<{ stage: string; ties: Tie[] }>; champion: Team | null }) {
  if (!rounds.length) return null
  return (
    <section>
      <div className="sec-head"><h2>Knockout bracket</h2><span className="sec-sub">single elimination</span></div>
      <div className="ko-scroll">
        <div className="ko-rounds">
          {rounds.map((rd) => (
            <div className="ko-col" key={rd.stage}>
              <div className="ko-stage">{STAGE_LABEL[rd.stage] || rd.stage}</div>
              {rd.ties.map((t, i) => (
                <div className="ko-tie" key={i}>
                  <KoSide team={t.a} win={t.winner === t.a.id} score={t.ga} pen={t.pens ? t.pens[0] : null} />
                  <KoSide team={t.b} win={t.winner === t.b.id} score={t.gb} pen={t.pens ? t.pens[1] : null} />
                </div>
              ))}
            </div>
          ))}
          {champion && (
            <div className="ko-col">
              <div className="ko-stage">Winner</div>
              <div className="ko-champ">
                <span className="ko-trophy">🏆</span>
                <Flag code={champion.code} name={champion.name} className="champ" />
                <span className="ko-champ-name">{champion.name}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
function KoSide({ team, win, score, pen }: { team: Team; win: boolean; score: number | null; pen: number | null }) {
  return (
    <div className={clsx('ko-side', win && 'win')}>
      <Flag code={team.code} name={team.name} />
      <span className="ko-abbr">{team.abbr}</span>
      <span className="ko-score">{score ?? '–'}{pen != null ? <em> ({pen})</em> : null}</span>
    </div>
  )
}

export function ResultsView({ view, homeHref }: { view: LeagueView; homeHref?: ReactNode }) {
  const { groups, qualified } = useMemo(() => computeGroups(view.teams, view.matches), [view.teams, view.matches])
  const bracket = useMemo(() => computeBracket(view.teams, view.matches), [view.teams, view.matches])
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

      <div className="sec-head"><h2>Group tables</h2><span className="sec-sub">top 2 + 8 best thirds advance</span></div>
      <GroupTables groups={groups} qualified={qualified} />

      <div className="sec-head"><h2>Group stage results</h2><span className="sec-sub">every match · <b>R</b> result · <b>G</b> goals · <b>B</b> bonus · total</span></div>
      <GroupResultsFeed groups={groups} owners={owners} />

      <KnockoutBracket rounds={bracket.rounds} champion={bracket.champion} />

      <div className="foot">
        Points = per-match fantasy (result + goals + clean sheet / 3-goal bonus) plus stage-progression bonuses.
        Standings update live as the commissioner enters real scorelines.
      </div>
    </div>
  )
}
