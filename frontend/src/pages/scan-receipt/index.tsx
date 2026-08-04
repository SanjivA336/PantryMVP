import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Camera, Receipt, Upload } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { uploadReceiptImage } from '../../lib/receiptStorage'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { CreateReceiptImportSessionResponse, ReceiptImportSession } from '../../types/entities'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing…',
  COMPLETED: 'Ready for review',
  FAILED: 'Failed',
  FINALIZED: 'Imported',
}

export function ScanReceiptPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const {
    data: sessions,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<ReceiptImportSession[]>(
    householdId ? `/api/households/${householdId}/receipt-import-sessions` : null,
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow picking the same file again later
    if (!file || !householdId) return

    setUploadError(null)
    setUploading(true)
    try {
      const created = await apiClient.post<CreateReceiptImportSessionResponse>(
        `/api/households/${householdId}/receipt-import-sessions`,
        { filename: file.name },
      )
      await uploadReceiptImage(created.upload_bucket, created.upload_path, file)
      await apiClient.post(
        `/api/households/${householdId}/receipt-import-sessions/${created.id}/process`,
      )
      navigate(`/households/${householdId}/scan-receipt/${created.id}`)
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Something went wrong')
      reload()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Scan Receipt</h2>

      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover ${uploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Upload size={16} strokeWidth={2.25} />
          Upload a picture
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-control border border-subtle px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text ${uploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Camera size={16} strokeWidth={1.75} />
          Take a picture
          {/* `capture` triggers the camera on phones; desktop browsers
              typically just fall back to a plain file picker -- no device
              detection needed either way. */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {uploading && <span className="text-sm text-muted">Uploading…</span>}
      </div>

      {(uploadError || loadError) && (
        <p className="text-sm text-danger">{uploadError ?? loadError}</p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Past scans</h3>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !sessions || sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
            <Receipt size={28} strokeWidth={1.5} className="text-faint" />
            <p className="text-sm text-muted">No receipts scanned yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  to={`/households/${householdId}/scan-receipt/${session.id}`}
                  className="flex items-center justify-between rounded-card border border-subtle bg-surface px-4 py-3 shadow-card transition-colors hover:bg-surface-hover"
                >
                  <span className="text-sm text-muted">
                    {new Date(session.created_at).toLocaleString()}
                  </span>
                  <span
                    className={
                      session.status === 'FAILED' ? 'text-sm text-danger' : 'text-sm font-medium'
                    }
                  >
                    {STATUS_LABELS[session.status] ?? session.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
