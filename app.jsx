// Root: state, routing, timer, auto-pick/undo, tweaks.
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useRef: useRefA } = React;

const N = 8,ROUNDS = 6,TOTAL = N * ROUNDS;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "midnight",
  "accent": "#2bd47d"
} /*EDITMODE-END*/;

const THEME_ACCENTS = {
  midnight: ['#2bd47d', '#37a0ff', '#f5b13d', '#ff5d73'],
  broadcast: ['#0a7d4d', '#1746a2', '#d6203a', '#e8772e'],
  pitch: ['#ffd34d', '#7cf0b0', '#ff8c42', '#9be15d']
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [players, setPlayers] = useStateA(() =>
  Array.from({ length: N }, (_, i) => ({
    id: `p${i + 1}`, name: '', color: window.WC_PLAYER_COLORS[i]
  }))
  );
  const [order, setOrder] = useStateA(null);
  const [spinning, setSpinning] = useStateA(false);
  const [screen, setScreen] = useStateA('lobby');
  const [view, setView] = useStateA('board');
  const [picks, setPicks] = useStateA([]); // dense: picks[overall] = teamId
  const [sortId, setSortId] = useStateA('rank');
  const [flash, setFlash] = useStateA(null); // {teamId, playerId} just-picked toast
  const [pending, setPending] = useStateA(null); // teamId awaiting confirm in reveal modal
  const [zoom, setZoom] = useStateA(null); // overall index to zoom into after a pick

  const teamsById = useMemoA(() => Object.fromEntries(window.WC_TEAMS.map((x) => [x.id, x])), []);
  const pickedSet = useMemoA(() => new Set(picks), [picks]);
  const available = useMemoA(() => window.WC_TEAMS.filter((x) => !pickedSet.has(x.id)), [pickedSet]);

  const current = picks.length;
  const done = current >= TOTAL;
  const { round } = done ? { round: ROUNDS - 1 } : pickToCell(current, N);
  const currentSeat = done ? null : pickToCell(current, N).col;
  const currentPlayer = !done && order ? players.find((p) => p.id === order[currentSeat]) : null;

  // ── Actions ────────────────────────────────────────────
  function rename(id, name) {
    setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, name } : p));
  }
  function spin() {
    setSpinning(true);
    setOrder(null);
    const result = shuffle(players.map((p) => p.id));
    setTimeout(() => {setOrder(result);setSpinning(false);}, 700 + N * 110);
  }
  function startDraft() {
    if (!order) return;
    setPicks([]);setScreen('draft');setView('board');
  }
  function commitPick(resolveTeamId) {
    setPicks((prev) => {
      if (prev.length >= TOTAL) return prev;
      const taken = new Set(prev);
      const teamId = resolveTeamId(taken);
      if (!teamId || taken.has(teamId)) return prev;
      const seat = pickToCell(prev.length, N).col;
      const pid = order[seat];
      setFlash({ teamId, playerId: pid });
      return [...prev, teamId];
    });
  }
  function makePick(teamId) {setPending(teamId);}
  function confirmPick() {
    if (!pending) return;
    const overall = picks.length;
    commitPick(() => pending);
    setPending(null);
    setZoom(overall);
  }
  function cancelPick() {setPending(null);}
  function autoPick() {
    const overall = picks.length;
    commitPick((taken) =>
    (window.WC_TEAMS.filter((x) => !taken.has(x.id)).
    sort((a, b) => (a.rank || 999) - (b.rank || 999))[0] || {}).id);
    setZoom(overall);
  }
  useEffectA(() => {
    if (zoom == null) return;
    const id = setTimeout(() => setZoom(null), 1500);
    return () => clearTimeout(id);
  }, [zoom]);
  useEffectA(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(id);
  }, [flash]);
  function undo() {
    if (!picks.length) return;
    setPicks((p) => p.slice(0, -1));
    setFlash(null);
  }
  function newDraft() {
    setScreen('lobby');setPicks([]);setOrder(null);setView('board');
  }

  // auto-jump to ranked squads when the draft completes
  useEffectA(() => {if (done) setView('squads');}, [done]);

  const accents = THEME_ACCENTS[t.theme] || THEME_ACCENTS.midnight;

  return (
    <div className="app" data-theme={t.theme} style={{ '--accent': t.accent }}>
      {screen === 'lobby' &&
      <Lobby players={players} onRename={rename} order={order} spinning={spinning}
      onSpin={spin} onStart={startDraft} rounds={ROUNDS} />
      }

      {screen === 'draft' &&
      <div className="draft">
          <header className="masthead">
            <button className="mh-brand" onClick={newDraft} title="New draft">
              <span className="mh-trophy" aria-hidden="true">🌍</span>
              <span className="mh-title">World Cup 2026 Draft</span>
            </button>
            {!done &&
          <div className="mh-turn" style={{ '--clk': (currentPlayer || players[0]).color }}>
                <span className="mh-turn-lbl">Current turn</span>
                <span className="mh-turn-name">
                  <PlayerDot player={currentPlayer || players[0]} size={22} />
                  {(currentPlayer || players[0]).name || 'Manager'}
                </span>
              </div>
          }
            <div className="mh-remain">
              <b>{TOTAL - current}</b>/{TOTAL} teams remaining
            </div>
          </header>

          {done &&
        <div className="finale">
              <span className="finale-kick">Draft complete</span>
              <span className="finale-txt">Squads ranked by projected strength below — go win your group.</span>
              <button className="btn btn-primary sm" onClick={newDraft}>New draft</button>
            </div>
        }

          <div className="draft-body">
            {view === 'board' ?
          <>
                <div className="draft-main">
                  <BoardGrid players={players} order={order} picks={picks}
              teamsById={teamsById} current={current} rounds={ROUNDS}
              zoomOverall={zoom} onUndo={undo} canUndo={picks.length > 0} />
                  <SortPanel sortId={sortId} onSort={setSortId} />
                </div>
                <TeamStrip teams={available} onPick={makePick} done={done} sortId={sortId} />
              </> :

          <div className="squads-wrap">
                <SquadsView players={players} order={order} picks={picks}
            teamsById={teamsById} rounds={ROUNDS} ranked={done} />
              </div>
          }
          </div>

          {flash &&
        <div className="toast" style={{ '--clk': (players.find((p) => p.id === flash.playerId) || {}).color }}>
              <Flag team={teamsById[flash.teamId]} size={30} />
              <div className="toast-txt">
                <b>{teamsById[flash.teamId].name}</b>
                <span>to {(players.find((p) => p.id === flash.playerId) || {}).name || 'Manager'}</span>
              </div>
            </div>
        }

          {pending &&
        <DraftReveal team={teamsById[pending]} player={currentPlayer || players[0]}
        onConfirm={confirmPick} onCancel={cancelPick} />
        }
        </div>
      }

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakRadio label="Style" value={t.theme} options={['midnight', 'broadcast', 'pitch']}
        onChange={(v) => {setTweak('theme', v);setTweak('accent', THEME_ACCENTS[v][0]);}} />
        <TweakColor label="Accent" value={t.accent} options={accents}
        onChange={(v) => setTweak('accent', v)} />
      </TweaksPanel>
    </div>);

}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);