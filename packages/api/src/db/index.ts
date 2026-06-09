// Thin typed query helpers over D1 prepared statements — no ORM.
import type {
  TeamRow, MatchRow, LeagueRow, ManagerRow, PickRow, WishlistRow,
} from './types'

export async function allTeams(db: D1Database): Promise<TeamRow[]> {
  const { results } = await db.prepare('SELECT * FROM teams ORDER BY rank ASC').all<TeamRow>()
  return results ?? []
}

export async function allMatches(db: D1Database): Promise<MatchRow[]> {
  const { results } = await db.prepare('SELECT * FROM matches').all<MatchRow>()
  return results ?? []
}

export async function getMatch(db: D1Database, id: string): Promise<MatchRow | null> {
  return db.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<MatchRow>()
}

export async function getLeague(db: D1Database, id: string): Promise<LeagueRow | null> {
  return db.prepare('SELECT * FROM leagues WHERE id = ?').bind(id).first<LeagueRow>()
}

export async function allLeagues(db: D1Database): Promise<LeagueRow[]> {
  const { results } = await db.prepare('SELECT * FROM leagues ORDER BY created_at DESC').all<LeagueRow>()
  return results ?? []
}

export async function managersOf(db: D1Database, leagueId: string): Promise<ManagerRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM managers WHERE league_id = ? ORDER BY seat IS NULL, seat ASC')
    .bind(leagueId).all<ManagerRow>()
  return results ?? []
}

export async function managerByToken(db: D1Database, token: string): Promise<ManagerRow | null> {
  return db.prepare('SELECT * FROM managers WHERE token = ?').bind(token).first<ManagerRow>()
}

export async function picksOf(db: D1Database, leagueId: string): Promise<PickRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM picks WHERE league_id = ? ORDER BY overall ASC')
    .bind(leagueId).all<PickRow>()
  return results ?? []
}

export async function wishlistOf(db: D1Database, leagueId: string, managerId: string): Promise<WishlistRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM wishlist_entries WHERE league_id = ? AND manager_id = ? ORDER BY rank ASC')
    .bind(leagueId, managerId).all<WishlistRow>()
  return results ?? []
}

export async function allWishlists(db: D1Database, leagueId: string): Promise<WishlistRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM wishlist_entries WHERE league_id = ? ORDER BY manager_id, rank ASC')
    .bind(leagueId).all<WishlistRow>()
  return results ?? []
}
