import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export type CredentialsForm = z.infer<typeof credentialsSchema>

// Signup adds two required checkboxes on top of the login credentials.
// z.literal(true) rejects anything but a ticked box, so this is the real
// gate (the disabled button on the page is just the visible hint). Kept
// separate from credentialsSchema because login shares that one.
export const signupSchema = credentialsSchema.extend({
  acceptedTerms: z.literal(true, {
    error: 'You need to agree to the Terms of Service to sign up',
  }),
  acceptedPrivacy: z.literal(true, {
    error: 'You need to confirm you have read the Privacy Policy to sign up',
  }),
})

export type SignupForm = z.infer<typeof signupSchema>

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
