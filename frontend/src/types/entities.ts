export type UnitSystem = 'METRIC' | 'CUSTOMARY'

// Mirrors backend/app/schemas/units.py's Unit enum -- the closed vocabulary
// every unit field in the app stores. COUNT deliberately stays the single
// 'count' value rather than enumerating package types (bag, box, can, ...),
// since their actual contents vary by product.
export type Unit =
  | 'g'
  | 'kg'
  | 'oz'
  | 'lb'
  | 'ml'
  | 'l'
  | 'tsp'
  | 'tbsp'
  | 'fl_oz'
  | 'cup'
  | 'pt'
  | 'qt'
  | 'gal'
  | 'count'

export interface Household {
  id: string
  name: string
  address: string | null
  join_code: string
  owner_id: string
  preferred_unit_system: UnitSystem
  created_at: string
  updated_at: string
}

export interface Member {
  id: string
  household_id: string
  user_id: string | null
  nickname: string
  is_admin: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export type StorageLocationType = 'FRIDGE' | 'FREEZER' | 'PANTRY' | 'OTHER'

export interface StorageLocation {
  id: string
  household_id: string
  name: string
  type: StorageLocationType
  description: string | null
  created_at: string
  updated_at: string
}

// SHARED is the one split rule for anyone but a solo owner -- an equal
// allotment per person that degrades to usage-based billing for whoever
// exceeds theirs. Replaces the old SHARED_CONSUMABLE/UNIT_BASED distinction.
export type AccountingType = 'SHARED' | 'PERSONAL'

export type FoodCategory =
  | 'PROTEINS'
  | 'VEGETABLES_HERBS'
  | 'FRUITS'
  | 'GRAINS_BREADS'
  | 'DAIRY_ALTERNATIVES'
  | 'SEASONINGS_SPICES'
  | 'OILS_FATS'
  | 'SAUCES_CONDIMENTS'
  | 'SNACKS_SWEETS'
  | 'BEVERAGES'
  | 'OTHER'

export interface FoodDefinition {
  id: string
  name: string
  preferred_unit: Unit
  category: FoodCategory
  accounting_type_default: AccountingType
  shelf_life_days: number | null
  freezer_shelf_life_days: number | null
  common_substitutions: string[]
  created_by_user_id: string | null
  is_verified: boolean
  usage_count: number
  duplicate_of_id: string | null
  created_at: string
  updated_at: string
}

export type Dimension = 'WEIGHT' | 'VOLUME' | 'COUNT'

export interface MeasurementPreference {
  dimension: Dimension
  // null only for COUNT, which has no metric/customary distinction.
  unit_system: UnitSystem | null
  unit: Unit
}

export type InventoryItemStatus = 'ACTIVE' | 'EMPTY' | 'DISCARDED' | 'EXPIRED' | 'LOST'
export type RemovalReason = 'DISCARDED' | 'EXPIRED' | 'LOST'

export interface InventoryItem {
  id: string
  household_id: string
  household_food_variant_id: string
  storage_location_id: string
  purchase_event_id: string
  quantity: string
  total_quantity: string
  preferred_unit: Unit
  cost: string
  purchased_at: string
  expiry_date: string | null
  best_by_date: string | null
  freeze_by_date: string | null
  is_frozen: boolean
  freeze_date: string | null
  status: InventoryItemStatus
  accounting_type: AccountingType
  split_member_count: number | null
  // Null while cost/total_quantity/allowed-members are still live and
  // directly editable; set once the item leaves ACTIVE, at which point its
  // final share is posted as real ledger entries and further changes need
  // a correction (see PurchaseCorrection) instead of a plain edit.
  debt_frozen_at: string | null
  created_at: string
  updated_at: string
  name_override: string | null
  food_name: string
  food_type_name: string
  category: FoodCategory | null
  storage_location_name: string
  allowed_member_ids: string[]
}

export interface PurchaseCorrection {
  id: string
  household_id: string
  inventory_item_id: string
  corrected_by_member_id: string
  previous_cost: string | null
  new_cost: string | null
  previous_total_quantity: string | null
  new_total_quantity: string | null
  note: string | null
  created_at: string
}

export type LedgerEntryReason = 'PURCHASE' | 'OVERAGE' | 'ADJUSTMENT'

export interface LedgerEntry {
  id: string
  household_id: string
  creditor_member_id: string
  debtor_member_id: string
  amount: string
  reason: LedgerEntryReason
  source_purchase_event_id: string | null
  source_consumption_event_id: string | null
  created_at: string
}

export interface LedgerBalance {
  debtor_member_id: string
  creditor_member_id: string
  amount: string
}

export interface LedgerEntryDetail extends LedgerEntry {
  food_name: string | null
}

export interface Settlement {
  debtor_member_id: string
  creditor_member_id: string
  amount: string
}

// A payment that actually happened, logged after the fact -- distinct from
// Settlement above (a step in the computed settle-up plan). A row with
// reverses_settlement_id set is a reversal (parties swapped) that undoes
// the settlement it points at; the UI hides it and marks the original.
export interface SettlementRecord {
  id: string
  household_id: string
  payer_member_id: string
  payee_member_id: string
  amount: string
  note: string | null
  recorded_by_member_id: string
  reverses_settlement_id: string | null
  created_at: string
}

// Mirrors backend/app/schemas/activity.py's ActivityType. ITEM_REMOVED
// covers all four endings via detail.reason (USED_UP / DISCARDED /
// EXPIRED / LOST).
export type ActivityType =
  | 'ITEM_ADDED'
  | 'ITEM_CONSUMED'
  | 'ITEM_REMOVED'
  | 'ITEM_MOVED'
  | 'COST_CORRECTED'
  | 'SETTLEMENT_RECORDED'
  | 'SETTLEMENT_REVERSED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'

export interface ActivityEvent {
  id: string
  household_id: string
  type: ActivityType
  // Null when there's no actor worth showing (an item hitting zero) or the
  // actor's account was later deleted -- actor_nickname stays readable.
  actor_member_id: string | null
  actor_nickname: string | null
  subject_name: string | null
  detail: Record<string, unknown>
  created_at: string
}

export type ExpiryWarningType = 'EXPIRING_SOON' | 'EXPIRED'
export type StockWarningType = 'LOW_STOCK' | 'OUT_OF_STOCK'

export interface ExpiryWarning {
  type: ExpiryWarningType
  inventory_item_id: string
  food_name: string
  storage_location_name: string
  relevant_date: string
  days_until: number
}

export interface StockWarning {
  type: StockWarningType
  household_food_variant_id: string
  food_name: string
  preferred_unit: Unit
  remaining_quantity: string
  reference_quantity: string
  reference_purchased_at: string
}

export interface HouseholdWarnings {
  expiry_warnings: ExpiryWarning[]
  stock_warnings: StockWarning[]
}

export type ShoppingListItemSource = 'MANUAL' | 'SUGGESTED'
export type ShoppingListItemStatus = 'ACTIVE' | 'REMOVED'

export interface ShoppingListSection {
  id: string
  household_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ShoppingListItem {
  id: string
  household_id: string
  section_id: string | null
  name: string
  household_food_variant_id: string | null
  source: ShoppingListItemSource
  status: ShoppingListItemStatus
  collected: boolean
  sort_order: number
  added_by_member_id: string
  removed_at: string | null
  created_at: string
  updated_at: string
}

export interface Recipe {
  id: string
  created_by_user_id: string
  name: string
  description: string | null
  servings: number
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  instructions: string[]
  created_at: string
  updated_at: string
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  global_food_definition_id: string
  food_name: string
  category: FoodCategory | null
  quantity: string
  unit: Unit
  note: string | null
  position: number
  available: boolean
  available_quantity: string | null
}

export interface RecipeDetail extends Recipe {
  ingredients: RecipeIngredient[]
}

// AI-produced, never persisted directly -- the frontend holds this only in
// memory until the user reviews it (via RecipeForm) and saves it through
// the normal recipe-create endpoint, same as a hand-typed recipe.
export interface DraftRecipeIngredient {
  name: string
  quantity: string | null
  unit: Unit | null
  note: string | null
  // Filled in server-side when the AI's ingredient name exactly matches a
  // real food (inventory first, then the wider catalog) -- null means no
  // confident match, same as today's manual-pick-required state.
  global_food_definition_id: string | null
}

export interface DraftRecipe {
  name: string
  description: string | null
  servings: number | null
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  instructions: string[]
  ingredients: DraftRecipeIngredient[]
  source_url: string | null
}

export interface SubstitutionSuggestion {
  name: string
  quantity: string | null
  unit: Unit | null
  note: string | null
}

export type ReceiptImportSessionStatus =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'FINALIZED'
export type ReceiptImportItemStatus = 'NEEDS_REVIEW' | 'CONFIRMED' | 'SKIPPED' | 'IMPORTED'

export interface ReceiptImportSession {
  id: string
  household_id: string
  created_by_member_id: string
  status: ReceiptImportSessionStatus
  image_path: string
  ocr_engine: string | null
  raw_ocr_text: string | null
  error_message: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}

export interface ReceiptImportItem {
  id: string
  session_id: string
  position: number
  raw_line_text: string
  parsed_name: string | null
  parsed_quantity: string | null
  parsed_unit: string | null
  parsed_price: string | null
  global_food_definition_id: string | null
  food_name: string | null
  category: FoodCategory | null
  storage_location_id: string | null
  storage_location_name: string | null
  quantity: string | null
  preferred_unit: Unit | null
  cost: string | null
  accounting_type: AccountingType | null
  allowed_member_ids: string[]
  status: ReceiptImportItemStatus
  created_inventory_item_id: string | null
  created_at: string
  updated_at: string
}

export interface ReceiptImportSessionWithItems extends ReceiptImportSession {
  items: ReceiptImportItem[]
}

export interface CreateReceiptImportSessionResponse {
  id: string
  upload_bucket: string
  upload_path: string
}
