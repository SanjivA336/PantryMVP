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
  // Either "I'm 18 or older" or "I'm 13-17 and a parent or guardian agrees". One box,
  // not a birthdate: we deliberately don't collect dates of birth.
  confirmedAge: z.literal(true, {
    error: "Please confirm your age, or a parent or guardian's permission",
  }),
  // One box for both documents: the stored legal version identifies the Terms and
  // the Privacy Policy together, so a single acceptance records both.
  acceptedLegal: z.literal(true, {
    error: 'Please agree to the Terms and Privacy Policy',
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
