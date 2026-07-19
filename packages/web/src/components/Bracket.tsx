// Classic symmetric knockout bracket: the left half (everything feeding semi-final 1)
// flows rightward, the right half (feeding semi-final 2) is mirrored and flows leftward,
// and they meet at the Final in the centre. Matchups arrive pre-filled from the API
// (derived from group standings + earlier winners); an unfilled slot shows TBD, so only
// teams still alive ever appear.
import type { Match, Team } from '../lib/api'
import { Flag } from './ui'

const clsx = (...a: unknown[]) => a.filter(Boolean).join(' ')

// Each column top-to-bottom in bracket-tree order so a round lines up with the round it
// feeds. Left half = SF-1 subtree, right half = SF-2 subtree.
const LEFT: Array<{ label: string; ids: string[] }> = [
  { label: 'Last 32', ids: ['R32-2', 'R32-5', 'R32-1', 'R32-3', 'R32-11', 'R32-12', 'R32-9', 'R32-10'] },
  { label: 'Last 16', ids: ['R16-1', 'R16-2', 'R16-5', 'R16-6'] },
  { label: 'Quarter-finals', ids: ['QF-1', 'QF-2'] },
  { label: 'Semi-finals', ids: ['SF-1'] },
]
const RIGHT: Array<{ label: string; ids: string[] }> = [
  { label: 'Semi-finals', ids: ['SF-2'] },
  { label: 'Quarter-finals', ids: ['QF-3', 'QF-4'] },
  { label: 'Last 16', ids: ['R16-3', 'R16-4', 'R16-7', 'R16-8'] },
  { label: 'Last 32', ids: ['R32-4', 'R32-6', 'R32-7', 'R32-8', 'R32-14', 'R32-16', 'R32-13', 'R32-15'] },
]
const FINAL_ID = 'Final-1'

function winnerId(m?: Match): string | null {
  if (!m || m.status !== 'finished' || m.home_goals == null || m.away_goals == null) return null
  if (m.home_goals > m.away_goals) return m.home_team_id
  if (m.away_goals > m.home_goals) return m.away_team_id
  if (m.home_pens != null && m.away_pens != null) return m.home_pens > m.away_pens ? m.home_team_id : m.away_team_id
  return null
}

// Points a team earned in one match — mirrors services/scoring.ts matchScore (result from
// the final score, goals + per-goal bonus from 90' only).
function matchPoints(gf: number, ga: number, goals90: number, tier?: number, oppTier?: number): number {
  const result = gf > ga ? 3 : gf === ga ? 1 : 0
  let bonus = 0
  if (gf >= ga && tier != null && oppTier != null && oppTier < tier) bonus = (tier - oppTier) * (1 + goals90)
  return result + goals90 + bonus
}

const THIRD_ID = '3P-1'

export function Bracket({ matches, teams, tierOf, ownerOf, finalDouble, thirdPlaceScores }: {
  matches: Match[]; teams: Team[]
  tierOf?: (id: string) => number | undefined; ownerOf?: (id: string) => string | undefined
  finalDouble?: boolean; thirdPlaceScores?: boolean
}) {
  const T = Object.fromEntries(teams.map((t) => [t.id, t]))
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]))
  const live = [...LEFT, ...RIGHT].some((c) => c.ids.some((id) => byId[id]?.home_team_id || byId[id]?.away_team_id))
  if (!live) return null

  // Same formatting as the fixtures result rows (tier-bordered box: flag · abbr · score,
  // with the manager name beside it) — just without the R/G/B stats, to save space.
  const TeamLine = ({ teamId, gf, win, total }: { teamId: string | null; gf: number | null; win: boolean | null; total: number | null }) => {
    const t = teamId ? T[teamId] : null
    const tier = teamId && tierOf ? tierOf(teamId) : undefined
    const mgr = teamId && ownerOf ? ownerOf(teamId) : undefined
    return (
      <div className={clsx('bk-rr', win === true && 'win', win === false && 'lose')}>
        <div className={clsx('bk-box', tier && `t${tier}`)}>
          {t ? <Flag code={t.code} name={t.name} /> : <span className="bk-dot" />}
          <span className="bk-abbr">{t ? t.abbr : 'TBD'}</span>
          <span className="bk-score">{gf ?? ''}</span>
        </div>
        {mgr && <span className="bk-mgr">{mgr}</span>}
        {total != null && <span className={clsx('bk-total', total === 0 && 'zero')}>+{total}</span>}
      </div>
    )
  }

  const BMatch = ({ id }: { id: string }) => {
    const m = byId[id]
    const fin = m?.status === 'finished' && m?.home_goals != null && m?.away_goals != null
    const w = winnerId(m)
    const aet = !!m && m.home_g90 != null && (m.home_goals !== m.home_g90 || m.away_goals !== m.away_g90)
    const pens = !!m && m.home_pens != null && m.away_pens != null
    // Points multiplier mirrors the league options (services/scoring.ts): the Final can
    // count double, the third-place playoff can be off (0 → no points shown at all).
    const mult = id === FINAL_ID ? (finalDouble ? 2 : 1) : id === THIRD_ID ? (thirdPlaceScores ? 1 : 0) : 1
    let hTotal: number | null = null, aTotal: number | null = null
    if (fin && m && mult > 0) {
      const hT = m.home_team_id ? tierOf?.(m.home_team_id) : undefined
      const aT = m.away_team_id ? tierOf?.(m.away_team_id) : undefined
      const hG90 = m.home_g90 ?? m.home_goals!, aG90 = m.away_g90 ?? m.away_goals!
      hTotal = matchPoints(m.home_goals!, m.away_goals!, hG90, hT, aT) * mult
      aTotal = matchPoints(m.away_goals!, m.home_goals!, aG90, aT, hT) * mult
    }
    return (
      <div className={clsx('bk-match', !m?.home_team_id && !m?.away_team_id && 'tbd')}>
        <TeamLine teamId={m?.home_team_id ?? null} gf={fin ? m!.home_goals : null} win={w ? w === m?.home_team_id : null} total={hTotal} />
        <TeamLine teamId={m?.away_team_id ?? null} gf={fin ? m!.away_goals : null} win={w ? w === m?.away_team_id : null} total={aTotal} />
        {(aet || pens) && (
          <div className="bk-note">{aet ? 'aet' : ''}{aet && pens ? ' · ' : ''}{pens ? `pens ${m!.home_pens}–${m!.away_pens}` : ''}</div>
        )}
      </div>
    )
  }

  // A round with no teams yet (every match still TBD) gets a narrow column so the whole
  // bracket fits without horizontal scrolling until those rounds fill in.
  const Column = ({ col, mir }: { col: { label: string; ids: string[] }; mir?: boolean }) => {
    const filled = col.ids.some((id) => byId[id]?.home_team_id || byId[id]?.away_team_id)
    return (
      <div className={clsx('bk-col', mir && 'mir', !filled && 'narrow')}>
        <div className="bk-col-h">{col.label}</div>
        <div className="bk-col-body">{col.ids.map((id) => <BMatch key={id} id={id} />)}</div>
      </div>
    )
  }

  return (
    <div className="bracket">
      {LEFT.map((col, i) => <Column key={`L${i}`} col={col} />)}
      <div className={clsx('bk-col', 'bk-col-final', !(byId[FINAL_ID]?.home_team_id || byId[FINAL_ID]?.away_team_id) && 'narrow')}>
        <div className="bk-col-h">Final{finalDouble && <span className="bk-col-tag" title="This league scores the Final double"> ×2</span>}</div>
        <div className="bk-col-body"><BMatch id={FINAL_ID} /></div>
        {byId[THIRD_ID] && (
          <div className="bk-third">
            <div className="bk-col-h">Third place{thirdPlaceScores === false && <span className="bk-col-tag" title="This league does not score the third-place playoff"> · no pts</span>}</div>
            <BMatch id={THIRD_ID} />
          </div>
        )}
      </div>
      {RIGHT.map((col, i) => <Column key={`R${i}`} col={col} mir />)}
    </div>
  )
}
