import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LEGAL_VERSION } from '../legal/version'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from './authContextValue'
import { clearResourceCache } from '../lib/resourceCache'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Guards the same React StrictMode double-invoke race
    // useHouseholdResource documents and guards against: without it, a
    // stale first-invocation getSession() result resolving after a second
    // invocation could overwrite real session state with stale data in dev.
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // The shared data cache must never outlive the account that loaded it.
      if (event === 'SIGNED_OUT') clearResourceCache()
      if (!cancelled) setSession(newSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email: string, password: string) => {
    // Matches resetPasswordForEmail's own redirectTo below -- explicit
    // rather than relying on the Dashboard's default Site URL, so the
    // confirmation link lands back in whichever environment (localhost
    // today, the real deployed origin later) actually sent it.
    //
    // accepted_terms_version is required by a database trigger (migration
    // 0040): without it Supabase refuses to create the account at all, so the
    // signup checkboxes can't be skipped by calling the Auth API directly.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        // age_confirmed: the signup form only submits once the age / parental-consent
        // box is ticked, so its presence records that the person confirmed it.
        data: { accepted_terms_version: LEGAL_VERSION, age_confirmed: true },
      },
    })
    if (error) throw error
    // No session back means Supabase's "Confirm email" setting is on and
    // this account can't sign in yet -- data.user still exists either way,
    // so this is the one reliable signal for "needs to check their email
    // first" versus "signed up and already logged in."
    return { needsConfirmation: data.session === null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const resetPasswordForEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw error
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signUp,
        signIn,
        signOut,
        resetPasswordForEmail,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
