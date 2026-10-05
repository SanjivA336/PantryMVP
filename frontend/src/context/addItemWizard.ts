import { createContext } from 'react'

// The one add-item flow for a household, owned by HouseholdShell and shared with
// everything inside it (the Inventory page, the tab bar's + button). There must
// be exactly one: each copy of the logic reopens an in-progress order from the
// address on its own, so two copies meant two stacked sheets after a reload.
export interface AddItemWizardApi {
  // Starts a new order and opens the sheet.
  open: () => void
  // The page currently showing can ask to be told when the sheet closes, to
  // refresh its own data. Pass null to stop.
  setOnChanged: (callback: (() => void) | null) => void
}

export const AddItemWizardContext = createContext<AddItemWizardApi | null>(null)
