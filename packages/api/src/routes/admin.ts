import { Hono } from 'hono'
import type { Env, LeagueMode } from '../db/types'
import {
  getLeague, managersOf, picksOf, allTeams, allLeagues, allMatches, allWishlists, getMatch,
} from '../db'
import { adminAuth } from '../middleware/admin-auth'
import { resolveAutodraft } from '../services/autodraft'
import { MANAGER_COLORS } from '../lib/colors'
import { newId } from '../lib/id'
import { N_MANAGERS, N_ROUNDS, N_PICKS, seatForOverall } from '../lib/snake'

export const adminRoutes = new Hono<{ Bindings: Env }>()
adminRoutes.use('*', adminAuth)

function managerLink(leagueId: string, token: string) {
  return `/l/${leagueId}/m/${token}`
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
  const body = await c.req.json<{ name?: string; mode?: LeagueMode; managers?: Array<{ name: string }> }>()
    .catch(() => ({} as any))
  const { name, mode, managers } = body
  if (!name || (mode !== 'sequential' && mode !== 'autodraft')) {
    return c.json({ error: 'name and mode (sequential|autodraft) required; use /import for imported' }, 400)
  }
  if (!Array.isArray(managers) || managers.length !== N_MANAGERS) {
    return c.json({ error: `exactly ${N_MANAGERS} managers required` }, 400)
  }

  const leagueId = newId()
  const now = new Date().toISOString()
  const created = managers.map((m, i) => ({
    id: newId(), name: String(m.name || `Manager ${i + 1}`),
    token: newId(), color: MANAGER_COLORS[i % MANAGER_COLORS.length],
  }))

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO leagues (id, name, mode, status, current_overall, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).bind(leagueId, name, mode, 'setup', now),
    ...created.map((m) =>
      c.env.DB.prepare('INSERT INTO managers (id, league_id, name, token, color) VALUES (?, ?, ?, ?, ?)')
        .bind(m.id, leagueId, m.name, m.token, m.color)),
  ])

  return c.json({
    ok: true,
    leagueId,
    managers: created.map((m) => ({ id: m.id, name: m.name, token: m.token, link: managerLink(leagueId, m.token) })),
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
  if (order.length !== N_MANAGERS) return c.json({ error: 'order not locked' }, 409)

  const [teams, wishRows] = await Promise.all([allTeams(c.env.DB), allWishlists(c.env.DB, leagueId)])
  const wishlists: Record<string, string[]> = {}
  for (const w of wishRows) (wishlists[w.manager_id] ||= []).push(w.team_id)

  const resolved = resolveAutodraft(order, wishlists, teams.map((t) => ({ id: t.id, rank: t.rank })))
  const now = new Date().toISOString()

  await c.env.DB.batch([
    ...resolved.map((p) =>
      c.env.DB.prepare(
        'INSERT INTO picks (id, league_id, overall, manager_id, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), leagueId, p.overall, p.managerId, p.teamId, now)),
    c.env.DB.prepare('UPDATE leagues SET status = ?, current_overall = ? WHERE id = ?')
      .bind('complete', N_PICKS, leagueId),
  ])

  return c.json({ ok: true, picks: resolved.length })
})

// POST /api/admin/leagues/import — pre-populate a finished draft from an offline mapping.
adminRoutes.post('/leagues/import', async (c) => {
  const body = await c.req.json<{ name?: string; squads?: Array<{ manager: { name: string }; team_ids: string[] }> }>()
    .catch(() => ({} as any))
  const { name, squads } = body
  if (!name || !Array.isArray(squads)) return c.json({ error: 'name and squads[] required' }, 400)
  if (squads.length !== N_MANAGERS) return c.json({ error: `exactly ${N_MANAGERS} managers required` }, 400)
  if (!squads.every((s) => Array.isArray(s.team_ids) && s.team_ids.length === N_ROUNDS)) {
    return c.json({ error: `each manager must own exactly ${N_ROUNDS} teams` }, 400)
  }

  const flat = squads.flatMap((s) => s.team_ids)
  if (flat.length !== N_PICKS) return c.json({ error: `expected ${N_PICKS} team ids, got ${flat.length}` }, 400)
  if (new Set(flat).size !== N_PICKS) return c.json({ error: 'duplicate team ids in import' }, 400)
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
  for (let overall = 0; overall < N_PICKS; overall++) {
    const seat = seatForOverall(overall)
    const round = Math.floor(overall / N_MANAGERS)
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
      'INSERT INTO leagues (id, name, mode, status, order_json, current_overall, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(leagueId, name, 'imported', 'complete', JSON.stringify(order), N_PICKS, now),
    ...created.map((m, seat) =>
      c.env.DB.prepare('INSERT INTO managers (id, league_id, name, token, seat, color) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(m.id, leagueId, m.name, m.token, seat, m.color)),
    ...pickStmts,
  ])

  return c.json({
    ok: true, leagueId,
    managers: created.map((m) => ({ id: m.id, name: m.name, token: m.token, link: managerLink(leagueId, m.token) })),
  }, 201)
})

// POST /api/admin/matches/:id/result — enter/correct a scoreline (and assign knockout teams).
adminRoutes.post('/matches/:id/result', async (c) => {
  const id = c.req.param('id')
  type ResultBody = {
    home_goals?: number; away_goals?: number; home_pens?: number; away_pens?: number
    home_team_id?: string; away_team_id?: string
  }
  const body = await c.req.json<ResultBody>().catch(() => ({} as ResultBody))
  const match = await getMatch(c.env.DB, id)
  if (!match) return c.json({ error: 'match not found' }, 404)
  if (typeof body.home_goals !== 'number' || typeof body.away_goals !== 'number') {
    return c.json({ error: 'home_goals and away_goals (numbers) required' }, 400)
  }

  // Knockout fixtures may need their teams assigned as the bracket fills.
  const homeTeam = body.home_team_id ?? match.home_team_id
  const awayTeam = body.away_team_id ?? match.away_team_id
  if (!homeTeam || !awayTeam) return c.json({ error: 'match has no teams assigned; pass home_team_id/away_team_id' }, 400)

  const pens = body.home_goals === body.away_goals && match.stage !== 'group'
  await c.env.DB.prepare(
    'UPDATE matches SET home_team_id=?, away_team_id=?, home_goals=?, away_goals=?, home_pens=?, away_pens=?, status=? WHERE id=?',
  ).bind(
    homeTeam, awayTeam, body.home_goals, body.away_goals,
    pens ? (body.home_pens ?? null) : null, pens ? (body.away_pens ?? null) : null,
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
      managers: managers.map((m) => ({ id: m.id, name: m.name, seat: m.seat, color: m.color, link: managerLink(lg.id, m.token) })),
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

// GET /api/admin/matches — the shared tournament grid for result entry.
adminRoutes.get('/matches', async (c) => {
  const matches = await allMatches(c.env.DB)
  return c.json({ matches })
})
