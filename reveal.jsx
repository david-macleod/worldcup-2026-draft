// DraftReveal — eventful pop-up shown when a manager picks a team.
// Terse profile: rank, group + groupmates, star player, fun fact. Confirm → commit + zoom.
const { useEffect: useEffectR } = React;

function DraftReveal({ team, player, onConfirm, onCancel }) {
  useEffectR(() => {
    const onKey = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  if (!team) return null;
  const mates = window.WC_TEAMS
    .filter((x) => x.group === team.group && x.id !== team.id)
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));

  return (
    <div className="reveal-backdrop" onClick={onCancel}>
      <div className="reveal-card" style={{ '--clk': player.color }} onClick={(e) => e.stopPropagation()}>
        <div className="reveal-spark" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => <span key={i} style={{ '--i': i }} />)}
        </div>

        <div className="reveal-top">
          <PlayerDot player={player} size={42} ring />
          <span>Current turn — <b>{player.name || 'Manager'}</b></span>
        </div>

        <div className="reveal-hero">
          <span className="reveal-flagwrap"><Flag team={team} size={138} /></span>
          <div className="reveal-id">
            <span className="reveal-name">{team.name}</span>
            <div className="reveal-tags">
              <RankPill rank={team.rank} />
              <ConfTag conf={team.conf} />
            </div>
          </div>
        </div>

        <div className="reveal-rows">
          <div className="reveal-row">
            <span className="rl">Group {team.group}</span>
            <div className="reveal-group">
              {mates.map((g) => (
                <span className="gm" key={g.id} title={g.name}>
                  <Flag team={g} size={26} /><b>{g.abbr}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="reveal-row">
            <span className="rl">★ Star</span>
            <span className="rv">{team.star}</span>
          </div>
        </div>

        <div className="reveal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Confirm pick →</button>
        </div>
      </div>
    </div>);
}

Object.assign(window, { DraftReveal });
