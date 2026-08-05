import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useIsDeveloper } from '../../hooks/useIsDeveloper'
import type { DraftRecipe, RecipeDetail } from '../../types/entities'
import { draftRecipeToFormInitial } from './aiDraftAdapter'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

// The backend allows up to ai_request_timeout_seconds (60s) for the
// initial call plus one repair retry on bad output -- worst case ~120s
// server-side. This must clear that with margin, or the client aborts and
// shows "timed out" for a request the backend would have finished.
const AI_TIMEOUT_MS = 130_000

type Source = 'text' | 'url' | 'json'

export function ImportRecipePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const isDeveloper = useIsDeveloper()

  // Non-developers only ever have the "json" (no-AI) path available -- see
  // the backend's require_developer gate on the text/url sources -- so
  // there's nothing to switch between and the tab row below doesn't render.
  const [source, setSource] = useState<Source>(isDeveloper ? 'text' : 'json')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [jsonData, setJsonData] = useState<Record<string, unknown> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)

  const onFilePicked = async (file: File) => {
    setImportError(null)
    setFileName(file.name)
    setJsonData(null)
    try {
      const contents = await file.text()
      setJsonData(JSON.parse(contents))
    } catch {
      setImportError("That file isn't valid JSON.")
    }
  }

  const runImport = async () => {
    setImportError(null)
    setImporting(true)
    try {
      const body =
        source === 'text'
          ? { source, text: text.trim() }
          : source === 'url'
            ? { source, url: url.trim() }
            : { source, json_data: jsonData }
      // JSON import is a plain parse + catalog re-resolution, no LLM call --
      // no need for the AI-scale timeout.
      const result = await apiClient.post<DraftRecipe>(
        `/api/households/${householdId}/recipes/ai/import`,
        body,
        source === 'json' ? undefined : { timeoutMs: AI_TIMEOUT_MS },
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

      {isDeveloper && (
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
          <button
            type="button"
            onClick={() => setSource('json')}
            className={`rounded-control px-2 py-2 font-medium transition-colors ${
              source === 'json'
                ? 'bg-primary text-bg'
                : 'border border-subtle text-muted hover:bg-surface-hover'
            }`}
          >
            From a file
          </button>
        </div>
      )}

      {source === 'text' ? (
        <textarea
          rows={10}
          placeholder="Paste the full recipe text here…"
          className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : source === 'url' ? (
        <input
          type="url"
          placeholder="https://example.com/some-recipe"
          className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      ) : (
        <div>
          <p className="mb-2 text-sm text-muted">
            Import a .json file someone exported from their own recipe box (see the Export
            button on any recipe's page).
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFilePicked(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-control border border-dashed border-subtle px-4 py-6 text-sm font-medium text-muted transition-colors hover:bg-surface-hover"
          >
            <Upload size={16} strokeWidth={1.75} />
            {fileName ?? 'Choose a .json file…'}
          </button>
        </div>
      )}

      {importError && <p className="mt-3 text-sm text-danger">{importError}</p>}

      <button
        type="button"
        onClick={runImport}
        disabled={
          importing ||
          (source === 'text' ? !text.trim() : source === 'url' ? !url.trim() : !jsonData)
        }
        className="mt-4 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {importing ? 'Importing…' : 'Import'}
      </button>
    </div>
  )
}
