import { Link } from 'react-router-dom'
import { Logo } from '../components/Layout'

// Plain-language privacy notice. MMK is a CS 413 student project; this describes what the
// system actually does. It is not legal advice. Keep it in step with the code when things change.
const UPDATED = 'November 24, 2026'

function Part({ title, children }) {
  return (
    <section className="border-t border-cream-300 py-6 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-600">{children}</div>
    </section>
  )
}

export default function Privacy() {
  return (
    <div className="min-h-[100dvh] px-4 py-10 sm:py-14">
      <article className="card mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <header className="mb-8">
          <Link to="/" aria-label="MMK home"><Logo /></Link>
          <h1 className="mt-6 text-3xl font-semibold leading-tight">Privacy notice</h1>
          <p className="mt-2 text-sm text-ink-400">Last updated {UPDATED}</p>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
            MMK is a personal diary with a legacy policy, built as a CS 413 student project. This notice explains, in plain words,
            what MMK keeps, why, who can see it, and what you can do about it. It describes how the system works; it is not legal advice.
          </p>
        </header>

        <Part title="What MMK keeps">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>Your account:</b> name, email address, a scrambled (hashed) copy of your password, and your settings.</li>
            <li><b>What you write:</b> diary entries, letters, every revision, and drafts you have not finished.</li>
            <li><b>Your beneficiaries:</b> their names, email addresses and the short handles you give them.</li>
            <li><b>Your legacy policy:</b> every version you save.</li>
            <li><b>An activity log:</b> sign-ins, saves, policy changes and access decisions, used to keep the vault trustworthy.</li>
            <li><b>Reports of passing:</b> if your executor reports your passing, the report and any documents they upload (stored encrypted).</li>
          </ul>
        </Part>

        <Part title="Why MMK keeps it">
          <p>Only to run the diary: to let you write and keep your entries, to deliver letters when you chose, to apply your legacy policy after your passing,
            to prove that nothing in your vault was changed, and to keep your account secure. MMK does not sell your data, show ads, or use your writing to train AI models.</p>
        </Part>

        <Part title="Who can see it">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>While you are alive:</b> only you. Beneficiaries see nothing except letters you chose to deliver on a date.</li>
            <li><b>After your passing is verified:</b> each beneficiary sees only what your legacy policy allows them, and nothing else.</li>
            <li><b>MMK reviewers:</b> when a passing is reported, a reviewer checks the report and its documents. They do not read your diary.</li>
            <li><b>The MMK server:</b> your diary is not end-to-end encrypted, so the people who run the server could technically read it.</li>
          </ul>
        </Part>

        <Part title="Services MMK uses">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>Render</b> runs the website and the server (Singapore region).</li>
            <li><b>Neon</b> stores the database (Singapore region).</li>
            <li><b>Email</b> is sent through Brevo or a Gmail relay. Emails carry notices, sign-in codes and a letter's title, never the text of your diary or your letters.</li>
            <li><b>AI assistant:</b> by default answers are made on the MMK server. If an outside AI service is switched on, only the entries your policy allows for that question are sent to it.</li>
          </ul>
        </Part>

        <Part title="How long MMK keeps it">
          <p>Until you delete your account. Entries and their revisions are never changed or removed one by one, so the vault can prove its integrity;
            an entry you delete is hidden everywhere and a record that it was deleted stays. Deleting your account erases all of it.</p>
        </Part>

        <Part title="Your choices and rights">
          <p>Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) you may ask what data is kept about you, get a copy, have it corrected, and have it erased. In MMK you can do these yourself:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>See and correct:</b> Settings › Profile, and Edit on any diary entry.</li>
            <li><b>Get a copy:</b> Settings › Your data › Download my data.</li>
            <li><b>Erase:</b> Settings › Delete account (diary owners). Beneficiaries can ask the diary owner to remove them.</li>
            <li><b>Choose what is shared:</b> your legacy policy, and whether the AI assistant may answer from your entries.</li>
          </ul>
        </Part>

        <Part title="Security">
          <p>Passwords are hashed, sign-in attempts are limited, sessions end when you change your password, documents from reports are encrypted,
            and every entry is linked into a hash chain so changes can be detected. No system is perfectly secure; tell us if you find a problem.</p>
        </Part>

        <Part title="Contact">
          <p>MMK is run by the CS 413 project team: Leonel C. Bulawan (Project Manager), Gabriel E. Liray (Lead Developer), Kean Jayvee B. Gito (QA/Tester)
            and Robylyn U. Flores (UI/UX Designer). Questions about your data: [TEAM CONTACT EMAIL].</p>
        </Part>
      </article>
      <p className="mt-6 text-center text-sm"><Link to="/login" className="link">Back to MMK</Link></p>
    </div>
  )
}
