import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
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

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      {/* No landing page: visitors go straight to Sign in; signed-in users to their home. */}
      <Route path="/" element={<PublicOnly><Navigate to="/login" replace /></PublicOnly>} />
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
        <Route path="/entries/new" element={<Navigate to="/write" replace />} />
        <Route path="/entries/:id" element={<EntryDetail />} />
        <Route path="/write" element={<CreateEntry />} />
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
