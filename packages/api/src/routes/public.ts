import { Hono } from 'hono'
import type { Env } from '../db/types'
import { buildLeagueView } from '../services/league-view'

// Public, no-auth read model for a league: standings, squads, results feed.
export const publicRoutes = new Hono<{ Bindings: Env }>()

publicRoutes.get('/leagues/:id', async (c) => {
  const view = await buildLeagueView(c.env.DB, c.req.param('id'))
  if (!view) return c.json({ error: 'league not found' }, 404)
  return c.json(view)
})
