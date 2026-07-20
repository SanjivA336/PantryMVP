import { z } from 'zod'

export const addInventoryItemSchema = z.object({
  storage_location_id: z.string().min(1, 'Pick a storage location'),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  preferred_unit: z.string().min(1),
  cost: z.coerce.number().min(0).optional(),
  expiry_date: z.string().optional(),
  best_by_date: z.string().optional(),
  allowed_member_ids: z.array(z.string()).min(1, 'Pick at least one member'),
  accounting_type: z.enum(['PERSONAL', 'SHARED_CONSUMABLE', 'UNIT_BASED']),
})
// react-hook-form's raw state holds string inputs (z.input) before
// submission; the resolver transforms them to the coerced types (z.output)
// only at submit time. Using just z.infer (= z.output) for both would make
// TS think the form state already holds numbers while inputs are typed.
export type AddInventoryItemFormInput = z.input<typeof addInventoryItemSchema>
export type AddInventoryItemForm = z.output<typeof addInventoryItemSchema>
