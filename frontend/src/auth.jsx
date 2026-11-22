import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, tokenStore, draftStore } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return }
    try { setUser(await api('/api/auth/me')) } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const onLogout = () => setUser(null)
    window.addEventListener('alaala:logout', onLogout)
    return () => window.removeEventListener('alaala:logout', onLogout)
  }, [refresh])

  const accept = ({ token, user, remember }) => { tokenStore.set(token, !!remember); setUser(user); return user }
  const login = async (email, password, remember = false) =>
    accept(await api('/api/auth/login', { method: 'POST', body: { email, password, remember } }))
  // Registration does not sign in: the email must be verified first (see VerifyEmail).
  const register = async (body) => api('/api/auth/register', { method: 'POST', body })
  const activate = async (body) => accept(await api('/api/auth/activate', { method: 'POST', body }))
  const logout = () => { draftStore.clearAll(); tokenStore.set(null); setUser(null) }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, activate, accept, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
