import { Hono } from 'hono'
import type { Env, LeagueMode } from '../db/types'
import {
  getLeague, managersOf, picksOf, allTeams, allLeagues, allMatches, allWishlists, getMatch,
} from '../db'
import { adminAuth } from '../middleware/admin-auth'
import { resolveAutodraft } from '../services/autodraft'
import { MANAGER_COLORS } from '../lib/colors'
import { newId } from '../lib/id'
import {
  seatForOverall, picksFor, validateLeagueSize, N_ROUNDS, MIN_MANAGERS, MAX_MANAGERS,
} from '../lib/snake'
import { applyBracket } from '../services/bracket'

export const adminRoutes = new Hono<{ Bindings: Env }>()
adminRoutes.use('*', adminAuth)

// URL-safe slug of a manager name, for a friendlier link. The token (last
// segment) remains the actual identity; the slug is decorative.
function slugify(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'manager'
}

// Manager link: /l/{leagueId}/m/{token}/{name-slug} — name is visible, token authenticates.
function managerLink(leagueId: string, token: string, name: string) {
  return `/l/${leagueId}/m/${token}/${slugify(name)}`
}

// Fisher–Yates shuffle (Worker runtime — Math.random is available here).
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// POST /api/admin/leagues — create a sequential|autodraft league + N managers + tokens.
adminRoutes.post('/leagues', async (c) => {
  const body = await c.req.json<{ name?: string; mode?: LeagueMode; rounds?: number; managers?: Array<{ name: string }>; finalDouble?: boolean; thirdPlaceScores?: boolean }>()
    .catch(() => ({} as any))
  const { name, mode, managers } = body
  const rounds = body.rounds ?? N_ROUNDS
  const finalDouble = body.finalDouble ? 1 : 0
  const thirdPlaceScores = body.thirdPlaceScores ? 1 : 0
  if (!name || (mode !== 'sequential' && mode !== 'autodraft')) {
    return c.json({ error: 'name and mode (sequential|autodraft) required; use /import for imported' }, 400)
  }
  if (!Array.isArray(managers) || managers.length < MIN_MANAGERS || managers.length > MAX_MANAGERS) {
    return c.json({ error: `between ${MIN_MANAGERS} and ${MAX_MANAGERS} managers required` }, 400)
  }
  const nManagers = managers.length
  const sizeErr = validateLeagueSize(nManagers, rounds)
  if (sizeErr) return c.json({ error: sizeErr }, 400)
  if (managers.some((m) => !m.name || !String(m.name).trim())) {
    return c.json({ error: 'every manager needs a name' }, 400)
  }

  const leagueId = newId()
  const now = new Date().toISOString()
  const created = managers.map((m, i) => ({
    id: newId(), name: String(m.name).trim(),
    token: newId(), color: MANAGER_COLORS[i % MANAGER_COLORS.length],
  }))

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO leagues (id, name, mode, status, current_overall, created_at, n_managers, n_rounds, final_double, third_place_scores) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
    ).bind(leagueId, name, mode, 'setup', now, nManagers, rounds, finalDouble, thirdPlaceScores),
    ...created.map((m) =>
      c.env.DB.prepare('INSERT INTO managers (id, league_id, name, token, color) VALUES (?, ?, ?, ?, ?)')
        .bind(m.id, leagueId, m.name, m.token, m.color)),
  ])

  return c.json({
    ok: true,
    leagueId,
    nManagers, nRounds: rounds,
    managers: created.map((m) => ({ id: m.id, name: m.name, token: m.token, link: managerLink(leagueId, m.token, m.name) })),
  }, 201)
})

// POST /api/admin/leagues/:id/start — spin (shuffle) or accept a manual order, lock it.
adminRoutes.post('/leagues/:id/start', async (c) => {
  const leagueId = c.req.param('id')
  const body = await c.req.json<{ order?: string[] }>().catch(() => ({} as { order?: string[] }))
  const league = await getLeague(c.env.DB, leagueId)
  if (!league) return c.json({ error: 'league not found' }, 404)
  if (league.mode === 'imported') return c.json({ error: 'imported leagues do not draft' }, 400)
  if (league.status !== 'setup') return c.json({ error: `league already ${league.status}` }, 409)

  const managers = await managersOf(c.env.DB, leagueId)
  const ids = managers.map((m) => m.id)

  let order: string[]
  if (body.order) {
    const same = body.order.length === ids.length && new Set(body.order).size === ids.length
      && body.order.every((id) => ids.includes(id))
    if (!same) return c.json({ error: 'order must be a permutation of this league\'s manager ids' }, 400)
    order = body.order
  } else {
    order = shuffle(ids)
  }

  await c.env.DB.batch([
    ...order.map((mid, seat) =>
      c.env.DB.prepare('UPDATE managers SET seat = ? WHERE id = ?').bind(seat, mid)),
    c.env.DB.prepare('UPDATE leagues SET order_json = ?, status = ?, current_overall = 0 WHERE id = ?')
      .bind(JSON.stringify(order), 'drafting', leagueId),
  ])

  return c.json({ ok: true, order, onClock: order[seatForOverall(0)] })
})

// POST /api/admin/leagues/:id/resolve — autodraft: run the snake, bulk-insert 48 picks.
adminRoutes.post('/leagues/:id/resolve', async (c) => {
  const leagueId = c.req.param('id')
  const league = await getLeague(c.env.DB, leagueId)
  if (!league) return c.json({ error: 'league not found' }, 404)
  if (league.mode !== 'autodraft') return c.json({ error: 'not an autodraft league' }, 400)
  if (league.status !== 'drafting') return c.json({ error: `league is ${league.status}; start it first` }, 409)

  const order: string[] = league.order_json ? JSON.parse(league.order_json) : []
  if (order.length !== league.n_managers) return c.json({ error: 'order not locked' }, 409)

  const [teams, wishRows] = await Promise.all([allTeams(c.env.DB), allWishlists(c.env.DB, leagueId)])
  const wishlists: Record<string, string[]> = {}
  for (const w of wishRows) (wishlists[w.manager_id] ||= []).push(w.team_id)

  const resolved = resolveAutodraft(
    order, wishlists, teams.map((t) => ({ id: t.id, rank: t.rank })), league.n_managers, league.n_rounds)
  const now = new Date().toISOString()

  await c.env.DB.batch([
    ...resolved.map((p) =>
      c.env.DB.prepare(
        'INSERT INTO picks (id, league_id, overall, manager_id, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), leagueId, p.overall, p.managerId, p.teamId, now)),
    c.env.DB.prepare('UPDATE leagues SET status = ?, current_overall = ? WHERE id = ?')
      .bind('complete', resolved.length, leagueId),
  ])

  return c.json({ ok: true, picks: resolved.length })
})

// POST /api/admin/leagues/import — pre-populate a finished draft from an offline mapping.
adminRoutes.post('/leagues/import', async (c) => {
  const body = await c.req.json<{ name?: string; squads?: Array<{ manager: { name: string }; team_ids: string[] }> }>()
    .catch(() => ({} as any))
  const { name, squads } = body
  if (!name || !Array.isArray(squads)) return c.json({ error: 'name and squads[] required' }, 400)
  if (squads.length < MIN_MANAGERS || squads.length > MAX_MANAGERS) {
    return c.json({ error: `between ${MIN_MANAGERS} and ${MAX_MANAGERS} managers required` }, 400)
  }
  const nManagers = squads.length
  const nRounds = Array.isArray(squads[0]?.team_ids) ? squads[0].team_ids.length : 0
  if (!squads.every((s) => Array.isArray(s.team_ids) && s.team_ids.length === nRounds)) {
    return c.json({ error: 'every manager must own the same number of teams' }, 400)
  }
  const sizeErr = validateLeagueSize(nManagers, nRounds)
  if (sizeErr) return c.json({ error: sizeErr }, 400)

  const total = picksFor(nManagers, nRounds)
  const flat = squads.flatMap((s) => s.team_ids)
  if (new Set(flat).size !== total) return c.json({ error: 'duplicate team ids in import' }, 400)
  const teams = await allTeams(c.env.DB)
  const validIds = new Set(teams.map((t) => t.id))
  const unknown = flat.filter((id) => !validIds.has(id))
  if (unknown.length) return c.json({ error: `unknown team ids: ${unknown.join(', ')}` }, 400)

  const leagueId = newId()
  const now = new Date().toISOString()
  const created = squads.map((s, i) => ({
    id: newId(), name: String(s.manager?.name || `Manager ${i + 1}`),
    token: newId(), color: MANAGER_COLORS[i % MANAGER_COLORS.length], teamIds: s.team_ids,
  }))
  // Synthesise a snake order_json purely for board rendering (squads are the truth).
  const order = created.map((m) => m.id)

  const pickStmts = []
  // Lay picks out in snake order so the board renders sensibly: round r, seat by snake.
  for (let overall = 0; overall < total; overall++) {
    const seat = seatForOverall(overall, nManagers)
    const round = Math.floor(overall / nManagers)
    const m = created[seat]
    const teamId = m.teamIds[round]
    pickStmts.push(
      c.env.DB.prepare(
        'INSERT INTO picks (id, league_id, overall, manager_id, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), leagueId, overall, m.id, teamId, now),
    )
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO leagues (id, name, mode, status, order_json, current_overall, created_at, n_managers, n_rounds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(leagueId, name, 'imported', 'complete', JSON.stringify(order), total, now, nManagers, nRounds),
    ...created.map((m, seat) =>
      c.env.DB.prepare('INSERT INTO managers (id, league_id, name, token, seat, color) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(m.id, leagueId, m.name, m.token, seat, m.color)),
    ...pickStmts,
  ])

  return c.json({
    ok: true, leagueId, nManagers, nRounds,
    managers: created.map((m) => ({ id: m.id, name: m.name, token: m.token, link: managerLink(leagueId, m.token, m.name) })),
  }, 201)
})

// POST /api/admin/matches/:id/result — enter/correct a scoreline.
// Body: h90/a90 = goals at 90' (always required — drives GOAL points). h120/a120 = final
// score after extra time (optional; omit if the match didn't go to ET). home_pens/away_pens
// for a knockout decided on penalties. The stored final (home_goals/away_goals) is h120 if
// given else h90, and is what decides win/draw/loss + who advances. Knockout teams are
// derived from the bracket, so none are passed or required here.
adminRoutes.post('/matches/:id/result', async (c) => {
  const id = c.req.param('id')
  type ResultBody = {
    h90?: number; a90?: number; h120?: number; a120?: number; home_pens?: number; away_pens?: number
    // legacy single-score fields (group entry / older clients)
    home_goals?: number; away_goals?: number
  }
  const body = await c.req.json<ResultBody>().catch(() => ({} as ResultBody))
  const match = await getMatch(c.env.DB, id)
  if (!match) return c.json({ error: 'match not found' }, 404)

  const h90 = body.h90 ?? body.home_goals
  const a90 = body.a90 ?? body.away_goals
  if (typeof h90 !== 'number' || typeof a90 !== 'number') {
    return c.json({ error: 'h90 and a90 (90-minute goals, numbers) required' }, 400)
  }
  const wentToET = typeof body.h120 === 'number' && typeof body.a120 === 'number'
  const homeFinal = wentToET ? body.h120! : h90
  const awayFinal = wentToET ? body.a120! : a90
  // penalties only matter when the final score is level in a knockout
  const drawn = homeFinal === awayFinal && match.stage !== 'group'

  await c.env.DB.prepare(
    'UPDATE matches SET home_goals=?, away_goals=?, home_g90=?, away_g90=?, home_pens=?, away_pens=?, status=? WHERE id=?',
  ).bind(
    homeFinal, awayFinal, h90, a90,
    drawn ? (body.home_pens ?? null) : null, drawn ? (body.away_pens ?? null) : null,
    'finished', id,
  ).run()

  return c.json({ ok: true, id })
})

// GET /api/admin/leagues — dashboard list, with manager links for out-of-band sharing.
adminRoutes.get('/leagues', async (c) => {
  const leagues = await allLeagues(c.env.DB)
  const out = []
  for (const lg of leagues) {
    const [managers, picks] = await Promise.all([managersOf(c.env.DB, lg.id), picksOf(c.env.DB, lg.id)])
    out.push({
      id: lg.id, name: lg.name, mode: lg.mode, status: lg.status,
      currentOverall: lg.current_overall, picks: picks.length,
      nManagers: lg.n_managers, nRounds: lg.n_rounds, totalPicks: lg.n_managers * lg.n_rounds,
      finalDouble: !!lg.final_double, thirdPlaceScores: !!lg.third_place_scores,
      managers: managers.map((m) => ({ id: m.id, name: m.name, seat: m.seat, color: m.color, link: managerLink(lg.id, m.token, m.name) })),
    })
  }
  return c.json({ leagues: out })
})

// DELETE /api/admin/leagues/:id — remove a league; managers/picks/wishlists cascade.
adminRoutes.delete('/leagues/:id', async (c) => {
  const leagueId = c.req.param('id')
  const league = await getLeague(c.env.DB, leagueId)
  if (!league) return c.json({ error: 'league not found' }, 404)
  await c.env.DB.prepare('DELETE FROM leagues WHERE id = ?').bind(leagueId).run()
  return c.json({ ok: true })
})

// PATCH /api/admin/leagues/:id — rename a league and/or toggle its scoring options.
// Any provided field is updated; all are optional but at least one is required.
adminRoutes.patch('/leagues/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; finalDouble?: boolean; thirdPlaceScores?: boolean }>()
    .catch(() => ({} as { name?: string; finalDouble?: boolean; thirdPlaceScores?: boolean }))
  const sets: string[] = []
  const vals: (string | number)[] = []
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return c.json({ error: 'name cannot be blank' }, 400)
    sets.push('name = ?'); vals.push(name)
  }
  if (body.finalDouble !== undefined) { sets.push('final_double = ?'); vals.push(body.finalDouble ? 1 : 0) }
  if (body.thirdPlaceScores !== undefined) { sets.push('third_place_scores = ?'); vals.push(body.thirdPlaceScores ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400)
  const { meta } = await c.env.DB.prepare(`UPDATE leagues SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run()
  if (!meta.changes) return c.json({ error: 'league not found' }, 404)
  return c.json({ ok: true })
})

// PATCH /api/admin/managers/:id — rename a manager.
adminRoutes.patch('/managers/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }))
  const name = body.name?.trim()
  if (!name) return c.json({ error: 'name required' }, 400)
  const { meta } = await c.env.DB.prepare('UPDATE managers SET name = ? WHERE id = ?').bind(name, id).run()
  if (!meta.changes) return c.json({ error: 'manager not found' }, 404)
  return c.json({ ok: true })
})

// GET /api/admin/matches — the shared tournament grid for result entry. Knockout
// matchups are filled in from the bracket so each row shows who actually plays.
adminRoutes.get('/matches', async (c) => {
  const [teams, raw] = await Promise.all([allTeams(c.env.DB), allMatches(c.env.DB)])
  return c.json({ matches: applyBracket(teams, raw) })
})
