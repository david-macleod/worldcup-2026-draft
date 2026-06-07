// Tournament simulation for the 2026 World Cup competition-results page.
// Deterministic given a seed. Produces group tables (with real scorelines),
// qualification, a knockout bracket, per-team fantasy points, and a manager
// leaderboard. Exposed as window.WC_SIM.simulate(seed).
(function () {
  // ---- seeded RNG (mulberry32) ----
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function poisson(lambda, rnd) {
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L && k < 30);
    return k - 1;
  }
  const strength = (t) => Math.max(8, 100 - (t.rank || 90));

  // ---- one match ----
  function playMatch(a, b, rnd, knockout) {
    const sA = strength(a), sB = strength(b);
    const tot = 2.65;
    const eA = tot * Math.pow(sA, 1.15) / (Math.pow(sA, 1.15) + Math.pow(sB, 1.15));
    const eB = tot - eA;
    let ga = poisson(eA * 1.05, rnd), gb = poisson(eB * 1.05, rnd);
    let pens = null;
    if (knockout && ga === gb) {
      // penalties — stronger side edge
      const pA = sA / (sA + sB);
      if (rnd() < pA) pens = [4 + (rnd() < .3 ? 1 : 0), 3]; else pens = [3, 4 + (rnd() < .3 ? 1 : 0)];
    }
    return { ga, gb, pens };
  }

  function teamRow(t) {
    return { id: t.id, team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 };
  }

  function simulate(seed) {
    const rnd = rng((seed || 1) * 2654435761 >>> 0);
    const teams = window.WC_TEAMS;
    const groupsOf = {};
    teams.forEach((t) => { (groupsOf[t.group] = groupsOf[t.group] || []).push(t); });
    const GROUPS = 'ABCDEFGHIJKL'.split('');

    const points = {}; // teamId -> fantasy points
    teams.forEach((t) => (points[t.id] = { group: 0, bonus: 0, stage: 'Group', total: 0 }));

    const groupResults = GROUPS.map((g) => {
      const gt = groupsOf[g];
      const rows = Object.fromEntries(gt.map((t) => [t.id, teamRow(t)]));
      const matches = [];
      for (let i = 0; i < gt.length; i++)
        for (let j = i + 1; j < gt.length; j++) {
          const a = gt[i], b = gt[j];
          const m = playMatch(a, b, rnd, false);
          matches.push({ a, b, ga: m.ga, gb: m.gb });
          const ra = rows[a.id], rb = rows[b.id];
          ra.P++; rb.P++; ra.GF += m.ga; ra.GA += m.gb; rb.GF += m.gb; rb.GA += m.ga;
          if (m.ga > m.gb) { ra.W++; rb.L++; ra.Pts += 3; }
          else if (m.ga < m.gb) { rb.W++; ra.L++; rb.Pts += 3; }
          else { ra.D++; rb.D++; ra.Pts++; rb.Pts++; }
        }
      const table = Object.values(rows).sort((x, y) =>
        y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || (x.team.rank - y.team.rank));
      table.forEach((r, idx) => {
        r.pos = idx + 1;
        points[r.id].group = r.Pts;
      });
      return { group: g, table, matches };
    });

    // qualification: top 2 per group + 8 best thirds
    const seconds = [], thirds = [];
    const qualified = new Set();
    groupResults.forEach((gr) => {
      qualified.add(gr.table[0].id);
      qualified.add(gr.table[1].id);
      thirds.push({ ...gr.table[2], group: gr.group });
    });
    thirds.sort((x, y) => y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || (x.team.rank - y.team.rank));
    const bestThirds = thirds.slice(0, 8);
    bestThirds.forEach((r) => qualified.add(r.id));

    teams.forEach((t) => {
      if (qualified.has(t.id)) { points[t.id].bonus += 4; points[t.id].stage = 'R32'; }
    });

    // knockout bracket: seed 32 qualifiers by group points then rank
    const qduals = teams.filter((t) => qualified.has(t.id))
      .map((t) => ({ t, key: points[t.id].group * 100 + (100 - (t.rank || 90)) }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.t);

    const STAGES = [
      { name: 'R32', reach: 'R16', win: 6 },
      { name: 'R16', reach: 'QF', win: 8 },
      { name: 'QF', reach: 'SF', win: 12 },
      { name: 'SF', reach: 'Final', win: 16 },
      { name: 'Final', reach: 'Champion', win: 26 },
    ];
    // standard seed pairing 1v32, 2v31...
    let bracket = [];
    for (let i = 0; i < qduals.length / 2; i++) bracket.push([qduals[i], qduals[qduals.length - 1 - i]]);

    const rounds = [];
    let stageIdx = 0;
    let guard = 0;
    while (bracket.length >= 1 && stageIdx < STAGES.length && guard++ < 10) {
      const st = STAGES[stageIdx];
      const ties = [];
      const next = [];
      for (const [a, b] of bracket) {
        const m = playMatch(a, b, rnd, true);
        let winner, loser, scoreline;
        const aWin = m.ga > m.gb || (m.pens && m.pens[0] > m.pens[1]);
        winner = aWin ? a : b; loser = aWin ? b : a;
        ties.push({ a, b, ga: m.ga, gb: m.gb, pens: m.pens, winner: winner.id });
        points[winner.id].bonus += st.win;
        points[winner.id].stage = st.reach;
        next.push(winner);
      }
      rounds.push({ stage: st.name, ties });
      // pair winners for next round
      bracket = [];
      for (let i = 0; i < next.length; i += 2)
        if (next[i + 1]) bracket.push([next[i], next[i + 1]]);
        else { bracket = []; window.__champion = next[i]; }
      if (next.length === 1) { window.__champion = next[0]; break; }
      stageIdx++;
    }
    const champion = window.__champion;

    teams.forEach((t) => { const p = points[t.id]; p.total = p.group + p.bonus; });

    // ---- managers: snake draft by rank (deterministic, illustrative) ----
    const MGRS = [
      { id: 'm1', name: 'Jade', seed: 3 }, { id: 'm2', name: 'David', seed: 8 },
      { id: 'm3', name: 'Ivar', seed: 2 }, { id: 'm4', name: 'G&G', seed: 4 },
      { id: 'm5', name: 'Alfie', seed: 7 }, { id: 'm6', name: 'Pru', seed: 1 },
      { id: 'm7', name: 'Jamie', seed: 6 }, { id: 'm8', name: 'Laura', seed: 5 },
    ];
    const colors = window.WC_PLAYER_COLORS;
    const order = [...MGRS].sort((a, b) => a.seed - b.seed); // seed order
    order.forEach((m, i) => (m.color = colors[i]));
    const byRank = [...teams].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const squads = Object.fromEntries(order.map((m) => [m.id, []]));
    const N = order.length;
    byRank.forEach((t, pick) => {
      const round = Math.floor(pick / N);
      const pos = pick % N;
      const col = round % 2 === 0 ? pos : N - 1 - pos;
      squads[order[col].id].push(t);
    });

    const leaderboard = order.map((m) => {
      const sq = squads[m.id].map((t) => ({ team: t, pts: points[t.id], stage: points[t.id].stage }));
      const total = sq.reduce((s, x) => s + x.pts.total, 0);
      const advanced = sq.filter((x) => qualified.has(x.team.id)).length;
      const deepest = sq.reduce((d, x) => Math.max(d, STAGE_ORD[x.stage] || 0), 0);
      return { mgr: m, squad: sq, total, advanced, deepestStage: STAGE_NAME[deepest] };
    }).sort((a, b) => b.total - a.total);

    return { groupResults, bestThirds, qualified, rounds, champion, points, leaderboard };
  }

  const STAGE_ORD = { Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, Final: 5, Champion: 6 };
  const STAGE_NAME = ['Group', 'Last 32', 'Last 16', 'Quarter-final', 'Semi-final', 'Final', 'Champion'];

  window.WC_SIM = { simulate };
})();
