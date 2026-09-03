import { useMemo, useState } from 'react'
import { ArrowRight, History, PartyPopper, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import type { Member, Settlement, SettlementRecord } from '../../types/entities'

interface Props {
  householdId: string
  settlements: Settlement[] | null
  settlementRecords: SettlementRecord[] | null
  members: Member[] | null
  loading: boolean
  onChange: () => void
}

interface FormState {
  payer: string
  payee: string
  amount: string
  note: string
}

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function SettlementsSection({
  householdId,
  settlements,
  settlementRecords,
  members,
  loading,
  onChange,
}: Props) {
  const activeMembers = useMemo(() => (members ?? []).filter((m) => m.is_active), [members])
  const nicknameById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m.nickname])),
    [members],
  )
  const name = (id: string) => nicknameById.get(id) ?? 'Unknown member'

  const [form, setForm] = useState<FormState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const openBlankForm = () => {
    setError(null)
    setForm({
      payer: activeMembers[0]?.id ?? '',
      payee: activeMembers[1]?.id ?? activeMembers[0]?.id ?? '',
      amount: '',
      note: '',
    })
  }

  const openPrefilledForm = (settlement: Settlement) => {
    setError(null)
    setForm({
      payer: settlement.debtor_member_id,
      payee: settlement.creditor_member_id,
      amount: Number(settlement.amount).toFixed(2),
      note: '',
    })
  }

  const submitForm = async () => {
    if (!form) return
    if (form.payer === form.payee) {
      setError('Payer and payee must be different people.')
      return
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/ledger/settlement-records`, {
        payer_member_id: form.payer,
        payee_member_id: form.payee,
        amount: form.amount,
        note: form.note.trim() || null,
      })
      setForm(null)
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const reverseRecord = async (id: string) => {
    setError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/ledger/settlement-records/${id}`)
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  // History = originals only; a reversal row is bookkeeping. An original is
  // "reversed" when some row points back at it.
  const history = useMemo(() => {
    const records = settlementRecords ?? []
    const reversedIds = new Set(
      records.map((r) => r.reverses_settlement_id).filter((v): v is string => v !== null),
    )
    return records
      .filter((r) => r.reverses_settlement_id === null)
      .map((r) => ({ record: r, reversed: reversedIds.has(r.id) }))
  }, [settlementRecords])

  const activeHistoryCount = history.filter((h) => !h.reversed).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          The fewest transfers that would settle every balance -- not necessarily the same as any
          single purchase on record.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={openBlankForm}
            className="flex items-center gap-1.5 rounded-control bg-primary-soft px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-bg"
          >
            <Plus size={15} strokeWidth={2} />
            Record a payment
          </button>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1.5 rounded-control border border-subtle px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <History size={15} strokeWidth={1.75} />
            Past settlements
            {activeHistoryCount > 0 && (
              <span className="rounded-pill bg-surface-2 px-1.5 text-xs">{activeHistoryCount}</span>
            )}
          </button>
        </div>
      </div>

      {error && !form && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !settlements || settlements.length === 0 ? (
        <EmptyState icon={PartyPopper} title="Everyone's settled up." />
      ) : (
        <ul className="flex flex-col gap-2">
          {settlements.map((settlement, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-card border border-subtle bg-surface px-4 py-3 shadow-card"
            >
              <span className="font-medium">{name(settlement.debtor_member_id)}</span>
              <ArrowRight size={16} strokeWidth={2} className="shrink-0 text-faint" />
              <span className="font-medium">{name(settlement.creditor_member_id)}</span>
              <span className="ml-auto text-lg font-semibold text-primary">
                ${Number(settlement.amount).toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => openPrefilledForm(settlement)}
                className="shrink-0 rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                Record
              </button>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <Modal title="Record a payment" onClose={() => setForm(null)}>
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-muted">Who paid</label>
                <select
                  className={inputClass}
                  value={form.payer}
                  onChange={(e) => setForm({ ...form, payer: e.target.value })}
                >
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nickname}
                    </option>
                  ))}
                </select>
              </div>
              <ArrowRight size={16} strokeWidth={2} className="mb-2.5 shrink-0 text-faint" />
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-muted">Who received</label>
                <select
                  className={inputClass}
                  value={form.payee}
                  onChange={(e) => setForm({ ...form, payee: e.target.value })}
                >
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nickname}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                className={inputClass}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Note (optional)</label>
              <input
                type="text"
                placeholder="e.g. Venmo"
                className={inputClass}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={submitForm}
                className="rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Record payment'}
              </button>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-control px-3 py-2 text-sm font-medium text-muted hover:bg-surface-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {historyOpen && (
        <Modal title="Past settlements" onClose={() => setHistoryOpen(false)}>
          {error && <p className="mb-2 text-sm text-danger">{error}</p>}
          {history.length === 0 ? (
            <p className="text-sm text-muted">No payments recorded yet.</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {history.map(({ record, reversed }) => (
                <li
                  key={record.id}
                  className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2 text-sm"
                >
                  <div className={`min-w-0 flex-1 ${reversed ? 'opacity-50' : ''}`}>
                    <p className={reversed ? 'line-through' : ''}>
                      <span className="font-medium">{name(record.payer_member_id)}</span>
                      {' → '}
                      <span className="font-medium">{name(record.payee_member_id)}</span>
                      <span className="ml-2 font-semibold text-primary">
                        ${Number(record.amount).toFixed(2)}
                      </span>
                    </p>
                    <p className="text-xs text-faint">
                      {formatDate(record.created_at)}
                      {record.note && ` · ${record.note}`}
                    </p>
                  </div>
                  {reversed ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-xs text-muted">
                      <RotateCcw size={11} strokeWidth={2} />
                      Reversed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reverseRecord(record.id)}
                      aria-label="Reverse this payment"
                      title="Reverse this payment"
                      className="shrink-0 rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  )
}
