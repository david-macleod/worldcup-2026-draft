import { useQuery } from '@tanstack/react-query'
import { apiFetch, type LeagueView } from '../lib/api'
import { ResultsView } from '../components/results'

export function PublicLeague({ leagueId }: { leagueId: string }) {
  const q = useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => apiFetch<LeagueView>(`/leagues/${leagueId}`),
    refetchInterval: 8000,
  })

  if (q.isLoading) return <div className="results"><p className="empty">Loading league…</p></div>
  if (q.isError) return <div className="results"><p className="empty">{(q.error as Error).message}</p></div>

  return <ResultsView view={q.data!} />
}
