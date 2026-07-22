export interface Household {
  id: string
  name: string
  address: string | null
  join_code: string
  created_by_user_id: string
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

export type StorageLocationType = 'FRIDGE' | 'FREEZER' | 'PANTRY' | 'GARDEN' | 'OTHER'

export interface StorageLocation {
  id: string
  household_id: string
  name: string
  type: StorageLocationType
  description: string | null
  created_at: string
  updated_at: string
}

export type AccountingType = 'UNIT_BASED' | 'SHARED_CONSUMABLE' | 'PERSONAL'

export interface FoodDefinition {
  id: string
  name: string
  preferred_unit: string
  food_group: string | null
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
  preferred_unit: string
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
  created_at: string
  updated_at: string
  food_name: string
  storage_location_name: string
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
  settled_at: string | null
  created_at: string
}

export interface LedgerBalance {
  debtor_member_id: string
  creditor_member_id: string
  amount: string
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
  preferred_unit: string
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
  added_by_member_id: string
  removed_at: string | null
  created_at: string
  updated_at: string
}

export interface Recipe {
  id: string
  household_id: string
  created_by_member_id: string
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
  quantity: string
  unit: string
  note: string | null
  position: number
  available: boolean
  available_quantity: string | null
}

export interface RecipeDetail extends Recipe {
  ingredients: RecipeIngredient[]
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
  storage_location_id: string | null
  storage_location_name: string | null
  quantity: string | null
  preferred_unit: string | null
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
