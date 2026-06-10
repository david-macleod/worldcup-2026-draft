// Generates packages/api/src/db/seed.sql from the canonical team field.
//
// Source of truth is the original client-side teams.js (window.WC_TEAMS). We read
// it once, evaluate it under a tiny `window` shim, and emit:
//   - 48 teams rows (idempotent: ON CONFLICT(id) DO UPDATE — catalog columns only)
//   - the group round-robin match skeleton (12 groups x 6 = 72), status 'scheduled'
//   - the empty knockout skeleton (R32..Final, null teams), filled in by the admin
//
// Matches use ON CONFLICT(id) DO NOTHING so re-seeding never clobbers entered scores.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// teams.js source lives next to this script (copied from the original repo).
const src = readFileSync(resolve(here, 'teams.src.js'), 'utf8')
const window = {}
// eslint-disable-next-line no-new-func
new Function('window', src)(window)
const TEAMS = window.WC_TEAMS

const sqlStr = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const sqlNum = (v) => (v === null || v === undefined ? 'NULL' : Number(v))

// Real 2026 World Cup group-stage kickoffs, keyed by the actual matchup (source:
// official match schedule via ESPN). The groups ARE the real draw, but our
// round-robin skeleton pairs teams in rank order — NOT the order the real schedule
// plays them — so kickoffs are looked up per team-pair, not per slot (a group's two
// same-matchday games can even fall on different days). Times below are wall-clock
// US Eastern (EDT, UTC-4 in June/July); we store them as true UTC instants so the
// web app can render each in the viewer's own timezone.
const SCHEDULE = {
  A: [['mex', 'rsa', '06-11 15:00'], ['kor', 'cze', '06-11 22:00'], ['cze', 'rsa', '06-18 12:00'], ['mex', 'kor', '06-18 23:00'], ['cze', 'mex', '06-24 21:00'], ['rsa', 'kor', '06-24 21:00']],
  B: [['can', 'bih', '06-12 15:00'], ['qat', 'sui', '06-13 15:00'], ['sui', 'bih', '06-18 15:00'], ['can', 'qat', '06-18 18:00'], ['sui', 'can', '06-24 15:00'], ['bih', 'qat', '06-24 15:00']],
  C: [['bra', 'mar', '06-13 18:00'], ['hai', 'sco', '06-13 21:00'], ['sco', 'mar', '06-19 18:00'], ['bra', 'hai', '06-19 21:00'], ['sco', 'bra', '06-24 18:00'], ['mar', 'hai', '06-24 18:00']],
  D: [['usa', 'par', '06-12 21:00'], ['aus', 'tur', '06-14 00:00'], ['usa', 'aus', '06-19 15:00'], ['tur', 'par', '06-20 00:00'], ['tur', 'usa', '06-25 22:00'], ['par', 'aus', '06-25 22:00']],
  E: [['ger', 'cur', '06-14 13:00'], ['civ', 'ecu', '06-14 19:00'], ['ger', 'civ', '06-20 16:00'], ['ecu', 'cur', '06-20 20:00'], ['ecu', 'ger', '06-25 16:00'], ['cur', 'civ', '06-25 16:00']],
  F: [['ned', 'jpn', '06-14 16:00'], ['swe', 'tun', '06-14 22:00'], ['ned', 'swe', '06-20 13:00'], ['tun', 'jpn', '06-21 00:00'], ['jpn', 'swe', '06-25 19:00'], ['tun', 'ned', '06-25 19:00']],
  G: [['bel', 'egy', '06-15 18:00'], ['irn', 'nzl', '06-16 00:00'], ['bel', 'irn', '06-21 15:00'], ['nzl', 'egy', '06-21 21:00'], ['egy', 'irn', '06-26 23:00'], ['nzl', 'bel', '06-26 23:00']],
  H: [['esp', 'cpv', '06-15 13:00'], ['ksa', 'uru', '06-15 18:00'], ['esp', 'ksa', '06-21 12:00'], ['uru', 'cpv', '06-21 18:00'], ['cpv', 'ksa', '06-26 20:00'], ['uru', 'esp', '06-26 20:00']],
  I: [['fra', 'sen', '06-16 15:00'], ['irq', 'nor', '06-16 18:00'], ['fra', 'irq', '06-22 17:00'], ['nor', 'sen', '06-22 20:00'], ['nor', 'fra', '06-26 15:00'], ['sen', 'irq', '06-26 15:00']],
  J: [['arg', 'alg', '06-16 21:00'], ['aut', 'jor', '06-17 00:00'], ['arg', 'aut', '06-22 13:00'], ['jor', 'alg', '06-22 23:00'], ['alg', 'aut', '06-27 22:00'], ['jor', 'arg', '06-27 22:00']],
  K: [['por', 'cod', '06-17 13:00'], ['uzb', 'col', '06-17 22:00'], ['por', 'uzb', '06-23 13:00'], ['col', 'cod', '06-23 22:00'], ['col', 'por', '06-27 19:30'], ['cod', 'uzb', '06-27 19:30']],
  L: [['eng', 'cro', '06-17 16:00'], ['gha', 'pan', '06-17 19:00'], ['eng', 'gha', '06-23 16:00'], ['pan', 'cro', '06-23 19:00'], ['pan', 'eng', '06-27 17:00'], ['cro', 'gha', '06-27 17:00']],
}
// 'MM-DD HH:MM' US-Eastern wall-clock -> UTC ISO instant (EDT = UTC-4).
const etToUtc = (et) => {
  const [md, hm] = et.split(' ')
  return new Date(`2026-${md}T${hm}:00-04:00`).toISOString().replace('.000Z', 'Z')
}
// Flatten into a per-group lookup keyed by the sorted team-id pair -> UTC instant.
const pairKey = (a, b) => [a, b].sort().join('|')
const DATE_OF = {}
for (const [g, games] of Object.entries(SCHEDULE)) {
  DATE_OF[g] = {}
  for (const [a, b, et] of games) DATE_OF[g][pairKey(a, b)] = etToUtc(et)
}
// Knockout date windows; each stage's slots are spread evenly across its window.
const KO_DATES = {
  R32: ['2026-06-28', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'],
  R16: ['2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07'],
  QF: ['2026-07-09', '2026-07-10', '2026-07-11'],
  SF: ['2026-07-14', '2026-07-15'],
  Final: ['2026-07-19'],
}

const lines = []
lines.push('-- AUTO-GENERATED by scripts/gen-seed.mjs — do not edit by hand.')
lines.push('-- Idempotent: teams upsert catalog columns; matches are inserted once and')
lines.push('-- thereafter only their kickoff is refreshed (DO UPDATE SET kickoff) — entered')
lines.push('-- scores/status survive a re-seed, while dates backfill into existing rows.')
lines.push('PRAGMA foreign_keys = ON;')
lines.push('')

// ---- teams ----
const cols = ['id','name','abbr','code','rank','conf','grp','star','host',
  'pop','temp','rain','dogs','age','hgt','light','coffee','hue']
lines.push(`-- 48 teams`)
for (const t of TEAMS) {
  const vals = [
    sqlStr(t.id), sqlStr(t.name), sqlStr(t.abbr), sqlStr(t.code), sqlNum(t.rank),
    sqlStr(t.conf), sqlStr(t.group), sqlStr(t.star), t.host ? 1 : 0,
    sqlNum(t.pop), sqlNum(t.temp), sqlNum(t.rain), sqlNum(t.dogs), sqlNum(t.age),
    sqlNum(t.hgt), sqlNum(t.light), sqlNum(t.coffee), sqlNum(t.hue),
  ]
  lines.push(
    `INSERT INTO teams (${cols.join(',')}) VALUES (${vals.join(',')}) ` +
    `ON CONFLICT(id) DO UPDATE SET ` +
    cols.slice(1).map((c) => `${c}=excluded.${c}`).join(', ') + ';'
  )
}
lines.push('')

// ---- group match skeleton (round-robin within each group) ----
const groupsOf = {}
for (const t of TEAMS) (groupsOf[t.group] ||= []).push(t)
const GROUPS = 'ABCDEFGHIJKL'.split('')
lines.push('-- group-stage round-robin skeleton (72 matches), scores entered by admin')
for (const g of GROUPS) {
  const gt = (groupsOf[g] || []).sort((a, b) => (a.rank || 99) - (b.rank || 99))
  let n = 0
  for (let i = 0; i < gt.length; i++)
    for (let j = i + 1; j < gt.length; j++) {
      n++
      const id = `G-${g}-${n}`
      const kickoff = DATE_OF[g]?.[pairKey(gt[i].id, gt[j].id)] ?? null
      if (!kickoff) throw new Error(`no scheduled date for ${gt[i].id} v ${gt[j].id} in group ${g}`)
      lines.push(
        `INSERT INTO matches (id,stage,grp,home_team_id,away_team_id,kickoff,status) VALUES (` +
        `${sqlStr(id)},'group',${sqlStr(g)},${sqlStr(gt[i].id)},${sqlStr(gt[j].id)},${sqlStr(kickoff)},'scheduled') ` +
        `ON CONFLICT(id) DO UPDATE SET kickoff=excluded.kickoff;`
      )
    }
}
lines.push('')

// ---- knockout skeleton (teams assigned later by admin) ----
lines.push('-- knockout skeleton — teams (and scores) assigned by the admin as the bracket fills')
const KO = [['R32', 16], ['R16', 8], ['QF', 4], ['SF', 2], ['Final', 1]]
for (const [stage, count] of KO) {
  const window = KO_DATES[stage] || []
  for (let i = 1; i <= count; i++) {
    const id = `${stage}-${i}`
    // Spread this stage's slots evenly across its date window.
    const kickoff = window.length ? window[Math.floor(((i - 1) * window.length) / count)] : null
    lines.push(
      `INSERT INTO matches (id,stage,grp,home_team_id,away_team_id,kickoff,status) VALUES (` +
      `${sqlStr(id)},${sqlStr(stage)},NULL,NULL,NULL,${sqlStr(kickoff)},'scheduled') ` +
      `ON CONFLICT(id) DO UPDATE SET kickoff=excluded.kickoff;`
    )
  }
}
lines.push('')

writeFileSync(resolve(here, '../src/db/seed.sql'), lines.join('\n'))
writeFileSync(resolve(here, '../src/db/teams.json'), JSON.stringify(TEAMS, null, 0))
console.log(`seed.sql written: ${TEAMS.length} teams, ${GROUPS.length * 6} group matches, 31 knockout slots`)
