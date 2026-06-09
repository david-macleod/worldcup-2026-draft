// Generates a standalone, shareable draft-preview.html: a snake board ~40% filled,
// 8 players (Player A–H), dark-green pitch theme, real flags. No JS, fully inline.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const TEAMS = JSON.parse(readFileSync(resolve(here, '../src/db/teams.json'), 'utf8'))

const N = 8, ROUNDS = 6, TOTAL = 48
const FILLED = 19 // ~40% (19/48 ≈ 40%)
const COLORS = ['#34d399', '#f59e0b', '#60a5fa', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#a3e635']
const PLAYERS = Array.from({ length: N }, (_, i) => ({
  name: `Player ${String.fromCharCode(65 + i)}`,
  initials: 'P' + String.fromCharCode(65 + i),
  color: COLORS[i],
}))

const seatForOverall = (o) => { const r = Math.floor(o / N), p = o % N; return r % 2 === 0 ? p : N - 1 - p }
const cellToOverall = (r, c) => r * N + (r % 2 === 0 ? c : N - 1 - c)

// Assign the first FILLED picks: best-available by FIFA rank in snake order.
const byRank = [...TEAMS].sort((a, b) => a.rank - b.rank)
const taken = new Set()
const pickAt = {} // overall -> team
for (let o = 0; o < FILLED; o++) {
  const t = byRank.find((x) => !taken.has(x.id))
  taken.add(t.id); pickAt[o] = t
}
const remaining = byRank.filter((t) => !taken.has(t.id))

const flag = (t, cls = '') => `<img class="flag ${cls}" src="https://flagcdn.com/${t.code}.svg" alt="${t.name}" loading="lazy">`
const dot = (p, size = 26) =>
  `<span class="dot" style="width:${size}px;height:${size}px;font-size:${size * 0.4}px;background:${p.color}">${p.initials}</span>`

// ── board ──
let board = `<div class="board-corner">PICK</div>`
PLAYERS.forEach((p) => { board += `<div class="col-head">${dot(p)}<span>${p.name}</span></div>` })
for (let r = 0; r < ROUNDS; r++) {
  board += `<div class="row-head"><span class="rnd-num">${r + 1}</span><span class="rnd-dir">${r % 2 === 0 ? '→' : '←'}</span></div>`
  for (let c = 0; c < N; c++) {
    const overall = cellToOverall(r, c)
    const team = pickAt[overall]
    const seat = seatForOverall(overall)
    const p = PLAYERS[seat]
    const isCurrent = overall === FILLED
    const style = (team || isCurrent) ? ` style="--clk:${p.color}"` : ''
    const cls = ['cell', team && 'filled', isCurrent && 'current'].filter(Boolean).join(' ')
    let inner
    if (team) inner = `${flag(team)}<span class="cell-name">${team.name}</span><span class="cell-pick">${overall + 1}</span>`
    else if (isCurrent) inner = `<span class="cell-onclock">On the clock</span>`
    else inner = `<span class="cell-empty">${overall + 1}</span>`
    board += `<div class="${cls}"${style}>${inner}</div>`
  }
}

// ── team strip (remaining teams as bars, sorted by rank, #1 tallest) ──
const ranks = remaining.map((t) => t.rank)
const min = Math.min(...ranks), max = Math.max(...ranks)
let strip = ''
for (const t of remaining) {
  const frac = max === min ? 1 : 1 - (t.rank - min) / (max - min)
  const h = Math.round(frac * 100)
  strip += `<div class="chart-col" title="${t.name} · #${t.rank}">`
    + `<span class="col-val">#${t.rank}</span>`
    + `<span class="col-bar-track"><span class="col-bar" style="height:${h}%"></span></span>`
    + `${flag(t)}<span class="col-name">${t.name}</span></div>`
}

const onClockPlayer = PLAYERS[seatForOverall(FILLED)]

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>World Cup 2026 Draft — live board (example)</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  --mono:'JetBrains Mono',ui-monospace,monospace; --ui:'Archivo',system-ui,sans-serif;
  --accent:#2bd47d; --r-sm:10px;
  --bg:#081e15; --panel:#0e2a1f; --panel-2:#133527; --chip:#19402f;
  --hairline:rgba(255,255,255,.10); --hairline-2:rgba(255,255,255,.18);
  --text:#eafff3; --muted:#84b29b; --on-accent:#06140d;
}
*{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body{font-family:var(--ui);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
.flag{width:26px;height:18px;border-radius:3px;object-fit:cover;box-shadow:0 0 0 1px var(--hairline);background:var(--chip);flex:0 0 auto;display:inline-block;}
.dot{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#07120c;font-weight:800;font-family:var(--mono);flex:0 0 auto;}
.masthead{display:flex;align-items:center;gap:16px;padding:0 20px;height:74px;flex:0 0 auto;background:var(--panel);border-bottom:1px solid var(--hairline);}
.mh-trophy{font-size:30px;}
.mh-title{font-weight:900;font-size:30px;letter-spacing:-.02em;}
.mh-turn{display:flex;align-items:center;gap:11px;margin-left:30px;padding:7px 16px;border-radius:999px;
  background:color-mix(in srgb,var(--clk) 14%,var(--panel-2));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--clk) 45%,transparent);}
.mh-turn-lbl{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--clk);}
.mh-turn-name{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px;}
.mh-remain{margin-left:auto;font-family:var(--mono);font-size:13px;font-weight:600;color:var(--muted);}
.mh-remain b{color:var(--accent);font-size:16px;}
.board-scroll{flex:1;overflow:auto;padding:20px;}
.board{display:grid;grid-template-columns:58px repeat(${N},1fr);gap:7px;min-width:760px;}
.board-corner{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--muted);display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;}
.col-head{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px;font-weight:800;font-size:13px;background:var(--panel);border-radius:var(--r-sm);border:1px solid var(--hairline);}
.col-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.row-head{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;}
.rnd-num{font-family:var(--mono);font-size:17px;font-weight:700;}
.rnd-dir{font-size:13px;color:var(--muted);}
.cell{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:var(--r-sm);background:var(--panel);border:1px solid var(--hairline);min-height:54px;}
.cell.filled{border-left:3px solid var(--clk);}
.cell-name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.cell-pick{font-family:var(--mono);font-size:11px;color:var(--muted);font-weight:600;}
.cell-empty{font-family:var(--mono);font-size:13px;color:var(--muted);opacity:.4;margin:auto;}
.cell.current{border:2px dashed var(--clk);background:color-mix(in srgb,var(--clk) 10%,var(--panel));}
.cell-onclock{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--clk);margin:auto;}
.team-strip{flex:0 0 auto;background:var(--panel);border-top:1px solid var(--hairline);padding:10px 16px 12px;display:flex;flex-direction:column;gap:8px;}
.strip-by{font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.team-chart{display:flex;align-items:flex-end;gap:2px;overflow-x:auto;padding-top:4px;}
.chart-col{flex:0 0 auto;width:30px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:4px 1px 0;border-radius:6px;}
.col-val{font-family:var(--mono);font-size:11px;font-weight:700;color:color-mix(in srgb,var(--text) 55%,var(--bg));}
.col-bar-track{height:150px;width:100%;display:flex;align-items:flex-end;justify-content:center;}
.col-bar{width:78%;max-width:22px;min-height:3px;background:var(--accent);border-radius:4px 4px 2px 2px;}
.col-name{writing-mode:vertical-rl;transform:rotate(180deg);font-size:12px;font-weight:600;color:var(--text);height:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.note{font-family:var(--mono);font-size:11px;color:var(--muted);text-align:center;padding:6px;background:var(--panel);border-top:1px solid var(--hairline);}
</style>
</head>
<body>
<header class="masthead">
  <span class="mh-trophy">🌍</span>
  <span class="mh-title">World Cup 2026 Draft</span>
  <div class="mh-turn" style="--clk:${onClockPlayer.color}">
    <span class="mh-turn-lbl">On the clock</span>
    <span class="mh-turn-name">${dot(onClockPlayer, 22)}${onClockPlayer.name}</span>
  </div>
  <div class="mh-remain"><b>${TOTAL - FILLED}</b>/${TOTAL} teams remaining</div>
</header>
<div class="board-scroll"><div class="board" style="--cols:${N}">${board}</div></div>
<section class="team-strip">
  <div class="strip-by">Available — sorted by overall rank 🏆</div>
  <div class="team-chart">${strip}</div>
</section>
<div class="note">Example board — ${FILLED} of ${TOTAL} picks made (~40%). Snake order, 8 managers × 6 rounds.</div>
</body>
</html>`

const out = resolve(here, '../../../draft-preview.html')
writeFileSync(out, html)
console.log('wrote', out, `(${FILLED}/${TOTAL} filled, ${remaining.length} remaining)`)
