import { Hono } from 'hono'
import type { Env } from '../db/types'
import { buildLeagueView } from '../services/league-view'
import { allTeams, allMatches } from '../db'

// Public, no-auth read model for a league: standings, squads, results feed.
export const publicRoutes = new Hono<{ Bindings: Env }>()

publicRoutes.get('/leagues/:id', async (c) => {
  const view = await buildLeagueView(c.env.DB, c.req.param('id'))
  if (!view) return c.json({ error: 'league not found' }, 404)
  return c.json(view)
})

// The whole tournament: 48 teams + every fixture. Drives the public /fixtures
// page, which renders group tables and the knockout bracket.
publicRoutes.get('/fixtures', async (c) => {
  const [teams, matches] = await Promise.all([allTeams(c.env.DB), allMatches(c.env.DB)])
  return c.json({ teams, matches })
})
