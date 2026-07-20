import { z } from 'zod'

export const storageLocationSchema = z.object({
  name: z.string().min(1, 'Give this storage location a name'),
  type: z.enum(['FRIDGE', 'FREEZER', 'PANTRY', 'GARDEN', 'OTHER']),
  description: z.string().optional(),
})
export type StorageLocationForm = z.infer<typeof storageLocationSchema>
