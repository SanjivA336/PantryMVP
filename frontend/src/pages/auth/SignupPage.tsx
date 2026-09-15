import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { credentialsSchema, type CredentialsForm } from './schema'

export function SignupPage() {
  usePageTitle('Sign Up')
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  // Set only once signUp reports there's no session yet -- Supabase's
  // "Confirm email" setting is on, so the account exists but can't log in
  // until the link in that email is clicked. Distinct from ForgotPasswordPage's
  // "sent" state: there's no account-enumeration concern here (this *is*
  // the account-creation form), so it's fine to be direct about it.
  const [needsConfirmation, setNeedsConfirmation] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CredentialsForm>({ resolver: zodResolver(credentialsSchema) })

  const onSubmit = async (values: CredentialsForm) => {
    setServerError(null)
    try {
      const { needsConfirmation } = await signUp(values.email, values.password)
      if (needsConfirmation) {
        setNeedsConfirmation(true)
      } else {
        navigate('/')
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Create your account</h1>
        {needsConfirmation ? (
          <p className="text-sm text-muted">
            We've sent a confirmation link to your email. Click it to finish creating your account,
            then come back and log in.
          </p>
        ) : (
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
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Password</label>
              <input
                type="password"
                className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1.5 text-sm text-danger">{errors.password.message}</p>
              )}
            </div>
            {serverError && <p className="text-sm text-danger">{serverError}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Creating account…' : 'Sign up'}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:text-primary-hover">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
