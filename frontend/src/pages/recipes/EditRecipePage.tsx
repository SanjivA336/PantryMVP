import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { RecipeDetail } from '../../types/entities'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

export function EditRecipePage() {
  const { householdId, recipeId } = useParams<{ householdId: string; recipeId: string }>()
  const navigate = useNavigate()
  const {
    data: recipe,
    loading,
    error,
  } = useHouseholdResource<RecipeDetail>(
    householdId && recipeId ? `/api/households/${householdId}/recipes/${recipeId}` : null,
  )

  const onSubmit = async (body: RecipeSubmitBody) => {
    await apiClient.patch<RecipeDetail>(`/api/households/${householdId}/recipes/${recipeId}`, body)
    navigate(`/households/${householdId}/recipes/${recipeId}`)
  }

  if (loading) return <p className="text-sm">Loading…</p>
  if (error || !recipe) return <p className="text-sm text-red-600">{error ?? 'Recipe not found'}</p>

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold">Edit recipe</h2>
      <RecipeForm initial={recipe} submitLabel="Save changes" onSubmit={onSubmit} />
    </div>
  )
}
