import type { MiddlewareHandler } from 'hono'
import type { Env } from '../db/types'

// Gate admin routes behind a single shared password sent in the X-Admin-Password
// header (checked against the ADMIN_PASSWORD secret). One privileged role; no accounts.
export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const supplied = c.req.header('X-Admin-Password')
  const expected = c.env.ADMIN_PASSWORD
  if (!expected) return c.json({ error: 'ADMIN_PASSWORD not configured' }, 500)
  if (supplied !== expected) return c.json({ error: 'unauthorized' }, 401)
  await next()
}
