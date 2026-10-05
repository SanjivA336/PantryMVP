import { useContext, useEffect } from 'react'
import { ShellChromeContext } from '../context/shellChrome'

// Hides the phone's bottom tab bar for as long as the calling screen is
// mounted. For editing screens that pin their own Save bar to the bottom: two
// stacked bars would eat a lot of a small screen, and nobody navigates away
// mid-edit. Does nothing outside the household shell.
export function useHideTabBar() {
  const chrome = useContext(ShellChromeContext)
  useEffect(() => {
    chrome?.setTabBarHidden(true)
    return () => chrome?.setTabBarHidden(false)
  }, [chrome])
}
