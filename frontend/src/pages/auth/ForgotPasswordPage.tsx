import { Link } from 'react-router-dom'

// Password reset needs a real transactional-email provider to actually
// deliver anything -- without one configured, Supabase's own default
// sender is rate-limited to 2 emails/hour (see supabase/config.toml) and
// isn't something to expose to real users. Disabled at the UI layer rather
// than in Supabase Auth itself, since there's no way to turn off recovery
// emails specifically without also disabling email/password sign-in --
// resetPasswordForEmail (see hooks/useAuth) is left intact for when a
// provider is wired up.
export function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Password reset unavailable</h1>
        <p className="text-sm text-muted">
          Self-service password reset isn't available right now. Reach out to whoever manages
          your household for help getting back in.
        </p>
        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/login" className="font-medium text-primary hover:text-primary-hover">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  )
}
