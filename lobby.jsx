// Pre-draft lobby: name the 6 players, spin for a randomized snake order, start.
const { useState: useStateL, useEffect: useEffectL, useRef: useRefL } = React;

function Lobby({ players, onRename, order, spinning, onSpin, onStart, rounds }) {
  const hasOrder = order && order.length === players.length;

  return (
    <div className="lobby">
      <div className="lobby-head">
        <div className="kicker">Snake Draft · {players.length} managers · {rounds} rounds</div>
        <h1 className="lobby-title">World Cup 2026<span>Draft</span></h1>
        <p className="lobby-sub">
          48 nations. Eight managers. Six picks each. Set your room, spin for the order,
          and may the best squad win the group stage.
        </p>
      </div>

      <div className="lobby-grid">
        <section className="card roster-setup">
          <div className="card-label">The Room</div>
          <div className="setup-list">
            {players.map((p, i) => (
              <div className="setup-row" key={p.id}>
                <PlayerDot player={p} size={38} />
                <input
                  className="name-input"
                  value={p.name}
                  maxLength={16}
                  placeholder={`Manager ${i + 1}`}
                  onChange={(e) => onRename(p.id, e.target.value)}
                />
                <span className="setup-seed">
                  {hasOrder ? `#${order.indexOf(p.id) + 1}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card order-board">
          <div className="card-label">Draft Order</div>
          {!hasOrder && !spinning && (
            <div className="order-empty">
              <div className="order-empty-art" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} style={{ animationDelay: `${i * 80}ms` }} />)}
              </div>
              <p>Spin to randomize the snake order.</p>
            </div>
          )}
          {(spinning || hasOrder) && (
            <ol className={clsx('order-reel', spinning && 'is-spinning')}>
              {(hasOrder ? order : players.map((p) => p.id)).map((pid, idx) => {
                const p = players.find((x) => x.id === pid);
                return (
                  <li key={idx} className="order-item" style={{ animationDelay: `${idx * 110}ms` }}>
                    <span className="order-seed">{idx + 1}</span>
                    <PlayerDot player={p} size={30} />
                    <span className="order-name">{p.name || 'Manager'}</span>
                    <span className="order-snake">
                      {idx === 0 ? 'first overall' : idx === players.length - 1 ? 'turns the snake' : ''}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="order-actions">
            <button className="btn btn-ghost" onClick={onSpin} disabled={spinning}>
              {spinning ? 'Spinning…' : hasOrder ? 'Re-spin' : 'Spin draft order'}
            </button>
            <button className="btn btn-primary" onClick={onStart} disabled={!hasOrder || spinning}>
              Start draft →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { Lobby });
