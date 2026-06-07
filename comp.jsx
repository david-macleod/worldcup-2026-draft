// Competition Results page — renders the simulated tournament.
// Leaderboard (managers) + group tables (with scorelines) + knockout bracket.
const { useState: useStateC, useMemo: useMemoC } = React;

const STAGE_LABEL = { Group: 'Group stage', R32: 'Last 32', R16: 'Last 16', QF: 'Quarter-final', SF: 'Semi-final', Final: 'Final', Champion: 'Champion 🏆' };

// ---- Leaderboard ----
function Leaderboard({ leaderboard }) {
  const top = leaderboard[0].total || 1;
  const tierOf = (idx) => Math.floor(idx / 2) + 1; // 6 picks → tiers 1,1,2,2,3,3
  return (
    <section className="lb">
      <div className="lb-grid">
        {leaderboard.map((row, i) => {
          const segs = row.squad.map((x, idx) => ({ ...x, tier: tierOf(idx), round: idx + 1 }));
          const scoring = segs.filter((s) => s.pts.total > 0);
          const holding = segs.filter((s) => s.pts.total <= 0);
          const barPct = (row.total / top) * 100;
          return (
            <div className={clsx('lb-row', i === 0 && 'leader')} key={row.mgr.id} style={{ '--clk': row.mgr.color }}>
              <span className="lb-place">{i + 1}</span>
              <span className="lb-name">{row.mgr.name}</span>
              <div className="lb-pts"><b>{row.total}</b><span>PTS</span></div>
              <div className="lb-track">
                <div className="lb-bar" style={{ flex: `0 1 ${barPct}%` }}>
                  {scoring.map((s) => (
                    <div className={clsx('lb-seg', `t${s.tier}`)} key={s.team.id}
                      style={{ flexGrow: s.pts.total }}
                      title={`${s.team.name} · ${s.pts.total} pts · R${s.round} pick (${STAGE_LABEL[s.stage] || s.stage})`}>
                      <span className="lb-seg-flag"><Flag team={s.team} size={18} /></span>
                      <span className="lb-seg-block"><span className="lb-seg-n">{s.pts.total}</span></span>
                    </div>
                  ))}
                </div>
                {holding.length > 0 && (
                  <div className="lb-hold">
                    {holding.map((s) => (
                      <span className={clsx('lb-hold-fl', `t${s.tier}`)} key={s.team.id}
                        title={`${s.team.name} · 0 pts · R${s.round} pick`}>
                        <Flag team={s.team} size={18} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Group-stage results feed (match cards, owner + points per result) ----
function ownerMap(leaderboard) {
  const m = {};
  leaderboard.forEach((row) => {
    row.squad.forEach((x, idx) => {
      m[x.team.id] = { mgr: row.mgr, tier: Math.floor(idx / 2) + 1 };
    });
  });
  return m;
}
const matchPts = (gf, ga) => (gf > ga ? 3 : gf === ga ? 1 : 0);
// Per-match fantasy breakdown: result (W5/D2/L0) + goals (1 each) + bonus
// (clean sheet +2, scored 3+ +1). Total is the headline figure.
function scoreBreakdown(gf, ga) {
  const result = gf > ga ? 5 : gf === ga ? 2 : 0;
  const goals = gf;
  const bonus = (ga === 0 ? 2 : 0) + (gf >= 3 ? 1 : 0);
  return { result, goals, bonus, total: result + goals + bonus };
}

function ResultRow({ team, gf, ga, owner, win }) {
  const s = scoreBreakdown(gf, ga);
  const o = owner || { mgr: { name: '—', color: 'var(--muted)' }, tier: 1 };
  return (
    <div className={clsx('rr', win && 'win')}>
      <div className={clsx('rr-box', `t${o.tier}`)}>
        <Flag team={team} size={20} />
        <span className="rr-score">{gf}</span>
      </div>
      <span className="rr-owner">{o.mgr.name}</span>
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
  );
}

function GroupResults({ groupResults, leaderboard }) {
  const owners = useMemoC(() => ownerMap(leaderboard), [leaderboard]);
  return (
    <section className="gr">
      <div className="sec-head">
        <h2>Group stage results</h2>
        <span className="sec-sub">every match · <b>R</b> result · <b>G</b> goals · <b>B</b> bonus · total</span>
      </div>
      <div className="gr-groups">
        {groupResults.map((gr) => (
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
    </section>
  );
}

// ---- Group tables ----
function GroupCard({ gr, qualified, pointsMap }) {
  return (
    <div className="grp">
      <div className="grp-head">Group {gr.group}</div>
      <table className="grp-table">
        <thead>
          <tr><th></th><th className="tl">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
        </thead>
        <tbody>
          {gr.table.map((r) => {
            const q = qualified.has(r.id);
            const gd = r.GF - r.GA;
            return (
              <tr key={r.id} className={clsx(q && 'q', r.pos === 3 && q && 'q3')}>
                <td className="pos">{r.pos}</td>
                <td className="tl"><Flag team={r.team} size={20} /><span className="gt-name">{r.team.name}</span></td>
                <td>{r.P}</td><td>{r.W}</td><td>{r.D}</td><td>{r.L}</td>
                <td>{gd > 0 ? '+' + gd : gd}</td><td className="pts">{r.Pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="grp-matches">
        {gr.matches.map((m, i) => (
          <div className="gm-row" key={i}>
            <span className="gm-side gm-a">{m.a.abbr}</span>
            <span className="gm-score">{m.ga}–{m.gb}</span>
            <span className="gm-side gm-b">{m.b.abbr}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Knockout bracket ----
function Bracket({ rounds, champion, teamsById }) {
  if (!rounds || !rounds.length) return null;
  return (
    <section className="ko">
      <div className="sec-head"><h2>Knockout bracket</h2><span className="sec-sub">single elimination · {rounds[0].ties.length * 2} teams</span></div>
      <div className="ko-scroll">
        <div className="ko-rounds">
          {rounds.map((rd) => (
            <div className="ko-col" key={rd.stage}>
              <div className="ko-stage">{STAGE_LABEL[rd.stage]}</div>
              {rd.ties.map((t, i) => (
                <div className="ko-tie" key={i}>
                  <KoSide team={t.a} win={t.winner === t.a.id} score={t.ga} pen={t.pens ? t.pens[0] : null} />
                  <KoSide team={t.b} win={t.winner === t.b.id} score={t.gb} pen={t.pens ? t.pens[1] : null} />
                </div>
              ))}
            </div>
          ))}
          {champion && (
            <div className="ko-col ko-champ-col">
              <div className="ko-stage">Winner</div>
              <div className="ko-champ" style={{ '--clk': 'var(--gold)' }}>
                <span className="ko-trophy">🏆</span>
                <Flag team={champion} size={44} />
                <span className="ko-champ-name">{champion.name}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function KoSide({ team, win, score, pen }) {
  return (
    <div className={clsx('ko-side', win && 'win')}>
      <Flag team={team} size={18} />
      <span className="ko-abbr">{team.abbr}</span>
      <span className="ko-score">{score}{pen != null ? <em> ({pen})</em> : null}</span>
    </div>
  );
}

window.CompResults = { Leaderboard, GroupResults, GroupCard, Bracket };
