import { useContext, useEffect } from 'react'
import { AddItemWizardContext } from '../context/addItemWizard'

// Use the household's single add-item flow (see context/addItemWizard). Returns
// `open`, which starts a new order. If `onChanged` is given, it is called when
// the sheet closes (after submitting, saving for later or discarding), so a page
// can refresh whatever it shows. Outside the household shell `open` does nothing.
export function useAddItemFlow(onChanged?: () => void) {
  const api = useContext(AddItemWizardContext)

  useEffect(() => {
    if (!api || !onChanged) return
    api.setOnChanged(onChanged)
    return () => api.setOnChanged(null)
  }, [api, onChanged])

  return { open: api ? api.open : () => {} }
}
