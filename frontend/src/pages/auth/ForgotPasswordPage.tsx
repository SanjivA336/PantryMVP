import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { emailSchema, type EmailForm } from './schema'

export function ForgotPasswordPage() {
  const { resetPasswordForEmail } = useAuth()
  const [sent, setSent] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })

  const onSubmit = async (values: EmailForm) => {
    // Always lands on the same "check your email" success state below,
    // even if the request itself errors -- surfacing whether an address
    // exists would let this form be used to enumerate accounts.
    try {
      await resetPasswordForEmail(values.email)
    } finally {
      setSent(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
        {sent ? (
          <p className="text-sm text-muted">
            If an account exists for that email, we've sent a link to reset your password.
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Email</label>
              <input
                type="email"
                className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1.5 text-sm text-danger">{errors.email.message}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          <Link to="/login" className="font-medium text-primary hover:text-primary-hover">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  )
}
