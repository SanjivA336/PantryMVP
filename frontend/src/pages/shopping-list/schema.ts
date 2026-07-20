import { z } from 'zod'

export const addShoppingListItemSchema = z.object({
  name: z.string().min(1, 'Enter an item name'),
  section_id: z.string().optional(),
})
export type AddShoppingListItemForm = z.infer<typeof addShoppingListItemSchema>

export const addShoppingListSectionSchema = z.object({
  name: z.string().min(1, 'Enter a section name'),
})
export type AddShoppingListSectionForm = z.infer<typeof addShoppingListSectionSchema>
