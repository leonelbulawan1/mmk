import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Activate from './pages/Activate'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Entries from './pages/Entries'
import WritingModes from './pages/WritingModes'
import CreateEntry from './pages/CreateEntry'
import EntryDetail from './pages/EntryDetail'
import Beneficiaries from './pages/Beneficiaries'
import PolicyEditor from './pages/PolicyEditor'
import AccessPermissions from './pages/AccessPermissions'
import Assistant from './pages/Assistant'
import VaultIntegrity from './pages/VaultIntegrity'
import Settings from './pages/Settings'
import BeneficiaryHome from './pages/BeneficiaryHome'
import Letters from './pages/Letters'

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
        <Route path="/entries" element={<Entries />} />
        <Route path="/entries/new" element={<CreateEntry />} />
        <Route path="/entries/:id" element={<EntryDetail />} />
        <Route path="/write" element={<WritingModes />} />
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
  )
}
