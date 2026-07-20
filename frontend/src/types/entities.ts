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
}

export interface HouseholdWarnings {
  expiry_warnings: ExpiryWarning[]
  stock_warnings: StockWarning[]
}
