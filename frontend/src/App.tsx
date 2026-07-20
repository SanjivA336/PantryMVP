import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { AuthGuard } from './components/AuthGuard'
import { SignupPage } from './pages/auth/SignupPage'
import { LoginPage } from './pages/auth/LoginPage'
import { HouseholdPickerPage } from './pages/households/HouseholdPickerPage'
import { CreateHouseholdPage } from './pages/households/CreateHouseholdPage'
import { JoinHouseholdPage } from './pages/households/JoinHouseholdPage'
import { HouseholdShell } from './pages/households/HouseholdShell'
import { MembersPage } from './pages/members/MembersPage'
import { StoragePage } from './pages/storage/StoragePage'
import { InventoryPage } from './pages/inventory/InventoryPage'
import { AddInventoryItemPage } from './pages/inventory/AddInventoryItemPage'
import { BalancesPage } from './pages/ledger/BalancesPage'
import { ShoppingListPage } from './pages/shopping-list'
import { RecipesPage } from './pages/recipes'
import { AddRecipePage } from './pages/recipes/AddRecipePage'
import { EditRecipePage } from './pages/recipes/EditRecipePage'
import { RecipeDetailPage } from './pages/recipes/RecipeDetailPage'
import { ImportRecipePage } from './pages/recipes/ImportRecipePage'
import { GenerateRecipePage } from './pages/recipes/GenerateRecipePage'
import { ScanReceiptPage } from './pages/scan-receipt'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<AuthGuard />}>
            <Route path="/" element={<HouseholdPickerPage />} />
            <Route path="/households/new" element={<CreateHouseholdPage />} />
            <Route path="/households/join" element={<JoinHouseholdPage />} />
            <Route path="/households/:householdId" element={<HouseholdShell />}>
              <Route index element={<InventoryPage />} />
              <Route path="inventory/add" element={<AddInventoryItemPage />} />
              <Route path="balances" element={<BalancesPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="storage" element={<StoragePage />} />
              <Route path="shopping-list" element={<ShoppingListPage />} />
              <Route path="recipes" element={<RecipesPage />} />
              <Route path="recipes/new" element={<AddRecipePage />} />
              <Route path="recipes/import" element={<ImportRecipePage />} />
              <Route path="recipes/generate" element={<GenerateRecipePage />} />
              <Route path="recipes/:recipeId" element={<RecipeDetailPage />} />
              <Route path="recipes/:recipeId/edit" element={<EditRecipePage />} />
              <Route path="scan-receipt" element={<ScanReceiptPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
