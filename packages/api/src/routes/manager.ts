import { Hono } from 'hono'
import type { Env } from '../db/types'
import {
  getLeague, managersOf, picksOf, managerByToken, wishlistOf, allTeams,
} from '../db'
import { buildLeagueView } from '../services/league-view'
import { seatForOverall, N_PICKS, N_MANAGERS } from '../lib/snake'

// Manager-facing routes. The token IS the identity — validated against managers.token.
export const managerRoutes = new Hono<{ Bindings: Env }>()

// GET /api/leagues/:id/me?token=… — squad, whether on the clock, board, available teams.
managerRoutes.get('/leagues/:id/me', async (c) => {
  const leagueId = c.req.param('id')
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'token required' }, 400)

  const me = await managerByToken(c.env.DB, token)
  if (!me || me.league_id !== leagueId) return c.json({ error: 'invalid token' }, 401)

  const view = await buildLeagueView(c.env.DB, leagueId)
  if (!view) return c.json({ error: 'league not found' }, 404)

  const pickedIds = new Set(view.picks.map((p) => p.teamId))
  const available = view.teams.filter((t) => !pickedIds.has(t.id))
  const onClockSeat = view.league.status === 'drafting'
    ? seatForOverall(view.league.currentOverall, N_MANAGERS) : null
  const onClock = onClockSeat != null && me.seat === onClockSeat

  const wishlist = view.league.mode === 'autodraft'
    ? (await wishlistOf(c.env.DB, leagueId, me.id)).map((w) => w.team_id) : []

  return c.json({
    ...view,
    me: { id: me.id, name: me.name, seat: me.seat, color: me.color },
    onClock,
    onClockSeat,
    available,
    wishlist,
  })
})

// POST /api/leagues/:id/pick {token, team_id} — sequential live pick.
managerRoutes.post('/leagues/:id/pick', async (c) => {
  const leagueId = c.req.param('id')
  const body = await c.req.json<{ token?: string; team_id?: string }>()
    .catch(() => ({} as { token?: string; team_id?: string }))
  if (!body.token || !body.team_id) return c.json({ error: 'token and team_id required' }, 400)

  const league = await getLeague(c.env.DB, leagueId)
  if (!league) return c.json({ error: 'league not found' }, 404)
  if (league.mode !== 'sequential') return c.json({ error: 'league is not a sequential draft' }, 400)
  if (league.status !== 'drafting') return c.json({ error: `league is ${league.status}, not drafting` }, 409)

  const me = await managerByToken(c.env.DB, body.token)
  if (!me || me.league_id !== leagueId) return c.json({ error: 'invalid token' }, 401)

  const overall = league.current_overall
  const onClockSeat = seatForOverall(overall, N_MANAGERS)
  if (me.seat !== onClockSeat) return c.json({ error: 'not your turn' }, 409)

  // team must exist and still be available
  const taken = await picksOf(c.env.DB, leagueId)
  if (taken.some((p) => p.team_id === body.team_id)) return c.json({ error: 'team already drafted' }, 409)
  const teams = await allTeams(c.env.DB)
  if (!teams.some((t) => t.id === body.team_id)) return c.json({ error: 'unknown team' }, 400)

  const next = overall + 1
  const nextStatus = next >= N_PICKS ? 'complete' : 'drafting'
  const now = new Date().toISOString()

  try {
    // The (league_id, overall) unique constraint is the optimistic-concurrency guard:
    // a double-submit for the same overall pick fails the batch atomically.
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO picks (id, league_id, overall, manager_id, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), leagueId, overall, me.id, body.team_id, now),
      c.env.DB.prepare('UPDATE leagues SET current_overall = ?, status = ? WHERE id = ? AND current_overall = ?')
        .bind(next, nextStatus, leagueId, overall),
    ])
  } catch (err) {
    return c.json({ error: 'pick conflict — board moved on, refresh', detail: String(err) }, 409)
  }

  return c.json({ ok: true, overall, teamId: body.team_id, leagueStatus: nextStatus })
})

// POST /api/leagues/:id/wishlist {token, team_ids[]} — autodraft only; replaces the list.
managerRoutes.post('/leagues/:id/wishlist', async (c) => {
  const leagueId = c.req.param('id')
  const body = await c.req.json<{ token?: string; team_ids?: string[] }>()
    .catch(() => ({} as { token?: string; team_ids?: string[] }))
  if (!body.token || !Array.isArray(body.team_ids)) return c.json({ error: 'token and team_ids[] required' }, 400)

  const league = await getLeague(c.env.DB, leagueId)
  if (!league) return c.json({ error: 'league not found' }, 404)
  if (league.mode !== 'autodraft') return c.json({ error: 'league is not an autodraft' }, 400)
  if (league.status === 'complete') return c.json({ error: 'draft already resolved' }, 409)

  const me = await managerByToken(c.env.DB, body.token)
  if (!me || me.league_id !== leagueId) return c.json({ error: 'invalid token' }, 401)

  const teams = await allTeams(c.env.DB)
  const validIds = new Set(teams.map((t) => t.id))
  const seen = new Set<string>()
  const clean = body.team_ids.filter((id) => validIds.has(id) && !seen.has(id) && seen.add(id))

  const stmts = [
    c.env.DB.prepare('DELETE FROM wishlist_entries WHERE league_id = ? AND manager_id = ?').bind(leagueId, me.id),
    ...clean.map((teamId, rank) =>
      c.env.DB.prepare(
        'INSERT INTO wishlist_entries (id, league_id, manager_id, team_id, rank) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), leagueId, me.id, teamId, rank)),
  ]
  await c.env.DB.batch(stmts)
  return c.json({ ok: true, count: clean.length })
})
