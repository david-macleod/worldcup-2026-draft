// Assembles the read model for a league: status, managers, the pick board, the
// computed leaderboard, plus the shared tournament teams/results. Computed on
// read — points are never persisted.
import type { Env } from '../db/types'
import {
  getLeague, managersOf, picksOf, allTeams, allMatches,
} from '../db'
import { computeLeaderboard } from './scoring'

export async function buildLeagueView(db: D1Database, leagueId: string) {
  const league = await getLeague(db, leagueId)
  if (!league) return null

  const [managers, picks, teams, matches] = await Promise.all([
    managersOf(db, leagueId),
    picksOf(db, leagueId),
    allTeams(db),
    allMatches(db),
  ])

  const { leaderboard, perTeamPoints } = computeLeaderboard(teams, matches, picks, managers)

  // seat -> manager id, for board rendering
  const order: string[] = league.order_json ? JSON.parse(league.order_json) : []

  return {
    league: {
      id: league.id,
      name: league.name,
      mode: league.mode,
      status: league.status,
      currentOverall: league.current_overall,
      order,
      nManagers: league.n_managers,
      nRounds: league.n_rounds,
      totalPicks: league.n_managers * league.n_rounds,
    },
    managers: managers.map((m) => ({ id: m.id, name: m.name, seat: m.seat, color: m.color })),
    picks: picks.map((p) => ({ overall: p.overall, managerId: p.manager_id, teamId: p.team_id })),
    teams,
    matches,
    leaderboard,
    perTeamPoints,
  }
}
