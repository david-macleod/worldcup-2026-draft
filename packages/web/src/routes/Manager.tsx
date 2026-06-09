import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiFetch, type ManagerView, type Team } from '../lib/api'
import { Board, Leaderboard, Flag, teamMap } from '../components/ui'

export function Manager({ leagueId, token }: { leagueId: string; token: string }) {
  const qc = useQueryClient()
  const key = ['me', leagueId, token]
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<ManagerView>(`/leagues/${leagueId}/me?token=${encodeURIComponent(token)}`),
    refetchInterval: 6000,
  })

  if (q.isLoading) return <div className="wrap"><p className="muted">Loading your draft room…</p></div>
  if (q.isError) return <div className="wrap"><p className="err">{(q.error as Error).message}</p></div>
  const v = q.data!

  const refresh = () => qc.invalidateQueries({ queryKey: key })

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <h1>{v.league.name}</h1>
          <span className="sub">you are <b style={{ color: v.me.color }}>{v.me.name}</b> · {v.league.status}</span>
        </div>
        <div className="crumbs"><Link to="/l/$leagueId" params={{ leagueId }}>public standings</Link></div>
      </div>

      {v.league.status === 'drafting' && v.league.mode === 'sequential' && (
        <SequentialDraft view={v} leagueId={leagueId} token={token} onPicked={refresh} />
      )}
      {v.league.status !== 'complete' && v.league.mode === 'autodraft' && (
        <WishlistEditor view={v} leagueId={leagueId} token={token} onSaved={refresh} />
      )}

      {v.league.status === 'complete' && (
        <div className="panel">
          <h2>Final standings</h2>
          <Leaderboard entries={v.leaderboard} teams={v.teams} highlight={v.me.id} />
        </div>
      )}

      <div className="panel">
        <h2>Draft board</h2>
        <Board view={v} />
      </div>
    </div>
  )
}

function SequentialDraft({ view, leagueId, token, onPicked }: {
  view: ManagerView; leagueId: string; token: string; onPicked: () => void
}) {
  const [err, setErr] = useState('')
  const pick = useMutation({
    mutationFn: (teamId: string) =>
      apiFetch(`/leagues/${leagueId}/pick`, { method: 'POST', body: JSON.stringify({ token, team_id: teamId }) }),
    onSuccess: () => { setErr(''); onPicked() },
    onError: (e: Error) => setErr(e.message),
  })
  const picksLeft = view.onClockSeat == null ? 0 : (() => {
    // how many picks until it's my turn (informational)
    let count = 0
    for (let o = view.league.currentOverall; o < 48; o++) {
      const n = view.league.nManagers
      const round = Math.floor(o / n), pos = o % n
      const seat = round % 2 === 0 ? pos : n - 1 - pos
      if (seat === view.me.seat) break
      count++
    }
    return count
  })()

  return (
    <>
      <div className="upturn">
        {view.onClock
          ? <span className="big">🟢 You're up — make your pick</span>
          : <span className="waiting">Waiting… {picksLeft} pick{picksLeft === 1 ? '' : 's'} until your turn</span>}
        <span className="pill on">overall #{view.league.currentOverall + 1} / 48</span>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="panel">
        <h2>Available teams</h2>
        <p className="sec-sub">{view.available.length} left · sorted by FIFA rank</p>
        <div className="teams">
          {view.available.map((t: Team) => (
            <button
              key={t.id}
              className="team-pick"
              disabled={!view.onClock || pick.isPending}
              onClick={() => pick.mutate(t.id)}
            >
              <Flag code={t.code} name={t.name} />
              <span className="nm">{t.abbr}</span>
              <span className="rk">#{t.rank}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function WishlistEditor({ view, leagueId, token, onSaved }: {
  view: ManagerView; leagueId: string; token: string; onSaved: () => void
}) {
  const tmap = teamMap(view.teams)
  const [list, setList] = useState<string[]>(view.wishlist)
  const [msg, setMsg] = useState('')
  const inList = new Set(list)
  const save = useMutation({
    mutationFn: () => apiFetch(`/leagues/${leagueId}/wishlist`, {
      method: 'POST', body: JSON.stringify({ token, team_ids: list }),
    }),
    onSuccess: () => { setMsg('Wishlist saved.'); onSaved() },
    onError: (e: Error) => setMsg(e.message),
  })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list];[next[i], next[j]] = [next[j], next[i]]; setList(next)
  }
  const remove = (id: string) => setList(list.filter((x) => x !== id))
  const add = (id: string) => setList([...list, id])
  const addable = view.teams.filter((t) => !inList.has(t.id)).sort((a, b) => a.rank - b.rank)

  return (
    <div className="panel">
      <h2>Your autodraft wishlist</h2>
      <p className="sec-sub">
        Ordered most-wanted first. When the commissioner resolves the draft, the snake takes your
        highest-ranked still-available team each turn; gaps fall back to best-available by FIFA rank.
      </p>
      <div className="split">
        <div>
          <label>Wishlist ({list.length})</label>
          <div className="stack">
            {list.length === 0 && <p className="muted">Empty — you'll get best-available by rank.</p>}
            {list.map((id, i) => {
              const t = tmap[id]
              return (
                <div key={id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <b className="rk">{i + 1}</b><Flag code={t.code} name={t.name} />{t.name}
                  </span>
                  <span className="row">
                    <button className="btn ghost sm" onClick={() => move(i, -1)}>↑</button>
                    <button className="btn ghost sm" onClick={() => move(i, 1)}>↓</button>
                    <button className="btn ghost sm" onClick={() => remove(id)}>✕</button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <label>Add a team</label>
          <div className="teams">
            {addable.map((t) => (
              <button key={t.id} className="team-pick" onClick={() => add(t.id)}>
                <Flag code={t.code} name={t.name} /><span className="nm">{t.abbr}</span><span className="rk">#{t.rank}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Save wishlist</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  )
}
