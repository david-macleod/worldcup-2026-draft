import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  apiFetch, getAdminPassword, setAdminPassword, clearAdminPassword,
  type AdminLeague, type Match,
} from '../lib/api'
import { Flag } from '../components/ui'

export function Admin() {
  const [authed, setAuthed] = useState(!!getAdminPassword())
  if (!authed) return <PasswordGate onAuthed={() => setAuthed(true)} />
  return <Console onSignout={() => { clearAdminPassword(); setAuthed(false) }} />
}

function PasswordGate({ onAuthed }: { onAuthed: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    setAdminPassword(pw)
    try { await apiFetch('/admin/leagues', { admin: true }); onAuthed() }
    catch (e) { clearAdminPassword(); setErr((e as Error).message) }
  }
  return (
    <div className="wrap">
      <div className="topbar"><div className="brand"><h1>Commissioner console</h1></div>
        <div className="crumbs"><Link to="/">home</Link></div></div>
      <div className="panel" style={{ maxWidth: 420 }}>
        <h2>Enter admin password</h2>
        <p className="hint">Held in this tab only (sessionStorage), sent as a header per request.</p>
        <div className="field"><input type="password" value={pw} placeholder="ADMIN_PASSWORD"
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></div>
        {err && <p className="err">{err}</p>}
        <button className="btn" onClick={submit}>Unlock</button>
      </div>
    </div>
  )
}

function Console({ onSignout }: { onSignout: () => void }) {
  const qc = useQueryClient()
  const leagues = useQuery({ queryKey: ['admin-leagues'], queryFn: () => apiFetch<{ leagues: AdminLeague[] }>('/admin/leagues', { admin: true }) })
  const reload = () => qc.invalidateQueries({ queryKey: ['admin-leagues'] })

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand"><h1>Commissioner console</h1></div>
        <div className="row">
          <Link to="/" className="crumbs">home</Link>
          <button className="btn ghost sm" onClick={onSignout}>Lock</button>
        </div>
      </div>

      <div className="split">
        <CreateLeague onCreated={reload} />
        <ImportLeague onCreated={reload} />
      </div>

      <div className="panel">
        <h2>Leagues</h2>
        {leagues.isLoading && <p className="muted">Loading…</p>}
        {leagues.data?.leagues.length === 0 && <p className="muted">No leagues yet — create one above.</p>}
        <div className="stack">
          {leagues.data?.leagues.map((lg) => <LeagueCard key={lg.id} lg={lg} onChange={reload} />)}
        </div>
      </div>

      <MatchResults />
    </div>
  )
}

const MIN_MANAGERS = 2, MAX_MANAGERS = 24, MIN_ROUNDS = 1, MAX_ROUNDS = 12, FIELD = 48

function CreateLeague({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('sequential')
  const [rounds, setRounds] = useState(6)
  const [names, setNames] = useState<string[]>(Array.from({ length: 8 }, (_, i) => `Player ${String.fromCharCode(65 + i)}`))
  const [out, setOut] = useState<AdminLeague['managers'] | null>(null)
  const [err, setErr] = useState('')

  // Grow/shrink the name list when the participant count changes (keep what's typed).
  const setCount = (next: number) => {
    const n = Math.max(MIN_MANAGERS, Math.min(MAX_MANAGERS, next))
    setNames((prev) => {
      if (n <= prev.length) return prev.slice(0, n)
      return [...prev, ...Array.from({ length: n - prev.length }, (_, i) =>
        `Player ${String.fromCharCode(65 + prev.length + i)}`)]
    })
  }
  const count = names.length
  const total = count * rounds
  const overField = total > FIELD
  const blankName = names.some((n) => !n.trim())

  const create = useMutation({
    mutationFn: () => apiFetch<{ leagueId: string; managers: AdminLeague['managers'] }>('/admin/leagues', {
      admin: true, method: 'POST',
      body: JSON.stringify({ name, mode, rounds, managers: names.map((n) => ({ name: n })) }),
    }),
    onSuccess: (r) => { setOut(r.managers); setErr(''); onCreated() },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div className="panel">
      <h2>New league</h2>
      <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Office WC Draft" /></div>
      <div className="field"><label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="sequential">Sequential — live async turns</option>
          <option value="autodraft">Autodraft — ranked wishlists</option>
        </select>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Participants ({MIN_MANAGERS}–{MAX_MANAGERS})</label>
          <input type="number" min={MIN_MANAGERS} max={MAX_MANAGERS} value={count}
            onChange={(e) => setCount(parseInt(e.target.value || '0', 10))} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Teams per manager ({MIN_ROUNDS}–{MAX_ROUNDS})</label>
          <input type="number" min={MIN_ROUNDS} max={MAX_ROUNDS} value={rounds}
            onChange={(e) => setRounds(Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, parseInt(e.target.value || '0', 10) || MIN_ROUNDS)))} />
        </div>
      </div>
      <p className="sec-sub" style={{ color: overField ? '#ff8b8b' : undefined }}>
        {count} × {rounds} = <b>{total}</b> of {FIELD} nations drafted{overField ? ' — too many, reduce participants or teams each' : total < FIELD ? ` (${FIELD - total} nations go undrafted)` : ' (every nation owned)'}
      </p>
      <label>Participant names</label>
      <div className="grid2">
        {names.map((n, i) => (
          <input key={i} value={n} placeholder={`Player ${i + 1}`}
            onChange={(e) => { const x = [...names]; x[i] = e.target.value; setNames(x) }} />
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={create.isPending || !name || overField || blankName} onClick={() => create.mutate()}>Create league</button>
      </div>
      {out && (
        <div style={{ marginTop: 14 }}>
          <label>Manager links — share these out-of-band</label>
          <div className="stack">
            {out.map((m) => <ManagerLink key={m.id} name={m.name} link={m.link} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function ImportLeague({ onCreated }: { onCreated: () => void }) {
  const placeholder = JSON.stringify({
    name: 'Imported Draft',
    squads: [{ manager: { name: 'Ann' }, team_ids: ['fra', 'bra', 'eng', 'usa', 'jpn', 'mar'] }],
  }, null, 2)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [out, setOut] = useState<AdminLeague['managers'] | null>(null)
  const imp = useMutation({
    mutationFn: () => apiFetch<{ managers: AdminLeague['managers'] }>('/admin/leagues/import', {
      admin: true, method: 'POST', body: text,
    }),
    onSuccess: (r) => { setOut(r.managers); setErr(''); onCreated() },
    onError: (e: Error) => setErr(e.message),
  })
  return (
    <div className="panel">
      <h2>Import a finished draft</h2>
      <p className="sec-sub">8 managers × 6 team ids each. Paste JSON:</p>
      <textarea value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={imp.isPending || !text} onClick={() => imp.mutate()}>Import</button>
      </div>
      {out && <div className="stack" style={{ marginTop: 12 }}>{out.map((m) => <ManagerLink key={m.id} name={m.name} link={m.link} />)}</div>}
    </div>
  )
}

function ManagerLink({ name, link }: { name: string; link: string }) {
  const url = `${location.origin}${link}`
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <span><b>{name}</b></span>
      <span className="linkbox" style={{ flex: 1 }}>{url}</span>
      <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(url)}>copy</button>
    </div>
  )
}

function LeagueCard({ lg, onChange }: { lg: AdminLeague; onChange: () => void }) {
  const [err, setErr] = useState('')
  const act = (path: string) => apiFetch(path, { admin: true, method: 'POST', body: '{}' })
    .then(() => { setErr(''); onChange() }).catch((e: Error) => setErr(e.message))
  return (
    <div style={{ border: '1px solid var(--line-soft)', borderRadius: 11, padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <b>{lg.name}</b> <span className="pill">{lg.mode}</span> <span className="pill">{lg.status}</span>
          <span className="muted" style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>{lg.picks}/48 picks</span>
        </div>
        <div className="row">
          <Link to="/l/$leagueId" params={{ leagueId: lg.id }} className="btn ghost sm">standings</Link>
          {lg.status === 'setup' && <button className="btn sm" onClick={() => act(`/admin/leagues/${lg.id}/start`)}>Spin &amp; start</button>}
          {lg.status === 'drafting' && lg.mode === 'autodraft' && <button className="btn sm" onClick={() => act(`/admin/leagues/${lg.id}/resolve`)}>Resolve</button>}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="stack" style={{ marginTop: 10 }}>
        {lg.managers.map((m) => <ManagerLink key={m.id} name={`${m.name}${m.seat != null ? ` · seat ${m.seat + 1}` : ''}`} link={m.link} />)}
      </div>
    </div>
  )
}

function MatchResults() {
  const qc = useQueryClient()
  const matchesQ = useQuery({ queryKey: ['admin-matches'], queryFn: () => apiFetch<{ matches: Match[] }>('/admin/matches', { admin: true }) })
  const [stage, setStage] = useState('group')
  const reload = () => qc.invalidateQueries({ queryKey: ['admin-matches'] })
  if (matchesQ.isLoading) return <div className="panel"><h2>Results</h2><p className="muted">Loading fixtures…</p></div>
  const matches = matchesQ.data?.matches ?? []
  const stages = ['group', 'R32', 'R16', 'QF', 'SF', 'Final']
  const shown = matches.filter((m) => m.stage === stage)

  return (
    <div className="panel">
      <h2>Enter results</h2>
      <p className="sec-sub">Scores are the source of truth — standings recompute on read for every league.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {stages.map((s) => (
          <button key={s} className={'btn sm ' + (s === stage ? '' : 'ghost')} onClick={() => setStage(s)}>
            {s === 'group' ? 'Groups' : s}
          </button>
        ))}
      </div>
      <div className="stack">
        {shown.map((m) => <MatchRow key={m.id} m={m} onSaved={reload} />)}
      </div>
    </div>
  )
}

function MatchRow({ m, onSaved }: { m: Match; onSaved: () => void }) {
  const [hg, setHg] = useState(m.home_goals ?? '')
  const [ag, setAg] = useState(m.away_goals ?? '')
  const [err, setErr] = useState('')
  const knockoutNoTeams = m.stage !== 'group' && (!m.home_team_id || !m.away_team_id)
  const save = useMutation({
    mutationFn: () => apiFetch(`/admin/matches/${m.id}/result`, {
      admin: true, method: 'POST', body: JSON.stringify({ home_goals: Number(hg), away_goals: Number(ag) }),
    }),
    onSuccess: () => { setErr(''); onSaved() },
    onError: (e: Error) => setErr(e.message),
  })
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="pill">{m.stage === 'group' ? `Grp ${m.grp}` : m.stage} {m.id}</span>
      <span className="mono" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
        {m.home_team_id ?? '—'} <b>v</b> {m.away_team_id ?? '—'}
      </span>
      <input style={{ width: 56 }} value={hg} onChange={(e) => setHg(e.target.value)} placeholder="–" />
      <input style={{ width: 56 }} value={ag} onChange={(e) => setAg(e.target.value)} placeholder="–" />
      <button className="btn sm" disabled={save.isPending || knockoutNoTeams || hg === '' || ag === ''} onClick={() => save.mutate()}>
        {m.status === 'finished' ? 'update' : 'save'}
      </button>
      {knockoutNoTeams && <span className="muted" style={{ fontSize: 11 }}>assign teams first</span>}
      {err && <span className="err">{err}</span>}
    </div>
  )
}
