import { useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, ApiError } from '../../lib/apiClient'
import { FieldTooltip } from '../../components/FieldTooltip'
import { useHideTabBar } from '../../hooks/useHideTabBar'
import { UNIT_SYSTEM_EXAMPLES, UNIT_SYSTEM_LABELS } from '../../lib/units'
import { updateHouseholdSchema, type UpdateHouseholdForm } from '../households/schema'
import type { UnitSystem } from '../../types/entities'
import type { SettingsContext } from './settingsContext'

const inputClass =
  'w-full rounded-control border border-subtle bg-field px-2 py-2 text-sm text-text shadow-field outline-none placeholder:text-faint focus:border-primary'

// The "Burrow details" screen: name, address and the default measurement system.
// (The join code lives on the Invite card, deleting on the list's red row.)
// Admins get editable fields and a Save bar that appears only once something
// has actually changed; everyone else sees the same facts read-only.
export function BurrowDetails() {
  const { householdId } = useParams<{ householdId: string }>()
  const { household, reloadHousehold, isAdmin } = useOutletContext<SettingsContext>()

  const [actionError, setActionError] = useState<string | null>(null)
  const [savingUnitSystem, setSavingUnitSystem] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateHouseholdForm>({ resolver: zodResolver(updateHouseholdSchema) })

  // The Save bar replaces the phone tab bar while there are unsaved changes.
  useHideTabBar(isDirty)

  // Seed the form once the burrow loads (reset, not defaultValues, so it picks up
  // fetched data that arrives after the first render). Never while there are
  // unsaved edits: choosing a measurement system reloads the burrow, and that
  // must not wipe a half-edited name.
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])
  useEffect(() => {
    if (household && !dirtyRef.current) {
      reset({ name: household.name, address: household.address ?? '' })
    }
  }, [household, reset])

  const onSave = async (values: UpdateHouseholdForm) => {
    setActionError(null)
    try {
      await apiClient.patch(`/api/households/${householdId}`, values)
      reset(values) // what is on screen is now what is saved: no longer "changed"
      reloadHousehold()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const chooseUnitSystem = async (system: UnitSystem) => {
    if (system === household?.preferred_unit_system) return
    setActionError(null)
    setSavingUnitSystem(true)
    try {
      await apiClient.patch(`/api/households/${householdId}`, { preferred_unit_system: system })
      reloadHousehold()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSavingUnitSystem(false)
    }
  }

  if (!household) return <p className="text-sm text-muted">Loading…</p>

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted">Burrow name</p>
          <p className="text-text">{household.name}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted">Address</p>
          <p className="text-text">{household.address || 'Not set'}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-muted">Default measurement system</p>
          <p className="text-text">
            {UNIT_SYSTEM_LABELS[household.preferred_unit_system]} (
            {UNIT_SYSTEM_EXAMPLES[household.preferred_unit_system]})
          </p>
        </div>
        <p className="text-xs text-faint">Only admins can edit or delete this burrow.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-5">
      <div>
        <label htmlFor="burrow-name" className="mb-1.5 block text-sm font-medium text-muted">
          Burrow name
        </label>
        <input type="text" className={inputClass} id="burrow-name" {...register('name')} />
        {errors.name && <p className="mt-1.5 text-sm text-danger">{errors.name.message}</p>}
      </div>
      <div>
        <label htmlFor="burrow-address" className="mb-1.5 block text-sm font-medium text-muted">
          Address (optional)
        </label>
        <input type="text" className={inputClass} id="burrow-address" {...register('address')} />
      </div>

      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-muted">
          Default measurement system
          <FieldTooltip text="Used when adding a food this burrow hasn't tracked before. Switching it for an individual food when you add or restock it overrides this default, and is remembered for next time." />
        </label>
        <div className="flex flex-wrap gap-2">
          {(['METRIC', 'CUSTOMARY'] as UnitSystem[]).map((system) => (
            <button
              key={system}
              type="button"
              disabled={savingUnitSystem}
              onClick={() => chooseUnitSystem(system)}
              className={`rounded-control border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                household.preferred_unit_system === system
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
              }`}
            >
              {UNIT_SYSTEM_LABELS[system]}
              <span className="ml-1.5 text-xs text-faint">({UNIT_SYSTEM_EXAMPLES[system]})</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-faint">Saves as soon as you choose.</p>
      </div>

      {!isDirty && actionError && <p className="text-sm text-danger">{actionError}</p>}

      {/* Appears only when the name or address has changed. Pinned to the bottom
          on a phone (in the tab bar's place); inline from the desktop breakpoint up. */}
      {isDirty && (
        <div className="pin-bottom fixed inset-x-0 bottom-0 z-20 border-t border-subtle bg-surface px-4 pb-[var(--bottom-bar-gap)] pt-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
          {actionError && <p className="mb-2 text-sm text-danger">{actionError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setActionError(null)
                reset({ name: household.name, address: household.address ?? '' })
              }}
              className="rounded-control border border-subtle px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50 md:py-2"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-control bg-primary px-3 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50 md:flex-none md:px-4 md:py-2"
            >
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
