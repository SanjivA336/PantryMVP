import type { StorageLocationType } from '../types/entities'

// Single source of truth for storage-type display name + color, mirroring
// foodCategories.ts. Tailwind auto-generates bg-storage-*/text-storage-*
// utilities from the --color-storage-* tokens declared in index.css; the
// `/15` opacity modifier gives each badge a soft tinted background without
// needing a separate `-soft` token per type.
export const STORAGE_TYPE_LABELS: Record<StorageLocationType, string> = {
  FRIDGE: 'Fridge',
  FREEZER: 'Freezer',
  PANTRY: 'Pantry',
  OTHER: 'Other',
}

export const STORAGE_TYPE_BADGE_CLASSES: Record<StorageLocationType, string> = {
  FRIDGE: 'bg-storage-fridge/15 text-storage-fridge',
  FREEZER: 'bg-storage-freezer/15 text-storage-freezer',
  PANTRY: 'bg-storage-pantry/15 text-storage-pantry',
  OTHER: 'bg-storage-other/15 text-storage-other',
}

export const STORAGE_TYPE_BORDER_CLASSES: Record<StorageLocationType, string> = {
  FRIDGE: 'border-storage-fridge',
  FREEZER: 'border-storage-freezer',
  PANTRY: 'border-storage-pantry',
  OTHER: 'border-storage-other',
}

export const STORAGE_TYPES: StorageLocationType[] = ['FRIDGE', 'FREEZER', 'PANTRY', 'OTHER']
