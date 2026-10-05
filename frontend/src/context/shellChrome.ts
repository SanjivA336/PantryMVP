import { createContext } from 'react'

// What a screen inside the household shell can ask of the shell's own chrome.
// Today that's one thing: hiding the phone tab bar (see hooks/useHideTabBar).
export interface ShellChrome {
  setTabBarHidden: (hidden: boolean) => void
}

export const ShellChromeContext = createContext<ShellChrome | null>(null)
