import { createContext } from 'react'
import type { Household } from '../types/entities'

// What a screen inside the household shell can ask of the shell's own chrome.
// Hiding the phone tab bar (see hooks/useHideTabBar), and replacing the shell's
// copy of the household after a screen changes it (the header shows its name and
// join code, so it would otherwise stay stale until a reload).
export interface ShellChrome {
  setTabBarHidden: (hidden: boolean) => void
  setHousehold: (household: Household) => void
}

export const ShellChromeContext = createContext<ShellChrome | null>(null)
