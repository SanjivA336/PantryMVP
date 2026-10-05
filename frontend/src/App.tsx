import { useEffect } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useParams } from 'react-router-dom'
import { DiagnosticsHost } from './components/DiagnosticsPanel'
import { ServerWakingScreen } from './components/ServerWakingScreen'
import { warmUpServer } from './lib/apiClient'
import { AuthProvider } from './context/AuthContext'
import { AuthGuard } from './components/AuthGuard'
import { DeveloperGuard } from './components/DeveloperGuard'
import { SignupPage } from './pages/auth/SignupPage'
import { LoginPage } from './pages/auth/LoginPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { TermsPage } from './pages/legal/TermsPage'
import { PrivacyPage } from './pages/legal/PrivacyPage'
import { HouseholdPickerPage } from './pages/households/HouseholdPickerPage'
import { CreateHouseholdPage } from './pages/households/CreateHouseholdPage'
import { JoinHouseholdPage } from './pages/households/JoinHouseholdPage'
import { HouseholdShell } from './pages/households/HouseholdShell'
import { BurrowDetails } from './pages/settings/BurrowDetails'
import { MembersScreen } from './pages/settings/MembersScreen'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { ActivityPage } from './pages/activity/ActivityPage'
import { AccountPage } from './pages/account/AccountPage'
import { InventoryPage } from './pages/inventory/InventoryPage'
import { InventoryItemDetailPage } from './pages/inventory/InventoryItemDetailPage'
import { BalancesPage } from './pages/ledger/BalancesPage'
import { ShoppingListPage } from './pages/shopping-list'
import { RecipesPage } from './pages/recipes'
import { AddRecipePage } from './pages/recipes/AddRecipePage'
import { EditRecipePage } from './pages/recipes/EditRecipePage'
import { RecipeDetailPage } from './pages/recipes/RecipeDetailPage'
import { ImportRecipePage } from './pages/recipes/ImportRecipePage'
import { GenerateRecipePage } from './pages/recipes/GenerateRecipePage'
import { ScanReceiptPage } from './pages/scan-receipt'
import { ReviewReceiptSessionPage } from './pages/scan-receipt/ReviewReceiptSessionPage'

function AccountRedirect() {
  const { householdId } = useParams<{ householdId: string }>()
  return <Navigate to={`/households/${householdId}/settings/account`} replace />
}

function App() {
  // Once per page load: starts waking a sleeping backend right away.
  useEffect(() => {
    warmUpServer()
  }, [])

  return (
    <BrowserRouter>
      <ServerWakingScreen />
      <DiagnosticsHost />
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Public on purpose: people read these before they have an account. */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          <Route element={<AuthGuard />}>
            <Route path="/" element={<HouseholdPickerPage />} />
            <Route path="/households/new" element={<CreateHouseholdPage />} />
            <Route path="/households/join" element={<JoinHouseholdPage />} />
            <Route path="/households/:householdId" element={<HouseholdShell />}>
              <Route index element={<InventoryPage />} />
              <Route path="inventory-items/:itemId" element={<InventoryItemDetailPage />} />
              <Route path="balances" element={<BalancesPage />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route path="burrow" element={<BurrowDetails />} />
                <Route path="members" element={<MembersScreen />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="account" element={<AccountPage />} />
              </Route>
              {/* Account used to be its own page; it now lives inside Settings. */}
              <Route path="account" element={<AccountRedirect />} />
              <Route path="storage/:storageLocationId" element={<InventoryPage />} />
              <Route path="shopping-list" element={<ShoppingListPage />} />
              <Route path="recipes" element={<RecipesPage />} />
              <Route path="recipes/new" element={<AddRecipePage />} />
              <Route path="recipes/import" element={<ImportRecipePage />} />
              <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
              <Route path="recipes/:recipeId/edit" element={<EditRecipePage />} />
              <Route element={<DeveloperGuard />}>
                <Route path="recipes/generate" element={<GenerateRecipePage />} />
                <Route path="scan-receipt" element={<ScanReceiptPage />} />
                <Route path="scan-receipt/:sessionId" element={<ReviewReceiptSessionPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
