import { Link } from '@tanstack/react-router'

export function Home() {
  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <h1>World Cup <span className="yr">2026</span> Draft</h1>
        </div>
      </div>
      <div className="panel">
        <h2>Snake-draft leagues, live standings</h2>
        <p className="hint">
          Eight managers, six rounds, all 48 nations drafted. The commissioner spins up
          leagues and shares a private link with each manager; everyone watches one shared
          leaderboard as real results come in.
        </p>
        <Link to="/admin" className="btn">Commissioner console →</Link>
      </div>
      <div className="panel">
        <h2>The tournament</h2>
        <p className="hint">
          Browse all 48 nations by group, live group tables, and the knockout bracket
          as real results come in — no link required.
        </p>
        <Link to="/fixtures" className="btn">View fixtures →</Link>
      </div>
      <div className="panel">
        <h2>Got a link?</h2>
        <p className="hint">
          Managers join from the personal link your commissioner sent you
          (<code>/l/&lt;league&gt;/m/&lt;your-token&gt;</code>). Public standings for a league
          live at <code>/l/&lt;league&gt;</code>. There's nothing to sign up for — the link is your seat.
        </p>
      </div>
    </div>
  )
}
