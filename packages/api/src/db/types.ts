// Typed row shapes mirroring migrations/0001_init.sql. Hand-maintained: when a
// migration changes a table, update the matching interface here.

export interface TeamRow {
  id: string
  name: string
  abbr: string
  code: string
  rank: number
  conf: string
  grp: string
  star: string | null
  host: number
  pop: number | null
  temp: number | null
  rain: number | null
  dogs: number | null
  age: number | null
  hgt: number | null
  light: number | null
  coffee: number | null
  hue: number | null
}

export type Stage = 'group' | 'R32' | 'R16' | 'QF' | 'SF' | 'Final'

export interface MatchRow {
  id: string
  stage: Stage
  grp: string | null
  home_team_id: string | null
  away_team_id: string | null
  kickoff: string | null
  home_goals: number | null
  away_goals: number | null
  home_pens: number | null
  away_pens: number | null
  status: 'scheduled' | 'finished'
}

export type LeagueMode = 'sequential' | 'autodraft' | 'imported'
export type LeagueStatus = 'setup' | 'drafting' | 'complete'

export interface LeagueRow {
  id: string
  name: string
  mode: LeagueMode
  status: LeagueStatus
  order_json: string | null
  current_overall: number
  created_at: string
}

export interface ManagerRow {
  id: string
  league_id: string
  name: string
  token: string
  seat: number | null
  color: string
}

export interface PickRow {
  id: string
  league_id: string
  overall: number
  manager_id: string
  team_id: string
  created_at: string
}

export interface WishlistRow {
  id: string
  league_id: string
  manager_id: string
  team_id: string
  rank: number
}

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  ADMIN_PASSWORD: string
}
