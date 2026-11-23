import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Activate from './pages/Activate'
import VerifyEmail from './pages/VerifyEmail'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Entries = lazy(() => import('./pages/Entries'))
const CreateEntry = lazy(() => import('./pages/CreateEntry'))
const EntryDetail = lazy(() => import('./pages/EntryDetail'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Beneficiaries = lazy(() => import('./pages/Beneficiaries'))
const PolicyEditor = lazy(() => import('./pages/PolicyEditor'))
const AccessPermissions = lazy(() => import('./pages/AccessPermissions'))
const Assistant = lazy(() => import('./pages/Assistant'))
const VaultIntegrity = lazy(() => import('./pages/VaultIntegrity'))
const Settings = lazy(() => import('./pages/Settings'))
const BeneficiaryHome = lazy(() => import('./pages/BeneficiaryHome'))
const Letters = lazy(() => import('./pages/Letters'))
const Review = lazy(() => import('./pages/Review'))

function Guard({ role, children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={user.role === 'owner' ? '/dashboard' : '/home'} replace />
  return children
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to={user.role === 'owner' ? '/dashboard' : '/home'} replace />
  return children
}

// Writing now lives under Diary entries; old /write links (bookmarks, emails) keep working.
function WriteRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/entries/new${search}`} replace />
}

export default function App() {
  // A link with state.background (the + New / Write menu, Drafts) opens the composer in a floating
  // window and keeps that page underneath. Opening /entries/new directly still shows the full page.
  const location = useLocation()
  const background = location.pathname === '/entries/new' && location.state?.background
  return (
    <Suspense fallback={<Spinner />}>
    {background && (
      <Routes>
        <Route path="/entries/new" element={<Guard role="owner"><CreateEntry modal /></Guard>} />
      </Routes>
    )}
    <Routes location={background || location}>
      {/* No landing page: visitors go straight to Sign in; signed-in users to their home. */}
      <Route path="/" element={<PublicOnly><Navigate to="/login" replace /></PublicOnly>} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/activate" element={<PublicOnly><Activate /></PublicOnly>} />
      <Route path="/verify-email" element={<PublicOnly><VerifyEmail /></PublicOnly>} />

      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route element={<Guard role="owner"><Layout /></Guard>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/review" element={<Review />} />
        <Route path="/entries" element={<Entries />} />
        <Route path="/entries/new" element={<CreateEntry />} />
        <Route path="/entries/:id" element={<EntryDetail />} />
        <Route path="/write" element={<WriteRedirect />} />
        <Route path="/beneficiaries" element={<Beneficiaries />} />
        <Route path="/policy" element={<PolicyEditor />} />
        <Route path="/access" element={<AccessPermissions />} />
        <Route path="/vault" element={<VaultIntegrity />} />
      </Route>
      <Route element={<Guard role="beneficiary"><Layout /></Guard>}>
        <Route path="/home" element={<BeneficiaryHome />} />
        <Route path="/letters" element={<Letters />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
