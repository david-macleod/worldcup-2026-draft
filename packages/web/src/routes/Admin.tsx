import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  apiFetch, getAdminPassword, setAdminPassword, clearAdminPassword,
  type AdminLeague, type Match,
} from '../lib/api'
import { Flag } from '../components/ui'
import { TEAMS } from '../lib/teams'

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
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  const created = (leagueId?: string) => { reload(); if (leagueId) setScrollTo(leagueId) }

  // After the list refetches, scroll the freshly created league into view and flash it.
  useEffect(() => {
    if (!scrollTo) return
    const el = document.getElementById(`league-${scrollTo}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash')
    const t = setTimeout(() => el.classList.remove('flash'), 1600)
    setScrollTo(null)
    return () => clearTimeout(t)
  }, [scrollTo, leagues.data])

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
        <CreateLeague onCreated={created} />
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

function CreateLeague({ onCreated }: { onCreated: (leagueId?: string) => void }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('sequential')
  const [rounds, setRounds] = useState(6)
  const [finalDouble, setFinalDouble] = useState(false)
  const [thirdPlaceScores, setThirdPlaceScores] = useState(false)
  const [names, setNames] = useState<string[]>(Array.from({ length: 8 }, (_, i) => `Player ${String.fromCharCode(65 + i)}`))
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
      body: JSON.stringify({ name, mode, rounds, finalDouble, thirdPlaceScores, managers: names.map((n) => ({ name: n })) }),
    }),
    onSuccess: (r) => { setErr(''); setName(''); onCreated(r.leagueId) },
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
      <label>Scoring options</label>
      <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={finalDouble} onChange={(e) => setFinalDouble(e.target.checked)} />
          <span>Final scores <b>double</b> points</span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={thirdPlaceScores} onChange={(e) => setThirdPlaceScores(e.target.checked)} />
          <span>Third-place playoff <b>awards</b> points</span>
        </label>
      </div>
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

function ManagerLink({ name, link, seat, onRename }: {
  name: string; link: string; seat?: number | null; onRename?: (name: string) => void
}) {
  const url = `${location.origin}${link}`
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="row" style={{ gap: 6, minWidth: 120 }}>
        {onRename ? <InlineEdit value={name} onSave={onRename} bold /> : <b>{name}</b>}
        {seat != null && <span className="muted" style={{ fontSize: 12 }}>· seat {seat + 1}</span>}
      </span>
      <span className="linkbox" style={{ flex: 1 }}>{url}</span>
      <a className="btn ghost sm" href={url} target="_blank" rel="noopener noreferrer">view</a>
      <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(url)}>copy</button>
    </div>
  )
}

// Click-to-edit text: shows plain text, swaps to an input on click. Commits on
// Enter/blur, cancels on Escape.
function InlineEdit({ value, onSave, bold }: { value: string; onSave: (v: string) => void; bold?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== value) onSave(v); else setDraft(value)
  }
  if (editing) {
    return (
      <input className="inline-edit" autoFocus value={draft} size={Math.max(draft.length, 4)}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }} />
    )
  }
  return (
    <span className={'inline-edit-text' + (bold ? ' b' : '')} title="Click to rename"
      onClick={() => setEditing(true)}>{value}</span>
  )
}

function LeagueCard({ lg, onChange }: { lg: AdminLeague; onChange: () => void }) {
  const [err, setErr] = useState('')
  const act = (path: string) => apiFetch(path, { admin: true, method: 'POST', body: '{}' })
    .then(() => { setErr(''); onChange() }).catch((e: Error) => setErr(e.message))
  const del = () => {
    if (!confirm(`Delete "${lg.name}"? This removes its managers, picks, and wishlists for good.`)) return
    apiFetch(`/admin/leagues/${lg.id}`, { admin: true, method: 'DELETE' })
      .then(() => { setErr(''); onChange() }).catch((e: Error) => setErr(e.message))
  }
  const rename = (path: string, name: string) => apiFetch(path, {
    admin: true, method: 'PATCH', body: JSON.stringify({ name }),
  }).then(() => { setErr(''); onChange() }).catch((e: Error) => setErr(e.message))
  const setOption = (opt: 'finalDouble' | 'thirdPlaceScores', value: boolean) => apiFetch(`/admin/leagues/${lg.id}`, {
    admin: true, method: 'PATCH', body: JSON.stringify({ [opt]: value }),
  }).then(() => { setErr(''); onChange() }).catch((e: Error) => setErr(e.message))
  return (
    <div id={`league-${lg.id}`} className="league-card" style={{ border: '1px solid var(--line-soft)', borderRadius: 11, padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <InlineEdit value={lg.name} bold onSave={(name) => rename(`/admin/leagues/${lg.id}`, name)} />
          {' '}<span className="pill">{lg.mode}</span> <span className="pill">{lg.status}</span>
          <span className="muted" style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>{lg.picks}/48 picks</span>
        </div>
        <div className="row">
          <Link to="/l/$leagueId" params={{ leagueId: lg.id }} className="btn ghost sm">standings</Link>
          {lg.status === 'setup' && <button className="btn sm" onClick={() => act(`/admin/leagues/${lg.id}/start`)}>Spin &amp; start</button>}
          {lg.status === 'drafting' && lg.mode === 'autodraft' && <button className="btn sm" onClick={() => act(`/admin/leagues/${lg.id}/resolve`)}>Resolve</button>}
          <button className="btn ghost sm danger" onClick={del}>Delete</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={lg.finalDouble} onChange={(e) => setOption('finalDouble', e.target.checked)} />
          <span>Final ×2</span>
        </label>
        <label className="row" style={{ gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={lg.thirdPlaceScores} onChange={(e) => setOption('thirdPlaceScores', e.target.checked)} />
          <span>3rd-place scores</span>
        </label>
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        {lg.managers.map((m) => (
          <ManagerLink key={m.id} name={m.name} link={m.link} seat={m.seat}
            onRename={(name) => rename(`/admin/managers/${m.id}`, name)} />
        ))}
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
  const stages = ['group', 'R32', 'R16', 'QF', 'SF', '3P', 'Final']
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
  const isKO = m.stage !== 'group'
  // 90' score is the source for goal points; for knockouts it's stored in *_g90 (falling
  // back to the final score for matches that didn't go to extra time).
  const wentToET = m.home_g90 != null && (m.home_goals !== m.home_g90 || m.away_goals !== m.away_g90)
  const [h90, setH90] = useState<number | ''>(m.home_g90 ?? m.home_goals ?? '')
  const [a90, setA90] = useState<number | ''>(m.away_g90 ?? m.away_goals ?? '')
  // extra-time (final) score — only knockouts, only if it went to ET
  const [h120, setH120] = useState<number | ''>(wentToET ? m.home_goals ?? '' : '')
  const [a120, setA120] = useState<number | ''>(wentToET ? m.away_goals ?? '' : '')
  const [hp, setHp] = useState<number | ''>(m.home_pens ?? '')
  const [ap, setAp] = useState<number | ''>(m.away_pens ?? '')
  const [err, setErr] = useState('')
  const koNoTeams = isKO && (!m.home_team_id || !m.away_team_id)

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, number> = { h90: Number(h90), a90: Number(a90) }
      if (isKO && h120 !== '' && a120 !== '') { body.h120 = Number(h120); body.a120 = Number(a120) }
      if (isKO && hp !== '' && ap !== '') { body.home_pens = Number(hp); body.away_pens = Number(ap) }
      return apiFetch(`/admin/matches/${m.id}/result`, { admin: true, method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => { setErr(''); onSaved() },
    onError: (e: Error) => setErr(e.message),
  })
  const num = (v: number | '', set: (n: number | '') => void, w = 44) => (
    <input style={{ width: w }} value={v} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} placeholder="–" />
  )
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="pill">{m.stage === 'group' ? `Grp ${m.grp}` : m.stage} {m.id}</span>
      <span style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 6, fontSize: 13, width: 320 }}>
        <TeamName id={m.home_team_id} side="home" />
        <b style={{ opacity: .5 }}>v</b>
        <TeamName id={m.away_team_id} side="away" />
      </span>
      <span className="row" style={{ gap: 4, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 10 }}>{isKO ? '90′' : ''}</span>
        {num(h90, setH90)}{num(a90, setA90)}
      </span>
      {isKO && (
        <span className="row" style={{ gap: 4, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 10 }}>ET</span>
          {num(h120, setH120)}{num(a120, setA120)}
          <span className="muted" style={{ fontSize: 10 }}>pens</span>
          {num(hp, setHp, 36)}{num(ap, setAp, 36)}
        </span>
      )}
      <button className="btn sm" disabled={save.isPending || koNoTeams || h90 === '' || a90 === ''} onClick={() => save.mutate()}>
        {m.status === 'finished' ? 'update' : 'save'}
      </button>
      {koNoTeams && <span className="muted" style={{ fontSize: 11 }}>teams not decided yet</span>}
      {err && <span className="err">{err}</span>}
    </div>
  )
}

function TeamName({ id, side }: { id: string | null; side: 'home' | 'away' }) {
  const home = side === 'home'
  const justify = home ? 'flex-end' : 'flex-start'
  if (!id) return <span className="muted" style={{ display: 'flex', justifyContent: justify }}>TBD</span>
  const t = TEAMS[id]
  if (!t) return <span className="mono" style={{ display: 'flex', justifyContent: justify }}>{id}</span>
  return (
    <span className="row" style={{ gap: 5, alignItems: 'center', justifyContent: justify, minWidth: 0 }}>
      {home
        ? <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span><Flag code={t.code} name={t.name} /></>
        : <><Flag code={t.code} name={t.name} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span></>}
    </span>
  )
}
