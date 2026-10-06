import { useState } from 'react'
import { AppVersion } from '../../components/AppVersion'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { signupSchema, type SignupForm } from './schema'

const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary'
const legalLinkClass = 'font-medium text-primary hover:text-primary-hover hover:underline'

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

  // No defaultValues for the checkboxes: their schema type is the literal
  // `true`, so `false` isn't a legal default. An untouched checkbox reads as
  // undefined here and as false at submit time, and both fail the schema.
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({ resolver: zodResolver(signupSchema) })

  const [acceptedLegal, confirmedAge] = watch(['acceptedLegal', 'confirmedAge'])
  const agreedToAll = Boolean(acceptedLegal && confirmedAge)

  const onSubmit = async (values: SignupForm) => {
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
    <div className="flex min-h-app flex-col items-center justify-center bg-surface px-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text md:bg-bg md:p-4">
      <div className="w-full max-w-sm bg-surface p-7 md:rounded-card md:border md:border-subtle md:shadow-card">
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
            {/* Both open in a new tab so reading them doesn't throw away
                what's already typed into this form. */}
            <div className="flex flex-col gap-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-muted">
                <input type="checkbox" className={checkboxClass} {...register('confirmedAge')} />
                <span>
                  I'm 18 or older, or I'm 13 to 17 and my parent or guardian has read and agrees to
                  the Terms of Service and Privacy Policy.
                </span>
              </label>
              {errors.confirmedAge && (
                <p className="text-sm text-danger">{errors.confirmedAge.message}</p>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm text-muted">
                <input type="checkbox" className={checkboxClass} {...register('acceptedLegal')} />
                <span>
                  I agree to the{' '}
                  <Link
                    to="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={legalLinkClass}
                  >
                    Terms of Service
                  </Link>{' '}
                  and have read the{' '}
                  <Link
                    to="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={legalLinkClass}
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {errors.acceptedLegal && (
                <p className="text-sm text-danger">{errors.acceptedLegal.message}</p>
              )}
            </div>
            {serverError && <p className="text-sm text-danger">{serverError}</p>}
            <button
              type="submit"
              disabled={isSubmitting || !agreedToAll}
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
        {/* Phones: inside the flat page, under the form. */}
        <AppVersion className="mt-6 text-center md:hidden" />
      </div>
      {/* Desktop: under the card. */}
      <AppVersion className="mt-4 hidden md:block" />
    </div>
  )
}
