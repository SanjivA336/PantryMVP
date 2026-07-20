import { z } from 'zod'

export const createHouseholdSchema = z.object({
  name: z.string().min(1, 'Give your household a name'),
  address: z.string().optional(),
  nickname: z.string().min(1, 'Enter a nickname for yourself'),
})
export type CreateHouseholdForm = z.infer<typeof createHouseholdSchema>

export const joinHouseholdSchema = z.object({
  join_code: z
    .string()
    .length(8, 'Join codes are 8 characters')
    .transform((value) => value.toUpperCase()),
  nickname: z.string().min(1, 'Enter a nickname for yourself'),
})
export type JoinHouseholdForm = z.infer<typeof joinHouseholdSchema>
