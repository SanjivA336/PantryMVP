import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  // needsConfirmation is true when Supabase Auth's "Confirm email" setting
  // is on and the account isn't usable yet -- signUp succeeds (the account
  // exists) but returns no session until the user clicks the link in their
  // confirmation email.
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPasswordForEmail: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
