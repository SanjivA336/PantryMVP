import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import type { DraftRecipe, RecipeDetail } from '../../types/entities'
import { draftRecipeToFormInitial } from './aiDraftAdapter'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

// The backend allows up to ai_request_timeout_seconds (60s) for the
// initial call plus one repair retry on bad output -- worst case ~120s
// server-side. This must clear that with margin, or the client aborts and
// shows "timed out" for a request the backend would have finished.
const AI_TIMEOUT_MS = 130_000

type Source = 'text' | 'url'

export function ImportRecipePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()

  const [source, setSource] = useState<Source>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)

  const runImport = async () => {
    setImportError(null)
    setImporting(true)
    try {
      const body =
        source === 'text' ? { source, text: text.trim() } : { source, url: url.trim() }
      const result = await apiClient.post<DraftRecipe>(
        `/api/households/${householdId}/recipes/ai/import`,
        body,
        { timeoutMs: AI_TIMEOUT_MS },
      )
      setDraft(result)
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setImporting(false)
    }
  }

  const onSubmit = async (body: RecipeSubmitBody) => {
    const recipe = await apiClient.post<RecipeDetail>(
      `/api/households/${householdId}/recipes`,
      body,
    )
    navigate(`/households/${householdId}/recipes/${recipe.id}`)
  }

  if (draft) {
    return (
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-1 text-xl font-semibold">Review imported recipe</h2>
        <p className="mb-4 text-sm text-muted">
          Check the AI's work below, especially quantities and units, then pick a real food for
          each ingredient before saving.
        </p>
        <RecipeForm
          initial={draftRecipeToFormInitial(draft)}
          submitLabel="Save recipe"
          onSubmit={onSubmit}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-xl font-semibold">Import a recipe</h2>

      <div className="mb-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setSource('text')}
          className={`rounded-control px-2 py-2 font-medium transition-colors ${
            source === 'text'
              ? 'bg-primary text-bg'
              : 'border border-subtle text-muted hover:bg-surface-hover'
          }`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => setSource('url')}
          className={`rounded-control px-2 py-2 font-medium transition-colors ${
            source === 'url'
              ? 'bg-primary text-bg'
              : 'border border-subtle text-muted hover:bg-surface-hover'
          }`}
        >
          From a URL
        </button>
      </div>

      {source === 'text' ? (
        <textarea
          rows={10}
          placeholder="Paste the full recipe text here…"
          className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <input
          type="url"
          placeholder="https://example.com/some-recipe"
          className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}

      {importError && <p className="mt-3 text-sm text-danger">{importError}</p>}

      <button
        type="button"
        onClick={runImport}
        disabled={importing || (source === 'text' ? !text.trim() : !url.trim())}
        className="mt-4 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {importing ? 'Importing…' : 'Import'}
      </button>
    </div>
  )
}
