import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import { ApiError } from '../../lib/apiClient'
import type { FoodDefinition, RecipeDetail } from '../../types/entities'
import { recipeSchema, type RecipeForm as RecipeFormValues, type RecipeFormInput } from './schema'

export interface RecipeIngredientBody {
  global_food_definition_id: string
  quantity: string
  unit: string
  note: string | null
}

export interface RecipeSubmitBody {
  name: string
  description: string | null
  servings: number
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  instructions: string[]
  ingredients: RecipeIngredientBody[]
}

interface IngredientRow {
  food: Pick<FoodDefinition, 'id' | 'name'> | null
  quantity: string
  unit: string
  note: string
}

const emptyIngredientRow = (): IngredientRow => ({ food: null, quantity: '', unit: '', note: '' })

interface Props {
  initial?: RecipeDetail
  submitLabel: string
  onSubmit: (body: RecipeSubmitBody) => Promise<void>
}

export function RecipeForm({ initial, submitLabel, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecipeFormInput, unknown, RecipeFormValues>({
    resolver: zodResolver(recipeSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          description: initial.description ?? '',
          servings: initial.servings,
          prep_time_minutes: initial.prep_time_minutes ?? undefined,
          cook_time_minutes: initial.cook_time_minutes ?? undefined,
        }
      : { name: '', servings: 4 },
  })

  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    initial && initial.ingredients.length > 0
      ? initial.ingredients.map((ing) => ({
          food: { id: ing.global_food_definition_id, name: ing.food_name },
          quantity: ing.quantity,
          unit: ing.unit,
          note: ing.note ?? '',
        }))
      : [emptyIngredientRow()],
  )
  const [instructions, setInstructions] = useState<string[]>(
    initial && initial.instructions.length > 0 ? initial.instructions : [''],
  )
  const [formError, setFormError] = useState<string | null>(null)

  const updateIngredient = (index: number, patch: Partial<IngredientRow>) =>
    setIngredients((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const removeIngredient = (index: number) =>
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  const updateInstruction = (index: number, text: string) =>
    setInstructions((prev) => prev.map((step, i) => (i === index ? text : step)))
  const removeInstruction = (index: number) =>
    setInstructions((prev) => prev.filter((_, i) => i !== index))

  const submit = async (values: RecipeFormValues) => {
    setFormError(null)
    const validIngredients = ingredients.filter(
      (row) => row.food && row.quantity.trim() && row.unit.trim(),
    )
    if (validIngredients.length === 0) {
      setFormError('Add at least one ingredient')
      return
    }
    const validInstructions = instructions.map((step) => step.trim()).filter(Boolean)

    try {
      await onSubmit({
        name: values.name,
        description: values.description?.trim() || null,
        servings: values.servings,
        prep_time_minutes: values.prep_time_minutes ?? null,
        cook_time_minutes: values.cook_time_minutes ?? null,
        instructions: validInstructions,
        ingredients: validIngredients.map((row) => ({
          global_food_definition_id: row.food!.id,
          quantity: row.quantity,
          unit: row.unit,
          note: row.note.trim() || null,
        })),
      })
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Recipe name</label>
        <input
          type="text"
          className="w-full rounded-md border border-gray-300 px-3 py-2"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Description (optional)</label>
        <textarea
          rows={2}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
          {...register('description')}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Servings</label>
          <input
            type="number"
            min={1}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register('servings')}
          />
          {errors.servings && (
            <p className="mt-1 text-sm text-red-600">{errors.servings.message}</p>
          )}
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Prep time (min)</label>
          <input
            type="number"
            min={0}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register('prep_time_minutes')}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Cook time (min)</label>
          <input
            type="number"
            min={0}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...register('cook_time_minutes')}
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Ingredients</label>
        <div className="flex flex-col gap-3">
          {ingredients.map((row, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                <FoodSearchInput
                  value={row.food}
                  onChange={(food) => updateIngredient(index, { food })}
                />
              </div>
              <input
                type="number"
                step="any"
                placeholder="Qty"
                className="w-20 rounded-md border border-gray-300 px-2 py-2"
                value={row.quantity}
                onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
              />
              <input
                type="text"
                placeholder="Unit"
                className="w-24 rounded-md border border-gray-300 px-2 py-2"
                value={row.unit}
                onChange={(e) => updateIngredient(index, { unit: e.target.value })}
              />
              <input
                type="text"
                placeholder="Note (optional)"
                className="w-32 rounded-md border border-gray-300 px-2 py-2"
                value={row.note}
                onChange={(e) => updateIngredient(index, { note: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeIngredient(index)}
                className="px-2 py-2 text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIngredients((prev) => [...prev, emptyIngredientRow()])}
          className="mt-2 text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          + Add ingredient
        </button>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Instructions</label>
        <div className="flex flex-col gap-2">
          {instructions.map((step, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2 text-sm text-gray-400">{index + 1}.</span>
              <textarea
                rows={1}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2"
                value={step}
                onChange={(e) => updateInstruction(index, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeInstruction(index)}
                className="px-2 py-2 text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInstructions((prev) => [...prev, ''])}
          className="mt-2 text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          + Add step
        </button>
      </div>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
