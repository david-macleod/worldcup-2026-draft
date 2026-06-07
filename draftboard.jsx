// Live draft board: snake grid + "order by" panel + bottom team strip (3-letter chips).
const { useState: useStateB, useMemo: useMemoB, useRef: useRefB, useEffect: useEffectB, useLayoutEffect: useLayoutEffectB } = React;

// Map an overall pick number to {round, col} on the board (col = seat in seed order).
function pickToCell(overall, n) {
  const round = Math.floor(overall / n);
  const pos = overall % n;
  const col = round % 2 === 0 ? pos : n - 1 - pos;
  return { round, col };
}
function cellToOverall(round, col, n) {
  const pos = round % 2 === 0 ? col : n - 1 - col;
  return round * n + pos;
}

// Ordering options shown on the right. asc = lower value first.
const SORT_OPTS = [
  { id: 'rank',   emoji: '🏆', label: 'Overall rank',     unit: '',     asc: true,  invert: true,  get: (t) => t.rank || 999, fmt: (t) => `#${t.rank}` },
  { id: 'pop',    emoji: '👥', label: 'Population',        unit: 'M',    asc: false, get: (t) => t.pop,  fmt: (t) => t.pop + 'M' },
  { id: 'temp',   emoji: '🌡️', label: 'Avg temperature',   unit: '°C',   asc: false, get: (t) => t.temp, fmt: (t) => t.temp + '°' },
  { id: 'rain',   emoji: '🌧️', label: 'Avg rainfall',      unit: 'mm',   asc: false, get: (t) => t.rain, fmt: (t) => t.rain + 'mm' },
  { id: 'age',    emoji: '🎂', label: 'Avg team age',      unit: 'y',    asc: false, get: (t) => t.age,  fmt: (t) => t.age.toFixed(1) + 'y' },
  { id: 'hgt',    emoji: '📏', label: 'Avg height',        unit: 'cm',   asc: false, get: (t) => t.hgt,  fmt: (t) => t.hgt + 'cm' },
  { id: 'light',  emoji: '⚡', label: 'Lightning strikes', unit: '/km²', asc: false, get: (t) => t.light, fmt: (t) => t.light + '/km²' },
  { id: 'dogs',   emoji: '🐕', label: 'Dogs per capita',   unit: '/1k',  asc: false, get: (t) => t.dogs, fmt: (t) => t.dogs + '/1k' },
  { id: 'coffee', emoji: '☕', label: 'Coffee per capita', unit: 'kg',   asc: false, get: (t) => t.coffee, fmt: (t) => t.coffee + 'kg' },
  { id: 'haggis', emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', label: 'Haggis per capita', unit: '',     asc: false, get: (t) => t.haggis, fmt: (t) => t.haggis > 0 ? '🏴󠁧󠁢󠁳󠁣󠁴󠁿' : '—' },
];

function BoardGrid({ players, order, picks, teamsById, current, rounds, zoomOverall, onUndo, canUndo }) {
  const n = players.length;
  const scrollRef = useRefB(null);

  // When a slot is freshly filled, gently scroll it into view (manual, no scrollIntoView).
  useEffectB(() => {
    if (zoomOverall == null) return;
    const wrap = scrollRef.current;
    const cell = wrap && wrap.querySelector(`[data-overall="${zoomOverall}"]`);
    if (!wrap || !cell) return;
    const cx = cell.offsetLeft + cell.offsetWidth / 2 - wrap.clientWidth / 2;
    const cy = cell.offsetTop + cell.offsetHeight / 2 - wrap.clientHeight / 2;
    wrap.scrollTo({ left: Math.max(0, cx), top: Math.max(0, cy), behavior: 'smooth' });
  }, [zoomOverall]);

  return (
    <div className="board-scroll" ref={scrollRef}>
      <div className="board" style={{ '--cols': n }}>
        <button className="board-corner undo-corner" onClick={onUndo} disabled={!canUndo} title="Undo last pick">↩</button>
        {order.map((pid, c) => {
          const p = players.find((x) => x.id === pid);
          return (
            <div className="col-head" key={pid}>
              <PlayerDot player={p} size={26} />
              <span>{p.name || `M${c + 1}`}</span>
            </div>);
        })}
        {Array.from({ length: rounds }).map((_, r) =>
        <React.Fragment key={r}>
            <div className="row-head">
              <span className="rnd-num">{r + 1}</span>
              <span className="rnd-dir">{r % 2 === 0 ? '→' : '←'}</span>
            </div>
            {order.map((pid, c) => {
            const overall = cellToOverall(r, c, n);
            const teamId = picks[overall];
            const team = teamId ? teamsById[teamId] : null;
            const isCurrent = overall === current;
            const isZoom = overall === zoomOverall;
            const p = players.find((x) => x.id === pid);
            return (
              <div key={c} data-overall={overall}
              className={clsx('cell', team && 'filled', isCurrent && 'current', isZoom && 'zoomed')}
              style={isCurrent || team ? { '--clk': p.color } : undefined}>
                  {team ?
                <>
                      <Flag team={team} size={26} />
                      <span className="cell-name">{team.name}</span>
                      <span className="cell-pick">{overall + 1}</span>
                    </> :
                isCurrent ?
                <span className="cell-onclock">Current turn</span> :
                <span className="cell-empty">{overall + 1}</span>
                }
                </div>);
          })}
          </React.Fragment>
        )}
      </div>
    </div>);
}

// Right-hand panel: choose how the bottom team strip is ordered.
function SortPanel({ sortId, onSort }) {
  return (
    <aside className="sort-panel">
      <div className="sort-list">
        {SORT_OPTS.map((o) =>
        <button key={o.id} className={clsx('sort-opt', sortId === o.id && 'active')}
        title={o.asc ? 'Low to high' : 'High to low'}
        onClick={() => onSort(o.id)}>
            <span className="sort-emoji">{o.emoji}</span>
            <span className="sort-label">{o.label}</span>
            <span className="sort-dir">{o.asc ? '↑' : '↓'}</span>
          </button>
        )}
      </div>
    </aside>);
}

// Bottom strip: available teams as a bar chart — one column per team, bar height = the
// selected metric, team name rotated vertically beneath. All 48 fit along the bottom.
function TeamStrip({ teams, onPick, done, sortId }) {
  const [q, setQ] = useStateB('');
  const chartRef = useRefB(null);
  const [colW, setColW] = useStateB(28);
  const opt = SORT_OPTS.find((o) => o.id === sortId) || SORT_OPTS[0];

  // Lock column width to (chart width / full field) so 48 teams fill the row exactly,
  // and drafted teams simply drop off the right rather than re-stretching the rest.
  const TOTAL = window.WC_TEAMS.length;
  const GAP = 1;
  useEffectB(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setColW(Math.max(14, (w - GAP * (TOTAL - 1)) / TOTAL));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [TOTAL]);

  const { list, frac } = useMemoB(() => {
    const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(q.toLowerCase().trim()) ||
    t.abbr.toLowerCase().includes(q.toLowerCase().trim()));
    const sorted = filtered.sort((a, b) => opt.asc ? opt.get(a) - opt.get(b) : opt.get(b) - opt.get(a));
    const vals = sorted.map(opt.get);
    const min = Math.min(...vals), max = Math.max(...vals);
    // Height encodes the metric value directly; rank inverts so #1 is tallest.
    const frac = (t) => {
      const f = max === min ? 1 : (opt.get(t) - min) / (max - min);
      return opt.invert ? 1 - f : f;
    };
    return { list: sorted, frac };
  }, [teams, q, sortId]);

  // FLIP: smoothly slide bars to their new positions when the sort order changes.
  const posRef = useRefB(new Map());
  useLayoutEffectB(() => {
    const el = chartRef.current;
    if (!el) return;
    el.querySelectorAll('.chart-col').forEach((node) => {
      const id = node.dataset.id;
      const left = node.offsetLeft;
      const prev = posRef.current.get(id);
      if (prev != null && prev !== left) {
        node.animate(
          [{ transform: `translateX(${prev - left}px)` }, { transform: 'translateX(0)' }],
          { duration: 1440, easing: 'cubic-bezier(.33,0,.15,1)' });
      }
      posRef.current.set(id, left);
    });
  }, [list, colW]);

  return (
    <section className="team-strip">
      <div className="strip-head">
        <span className="strip-by">Sorted by {opt.label.toLowerCase()}{opt.unit ? ` (${opt.unit})` : ''} {opt.emoji}</span>
      </div>
      <div className="team-chart" ref={chartRef}>
        {list.length === 0 && <span className="strip-empty">No teams match.</span>}
        {list.map((t) => {
          const fr = frac(t);
          const h = Math.round(fr * 100);
          const off = Math.round((1 - fr) * 211);
          const valLabel = opt.fmt(t);
          return (
            <button key={t.id} data-id={t.id} className="chart-col" style={{ width: colW }}
            onClick={() => !done && onPick(t.id)} disabled={done}
            title={`${t.name} · ${opt.label}: ${valLabel}`}>
              <span className="col-val-wrap" style={{ transform: `translateY(${off}px)` }}>
                <span className={clsx('col-val', sortId !== 'rank' && 'rot')}>{valLabel}</span>
              </span>
              <span className="col-bar-track">
                <span className="col-bar" style={{ height: `${h}%` }} />
              </span>
              <Flag team={t} size={24} />
              <span className="col-name">{t.name}</span>
            </button>);
        })}
      </div>
    </section>);
}

Object.assign(window, { BoardGrid, SortPanel, TeamStrip, SORT_OPTS, pickToCell, cellToOverall });
