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
