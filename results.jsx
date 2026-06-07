// Squad rosters — used both as a mid-draft panel and the final ranked results.
const { useMemo: useMemoR } = React;

// Squad score: each team worth max(1, 100 - rank); TBD worth 35. Higher = stronger.
function teamScore(t) {
  if (!t) return 0;
  if (t.tbd || !t.rank) return 35;
  return Math.max(6, 100 - t.rank);
}

// Avg FIFA rank of a squad (lower = stronger). Ignores empty slots.
function squadAvg(teams) {
  const r = teams.filter((t) => t && t.rank).map((t) => t.rank);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 999;
}

function SquadCard({ player, seed, teams, rounds, rankPlace, fill }) {
  const filled = teams.filter(Boolean);
  const avg = filled.length ? Math.round(squadAvg(teams)) : '—';
  // Best (lowest-rank) team in the squad gets the green highlight.
  const bestRank = Math.min(...filled.map((t) => t.rank || 999));
  return (
    <div className="squad" style={{ '--clk': player.color }}>
      <div className="squad-head">
        {rankPlace != null && <span className="squad-place">{rankPlace}</span>}
        <span className="squad-av" style={{ background: player.color }}>
          {(player.name || '?').trim().slice(0, 2).toUpperCase()}
        </span>
        <div className="squad-id">
          <span className="squad-name">{player.name || 'Manager'}</span>
          <span className="squad-seat">Seed #{seed}</span>
        </div>
        <div className="squad-stat">
          <b>{avg}</b><span>avg rank</span>
        </div>
      </div>
      <div className="strength-bar"><span style={{ width: `${Math.round(fill * 100)}%` }} /></div>
      <ol className="squad-list">
        {Array.from({ length: rounds }).map((_, i) => {
          const t = teams[i];
          const isBest = t && t.rank === bestRank;
          return (
            <li key={i} className={clsx('squad-row', !t && 'pending')}>
              <span className="squad-rnd">{i + 1}</span>
              {t ? (
                <>
                  <Flag team={t} size={26} />
                  <span className="squad-team">{t.name}</span>
                  <span className={clsx('squad-rankpill', isBest && 'best')}>#{t.rank}</span>
                </>
              ) : <span className="squad-wait">—</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Returns each player's drafted teams in pick-round order.
function buildSquads(players, order, picks, teamsById, rounds) {
  const n = players.length;
  return order.map((pid, col) => {
    const teams = [];
    for (let r = 0; r < rounds; r++) {
      const overall = cellToOverall(r, col, n);
      teams.push(picks[overall] ? teamsById[picks[overall]] : null);
    }
    return { player: players.find((p) => p.id === pid), seed: col + 1, teams };
  });
}

function SquadsView({ players, order, picks, teamsById, rounds, ranked }) {
  const squads = useMemoR(
    () => buildSquads(players, order, picks, teamsById, rounds),
    [players, order, picks, teamsById, rounds]
  );
  let display = squads;
  if (ranked) {
    // Final standings: sort by avg rank ascending (lower = better).
    display = [...squads].sort((a, b) => squadAvg(a.teams) - squadAvg(b.teams));
  }
  // Strength-bar fill: best avg rank → fullest, worst → ~45%.
  const avgs = display.map((s) => squadAvg(s.teams));
  const lo = Math.min(...avgs), hi = Math.max(...avgs);
  const fillFor = (teams) => {
    if (hi === lo) return 1;
    return 0.45 + 0.55 * (hi - squadAvg(teams)) / (hi - lo);
  };
  return (
    <div className={clsx('squads', ranked && 'ranked')}>
      {display.map((s, i) => (
        <SquadCard key={s.player.id} {...s} rounds={rounds}
          rankPlace={ranked ? i + 1 : null} fill={fillFor(s.teams)} />
      ))}
    </div>
  );
}

Object.assign(window, { SquadsView, buildSquads, teamScore });
