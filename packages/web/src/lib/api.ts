// Typed fetch wrapper + shared types for the Worker API. The admin password is
// held only in sessionStorage (prompted once) and sent as a header per request.

export const ADMIN_KEY = 'wc-admin-password'
export const getAdminPassword = () => sessionStorage.getItem(ADMIN_KEY) || ''
export const setAdminPassword = (p: string) => sessionStorage.setItem(ADMIN_KEY, p)
export const clearAdminPassword = () => sessionStorage.removeItem(ADMIN_KEY)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function apiFetch<T = unknown>(path: string, opts: RequestInit & { admin?: boolean } = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  if (opts.body) headers.set('Content-Type', 'application/json')
  if (opts.admin) headers.set('X-Admin-Password', getAdminPassword())
  const res = await fetch(`/api${path}`, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error || res.statusText)
  return data as T
}

// ---- shared types (mirror the API responses) ----
export interface Team {
  id: string; name: string; abbr: string; code: string; rank: number
  conf: string; grp: string; star: string | null; host: number
}
export interface Match {
  id: string; stage: string; grp: string | null
  home_team_id: string | null; away_team_id: string | null
  home_goals: number | null; away_goals: number | null
  home_pens: number | null; away_pens: number | null; status: string
}
export interface TeamPoints {
  teamId: string; fantasy: number; qualifyBonus: number; knockoutBonus: number; total: number; stage: string
}
export interface LeaderboardEntry {
  managerId: string; name: string; color: string; seat: number | null
  total: number; advanced: number; deepestStage: string
  squad: Array<{ teamId: string; points: TeamPoints }>
}
export interface LeagueView {
  league: { id: string; name: string; mode: string; status: string; currentOverall: number; order: string[]; nManagers: number }
  managers: Array<{ id: string; name: string; seat: number | null; color: string }>
  picks: Array<{ overall: number; managerId: string; teamId: string }>
  teams: Team[]
  matches: Match[]
  leaderboard: LeaderboardEntry[]
  perTeamPoints: Record<string, TeamPoints>
}
export interface ManagerView extends LeagueView {
  me: { id: string; name: string; seat: number | null; color: string }
  onClock: boolean
  onClockSeat: number | null
  available: Team[]
  wishlist: string[]
}
export interface AdminLeague {
  id: string; name: string; mode: string; status: string; currentOverall: number; picks: number
  managers: Array<{ id: string; name: string; seat: number | null; color: string; link: string }>
}
