import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, X } from 'lucide-react'
import { AutoGrowTextarea } from '../../components/AutoGrowTextarea'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import { useHideTabBar } from '../../hooks/useHideTabBar'
import { ApiError } from '../../lib/apiClient'
import { DIMENSION_LABELS, UNITS_BY_DIMENSION, UNIT_LABELS } from '../../lib/units'
import type { Dimension, FoodDefinition, Unit } from '../../types/entities'
import { recipeSchema, type RecipeForm as RecipeFormValues, type RecipeFormInput } from './schema'

const DIMENSIONS: Dimension[] = ['WEIGHT', 'VOLUME', 'COUNT']

export interface RecipeIngredientBody {
  global_food_definition_id: string
  quantity: string
  unit: Unit
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

// The shape RecipeForm needs to seed itself, regardless of where the data
// came from -- a saved RecipeDetail (editing) or an AI-produced DraftRecipe
// (import/generate) never persisted anywhere yet. Each source adapts into
// this via its own small mapping function rather than RecipeForm knowing
// about either source directly.
export interface RecipeFormInitialIngredient {
  food: Pick<FoodDefinition, 'id' | 'name'> | null
  quantity: string
  unit: Unit | ''
  note: string
  // Only meaningful when `food` is null -- an AI-suggested ingredient name
  // to pre-seed FoodSearchInput's search box with, so the user isn't stuck
  // re-typing what the AI already told us before they can even search.
  suggestedName?: string
}

export interface RecipeFormInitial {
  name: string
  description: string | null
  servings: number | null
  prep_time_minutes: number | null
  cook_time_minutes: number | null
  instructions: string[]
  ingredients: RecipeFormInitialIngredient[]
}

interface IngredientRow {
  food: Pick<FoodDefinition, 'id' | 'name'> | null
  quantity: string
  unit: Unit | ''
  note: string
  suggestedName?: string
  // The note box is tucked behind a "+ note" button until it's needed (or until the
  // row already has a note). Not saved; it only controls what's shown.
  noteOpen?: boolean
}

const emptyIngredientRow = (): IngredientRow => ({ food: null, quantity: '', unit: '', note: '' })

// Deliberately no `w-full` here -- fixed-width fields below combine this
// with their own w-* class, and Tailwind resolves conflicting same-layer
// utilities by CSS declaration order (not class-string order), so pairing
// "w-20" with a "w-full"-bearing constant silently lets w-full win.
const fieldClass =
  'rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'
const inputClass = `w-full ${fieldClass}`

interface Props {
  initial?: RecipeFormInitial
  submitLabel: string
  onSubmit: (body: RecipeSubmitBody) => Promise<void>
}

export function RecipeForm({ initial, submitLabel, onSubmit }: Props) {
  // The Save bar below takes the tab bar's place on a phone.
  useHideTabBar()
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
          // AI-generated drafts don't always state servings -- fall back to
          // the same default a blank form starts with rather than leaving
          // the field empty and failing the "positive integer" validation
          // the instant the user touches submit without noticing why.
          servings: initial.servings ?? 4,
          prep_time_minutes: initial.prep_time_minutes ?? undefined,
          cook_time_minutes: initial.cook_time_minutes ?? undefined,
        }
      : { name: '', servings: 4 },
  })

  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    initial && initial.ingredients.length > 0
      ? initial.ingredients.map((ing) => ({
          food: ing.food,
          quantity: ing.quantity,
          unit: ing.unit,
          note: ing.note,
          suggestedName: ing.suggestedName,
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
      (row) => row.food && row.quantity.trim() && row.unit,
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
          unit: row.unit as Unit,
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
        <label className="mb-1.5 block text-sm font-medium text-muted">Recipe name</label>
        <input type="text" className={inputClass} {...register('name')} />
        {errors.name && <p className="mt-1.5 text-sm text-danger">{errors.name.message}</p>}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-muted">
          Description (optional)
        </label>
        <textarea rows={2} className={inputClass} {...register('description')} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Serves</label>
          <input type="number" min={1} className={inputClass} {...register('servings')} />
          {errors.servings && (
            <p className="mt-1.5 text-sm text-danger">{errors.servings.message}</p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Prep</label>
          <div className="relative">
            <input
              type="number"
              min={0}
              className={`${inputClass} pr-10`}
              {...register('prep_time_minutes')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-faint">
              min
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Cook</label>
          <div className="relative">
            <input
              type="number"
              min={0}
              className={`${inputClass} pr-10`}
              {...register('cook_time_minutes')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-faint">
              min
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-muted">Ingredients</label>
        <div className="flex flex-col gap-2">
          {ingredients.map((row, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-card border border-subtle bg-surface p-3"
            >
              <FoodSearchInput
                value={row.food}
                onChange={(food) => updateIngredient(index, { food })}
                initialQuery={row.suggestedName}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  placeholder="Qty"
                  className={`w-20 shrink-0 ${fieldClass}`}
                  value={row.quantity}
                  onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
                />
                <select
                  className={`min-w-0 flex-1 ${fieldClass}`}
                  value={row.unit}
                  onChange={(e) => updateIngredient(index, { unit: e.target.value as Unit | '' })}
                >
                  <option value="">Unit…</option>
                  {DIMENSIONS.map((dim) => (
                    <optgroup key={dim} label={DIMENSION_LABELS[dim]}>
                      {UNITS_BY_DIMENSION[dim].map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {!row.noteOpen && row.note === '' && (
                  <button
                    type="button"
                    onClick={() => updateIngredient(index, { noteOpen: true })}
                    className="shrink-0 rounded-control px-2 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-soft"
                  >
                    + note
                  </button>
                )}
                <button
                  type="button"
                  title="Remove ingredient"
                  aria-label="Remove ingredient"
                  onClick={() => removeIngredient(index)}
                  className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
              {(row.noteOpen || row.note !== '') && (
                <input
                  type="text"
                  placeholder="Note (optional)"
                  autoFocus={row.noteOpen && row.note === ''}
                  className={`w-full ${fieldClass}`}
                  value={row.note}
                  onChange={(e) => updateIngredient(index, { note: e.target.value })}
                  onBlur={() => {
                    // An opened-but-left-empty note folds back into "+ note".
                    if (row.note === '') updateIngredient(index, { noteOpen: false })
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIngredients((prev) => [...prev, emptyIngredientRow()])}
          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover"
        >
          <Plus size={16} strokeWidth={2.25} />
          Add ingredient
        </button>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-muted">Instructions</label>
        <div className="flex flex-col gap-2">
          {instructions.map((step, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2 text-sm text-faint">{index + 1}.</span>
              <AutoGrowTextarea
                className={`flex-1 ${inputClass}`}
                value={step}
                onChange={(e) => updateInstruction(index, e.target.value)}
              />
              <button
                type="button"
                title="Remove step"
                aria-label="Remove step"
                onClick={() => removeInstruction(index)}
                className="shrink-0 rounded-control p-2 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInstructions((prev) => [...prev, ''])}
          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover"
        >
          <Plus size={16} strokeWidth={2.25} />
          Add step
        </button>
      </div>

      {/* Pinned to the bottom on a phone (in the tab bar's place); an ordinary button at
          the end of the form from the desktop breakpoint up. */}
      <div className="pin-bottom fixed inset-x-0 bottom-0 z-20 border-t border-subtle bg-surface px-4 pb-[var(--bottom-bar-gap)] pt-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
        {formError && <p className="mb-2 text-sm text-danger md:mb-3">{formError}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-control bg-primary px-3 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50 md:w-auto md:px-2 md:py-2"
        >
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
