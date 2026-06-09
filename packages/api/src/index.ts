// Worker entry — one Worker serving both the API (/api/*) and the built React app.
// run_worker_first=true (wrangler.toml) routes every request here; anything that
// isn't an API call is delegated to the ASSETS binding, which applies the SPA
// not_found_handling fallback for client-side routes like /l/:id and /admin.
import { Hono } from 'hono'
import type { Env } from './db/types'
import { publicRoutes } from './routes/public'
import { managerRoutes } from './routes/manager'
import { adminRoutes } from './routes/admin'

const app = new Hono<{ Bindings: Env }>()

const api = new Hono<{ Bindings: Env }>()
api.get('/health', (c) => c.json({ ok: true }))
api.route('/', publicRoutes)
api.route('/', managerRoutes)
api.route('/admin', adminRoutes)

app.route('/api', api)

// Everything else → static assets / SPA fallback.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
