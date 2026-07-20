import { Link, useParams } from 'react-router-dom'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { Recipe } from '../../types/entities'

export function RecipesPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const {
    data: recipes,
    loading,
    error,
  } = useHouseholdResource<Recipe[]>(householdId ? `/api/households/${householdId}/recipes` : null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recipes</h2>
        <div className="flex gap-2">
          <Link
            to={`/households/${householdId}/recipes/import`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
          >
            Import from URL
          </Link>
          <Link
            to={`/households/${householdId}/recipes/generate`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
          >
            Generate with AI
          </Link>
          <Link
            to={`/households/${householdId}/recipes/new`}
            className="rounded-md px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            + New Recipe
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : !recipes || recipes.length === 0 ? (
        <p className="text-sm text-gray-500">No recipes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link
                to={`/households/${householdId}/recipes/${recipe.id}`}
                className="block rounded-md border border-gray-200 bg-white p-4 hover:border-gray-300"
              >
                <span className="font-medium">{recipe.name}</span>
                <p className="text-sm text-gray-500">
                  Serves {recipe.servings}
                  {recipe.prep_time_minutes != null && <> · Prep {recipe.prep_time_minutes}m</>}
                  {recipe.cook_time_minutes != null && <> · Cook {recipe.cook_time_minutes}m</>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
