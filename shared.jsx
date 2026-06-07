// Shared presentational helpers for the draft. Exported to window at the bottom.
const { useState, useEffect, useRef } = React;

// Circular flag chip. Uses flagcdn for real flags; TBD slots get a neutral glyph.
function Flag({ team, size = 30 }) {
  const r = size;
  const style = {
    width: r, height: r, borderRadius: '50%', flex: '0 0 auto',
    objectFit: 'cover', background: 'var(--chip)',
    boxShadow: 'inset 0 0 0 1px var(--hairline)',
  };
  if (!team || team.tbd || !team.code) {
    return (
      <span style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: r * 0.42, fontWeight: 700, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
        ?
      </span>
    );
  }
  // Prefer a bundled/inlined flag (offline standalone); fall back to live flagcdn.
  const resId = 'flag_' + team.code.replace(/-/g, '_');
  const src = (window.__resources && window.__resources[resId]) ||
    `https://flagcdn.com/w160/${team.code}.png`;
  return (
    <img src={src} alt={team.name}
      width={r} height={r} style={style} loading="lazy" />
  );
}

// Small confederation tag.
function ConfTag({ conf }) {
  return <span className="conf-tag">{conf}</span>;
}

// Rank pill, e.g. #5 — dims TBD.
function RankPill({ rank }) {
  if (!rank) return <span className="rank-pill rank-tbd">TBD</span>;
  const tier = rank <= 8 ? 'elite' : rank <= 20 ? 'strong' : 'mid';
  return <span className={`rank-pill rank-${tier}`}>#{rank}</span>;
}

// Player avatar dot with initials.
function PlayerDot({ player, size = 34, ring = false }) {
  return (
    <span className="player-dot" style={{
      width: size, height: size, fontSize: size * 0.4,
      background: player.color,
      boxShadow: ring ? `0 0 0 2px var(--panel), 0 0 0 4px ${player.color}` : 'none',
    }}>
      {player.name.trim().slice(0, 2).toUpperCase() || (player.id.match(/\d+/) || ['?'])[0]}
    </span>
  );
}

// Hook: animated count-up number (for headline stats).
function useCountUp(target, ms = 600) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function clsx(...a) { return a.filter(Boolean).join(' '); }
function fmtClock(s) {
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

Object.assign(window, { Flag, ConfTag, RankPill, PlayerDot, useCountUp, clsx, fmtClock });
