import { useState } from 'react'
import { AppVersion } from '../../components/AppVersion'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { credentialsSchema, type CredentialsForm } from './schema'
import { authCardClass, authScreenClass } from './authLayout'

export function LoginPage() {
  usePageTitle('Log In')
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CredentialsForm>({ resolver: zodResolver(credentialsSchema) })

  const onSubmit = async (values: CredentialsForm) => {
    setServerError(null)
    try {
      await signIn(values.email, values.password)
      navigate('/')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className={authScreenClass}>
      <div className={authCardClass}>
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Welcome back</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-muted">
              Email
            </label>
            <input
              type="email"
              className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
              id="email"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <p className="mt-1.5 text-sm text-danger">{errors.email.message}</p>}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-muted">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-primary hover:text-primary-hover"
              >
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              className="w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary"
              id="password"
              autoComplete="current-password"
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
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          Don't have an account?{' '}
          <Link to="/signup" className="font-medium text-primary hover:text-primary-hover">
            Sign up
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
