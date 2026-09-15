import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { emailSchema, type EmailForm } from './schema'

// Mirrors Supabase Auth's own per-email minimum interval between reset
// emails (set in the Supabase Dashboard for the linked project -- see
// supabase/config.toml's max_frequency for the local CLI stack's copy of
// the same setting). Purely a UX nicety: the real enforcement already
// happens server-side regardless of anything here, so this can't be
// bypassed by, say, reloading the page -- it just saves a resend click
// from silently doing nothing with no explanation.
const RESEND_COOLDOWN_SECONDS = 60

export function ForgotPasswordPage() {
  usePageTitle('Forgot Password')
  const { resetPasswordForEmail } = useAuth()
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })

  const onSubmit = async (values: EmailForm) => {
    // Always lands on the same "check your email" success state below,
    // even if the request itself errors (including a same-requester rate
    // limit) -- surfacing whether an address exists, or exactly why a
    // resend didn't go out, would let this form be used to enumerate
    // accounts.
    try {
      await resetPasswordForEmail(values.email)
    } finally {
      setSent(true)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
        {sent && (
          <p className="mb-4 text-sm text-muted">
            If an account exists for that email, we've sent a link to reset your password.
          </p>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Email</label>
            <input
              type="email"
              className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
              {...register('email')}
            />
            {errors.email && <p className="mt-1.5 text-sm text-danger">{errors.email.message}</p>}
          </div>
          <button
            type="submit"
            disabled={isSubmitting || cooldown > 0}
            className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {isSubmitting
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : sent
                  ? 'Resend link'
                  : 'Send reset link'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/login" className="font-medium text-primary hover:text-primary-hover">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  )
}
