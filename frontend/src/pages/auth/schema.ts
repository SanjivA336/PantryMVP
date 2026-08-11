import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export type CredentialsForm = z.infer<typeof credentialsSchema>

export const emailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

export type EmailForm = z.infer<typeof emailSchema>

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

export type NewPasswordForm = z.infer<typeof newPasswordSchema>
