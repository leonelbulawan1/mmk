import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Logo } from '../components/Layout'

export default function Landing() {
  const { user } = useAuth()
  const home = user ? (user.role === 'owner' ? '/dashboard' : '/home') : null
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex gap-2">
          {home ? <Link to={home} className="btn-primary">Open my journal</Link> : (
            <>
              <Link to="/login" className="btn-ghost">Sign in</Link>
              <Link to="/register" className="btn-primary">Begin a diary</Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 pb-16 pt-6 lg:grid-cols-2">
        <div className="fade-in">
          <h1 className="mt-2 text-5xl font-semibold leading-[1.05] sm:text-6xl">A private diary that remembers, and shares only what you allow.</h1>
          <p className="mt-6 max-w-xl text-lg text-ink-400">
            Write the days of your life. Choose who may know them, how much, and when. MMK keeps your words
            exactly as you wrote them and helps the people you love ask about them, gently and truthfully.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="btn-primary px-6 py-3 text-base">Start writing</Link>
            <Link to="/activate" className="btn-secondary px-6 py-3 text-base">I received an invitation</Link>
          </div>
        </div>
        <div className="card relative rotate-1 p-8 fade-in">
          <div className="absolute -top-3 left-10 h-6 w-24 rotate-[-4deg] bg-gold-400/40" aria-hidden />
          <p className="text-sm font-medium text-bark-500">Sunday, September 21</p>
          <p className="paper-lines mt-2 text-lg text-ink-600">
            Cooked adobo the way Lola taught me, with extra garlic and a bay leaf. The whole family sat together for once,
            and nobody looked at a phone.
          </p>
          <div className="mt-6 flex items-center justify-between border-t border-cream-300 pt-4 text-xs text-ink-400">
            <span>Shared with: Maria (full text) · Jose (summary)</span>
            <span className="font-mono">a91f3c…</span>
          </div>
        </div>
      </section>

    </div>
  )
}
