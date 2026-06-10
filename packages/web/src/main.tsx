import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRouter, createRoute, createRootRoute, RouterProvider, Outlet, useParams,
} from '@tanstack/react-router'
import './styles/app.css'
import './styles/draft.css'
import { Home } from './routes/Home'
import { Admin } from './routes/Admin'
import { PublicLeague } from './routes/PublicLeague'
import { Manager } from './routes/Manager'
import { Fixtures } from './routes/Fixtures'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home })
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: Admin })
const fixturesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/fixtures', component: Fixtures })

const leagueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/l/$leagueId',
  component: function LeagueRoute() {
    const { leagueId } = useParams({ from: '/l/$leagueId' })
    return <PublicLeague leagueId={leagueId} />
  },
})

const managerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/l/$leagueId/m/$token',
  component: function ManagerRoute() {
    const { leagueId, token } = useParams({ from: '/l/$leagueId/m/$token' })
    return <Manager leagueId={leagueId} token={token} />
  },
})

// Friendlier link form with the manager's name as a trailing slug. The token still
// authenticates; the name segment is decorative (ignored).
const managerNamedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/l/$leagueId/m/$token/$name',
  component: function ManagerNamedRoute() {
    const { leagueId, token } = useParams({ from: '/l/$leagueId/m/$token/$name' })
    return <Manager leagueId={leagueId} token={token} />
  },
})

const routeTree = rootRoute.addChildren([indexRoute, adminRoute, fixturesRoute, leagueRoute, managerRoute, managerNamedRoute])
const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
