import { Link, useParams } from 'react-router-dom'
import { ChefHat, Clock, Plus, Sparkles, Wand2 } from 'lucide-react'
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Recipes</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/households/${householdId}/recipes/import`}
            className="flex items-center gap-1.5 rounded-control border border-subtle bg-surface px-2 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <Wand2 size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">Import</span>
          </Link>
          <Link
            to={`/households/${householdId}/recipes/generate`}
            className="flex items-center gap-1.5 rounded-control border border-subtle bg-surface px-2 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <Sparkles size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">Generate with AI</span>
          </Link>
          <Link
            to={`/households/${householdId}/recipes/new`}
            className="flex items-center gap-1.5 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            <Plus size={16} strokeWidth={2.25} />
            <span className="hidden sm:inline">New</span>
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !recipes || recipes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <ChefHat size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">No recipes yet.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link
                to={`/households/${householdId}/recipes/${recipe.id}`}
                className="flex h-full flex-col gap-2 rounded-card border border-subtle bg-surface p-4 shadow-card transition-colors hover:border-subtle-strong hover:bg-surface-hover"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                    <ChefHat size={18} strokeWidth={1.75} />
                  </div>
                  <span className="font-medium">{recipe.name}</span>
                </div>
                {recipe.description && (
                  <p className="line-clamp-2 text-sm text-muted">{recipe.description}</p>
                )}
                <div className="mt-auto flex items-center gap-3 pt-1 text-xs text-faint">
                  <span>Serves {recipe.servings}</span>
                  {(recipe.prep_time_minutes != null || recipe.cook_time_minutes != null) && (
                    <span className="flex items-center gap-1">
                      <Clock size={13} strokeWidth={1.75} />
                      {(recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0)}m
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
