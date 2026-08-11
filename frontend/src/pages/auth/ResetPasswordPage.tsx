import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { newPasswordSchema, type NewPasswordForm } from './schema'

export function ResetPasswordPage() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordSchema) })

  const onSubmit = async (values: NewPasswordForm) => {
    setServerError(null)
    try {
      await updatePassword(values.password)
      navigate('/')
    } catch (err) {
      // No valid recovery session (expired/already-used link) surfaces the
      // same way as any other failed update -- point back at requesting a
      // fresh one rather than trying to distinguish the cause.
      setServerError(
        err instanceof Error
          ? err.message
          : 'This reset link is invalid or has expired.',
      )
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="w-full max-w-sm rounded-card border border-subtle bg-surface p-7 shadow-card">
        <p className="mb-1 text-sm font-medium text-primary">Burrow</p>
        <h1 className="mb-6 text-2xl font-semibold">Set a new password</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">New password</label>
            <input
              type="password"
              className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1.5 text-sm text-danger">{errors.password.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">
              Confirm password
            </label>
            <input
              type="password"
              className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="mt-1.5 text-sm text-danger">{errors.confirmPassword.message}</p>
            )}
          </div>
          {serverError && (
            <div className="text-sm text-danger">
              <p>{serverError}</p>
              <Link to="/forgot-password" className="font-medium text-primary hover:text-primary-hover">
                Request a new link
              </Link>
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
