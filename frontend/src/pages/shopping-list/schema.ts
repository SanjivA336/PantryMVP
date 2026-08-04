import { z } from 'zod'

export const addShoppingListSectionSchema = z.object({
  name: z.string().min(1, 'Enter a section name'),
})
export type AddShoppingListSectionForm = z.infer<typeof addShoppingListSectionSchema>
