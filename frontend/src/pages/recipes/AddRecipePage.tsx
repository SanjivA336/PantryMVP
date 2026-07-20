import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import type { RecipeDetail } from '../../types/entities'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

export function AddRecipePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()

  const onSubmit = async (body: RecipeSubmitBody) => {
    const recipe = await apiClient.post<RecipeDetail>(
      `/api/households/${householdId}/recipes`,
      body,
    )
    navigate(`/households/${householdId}/recipes/${recipe.id}`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold">New recipe</h2>
      <RecipeForm submitLabel="Create recipe" onSubmit={onSubmit} />
    </div>
  )
}
