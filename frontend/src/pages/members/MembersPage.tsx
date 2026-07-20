import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { Member } from '../../types/entities'

export function MembersPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const { user } = useAuth()
  const {
    data: allMembers,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<Member[]>(householdId ? `/api/households/${householdId}/members` : null)
  const [actionError, setActionError] = useState<string | null>(null)

  const members = (allMembers ?? []).filter((m) => m.is_active)
  const me = members.find((m) => m.user_id === user?.id)

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const toggleAdmin = (member: Member) =>
    runAction(() =>
      apiClient.patch(`/api/households/${householdId}/members/${member.id}`, {
        is_admin: !member.is_admin,
      }),
    )

  const leave = (member: Member) =>
    runAction(() => apiClient.post(`/api/households/${householdId}/members/${member.id}/leave`))

  const remove = (member: Member) =>
    runAction(() => apiClient.delete(`/api/households/${householdId}/members/${member.id}`))

  if (loading) return <p className="text-sm">Loading members…</p>

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Members</h2>
      {(loadError || actionError) && (
        <p className="text-sm text-red-600">{loadError ?? actionError}</p>
      )}
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isSelf = member.id === me?.id
          return (
            <li
              key={member.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
            >
              <div>
                <span className="font-medium">{member.nickname}</span>
                {isSelf && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                {member.is_admin && (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                    Admin
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-sm">
                {me?.is_admin && !isSelf && (
                  <button
                    type="button"
                    onClick={() => toggleAdmin(member)}
                    className="text-gray-600 hover:underline"
                  >
                    {member.is_admin ? 'Revoke admin' : 'Make admin'}
                  </button>
                )}
                {isSelf && (
                  <button
                    type="button"
                    onClick={() => leave(member)}
                    className="text-red-600 hover:underline"
                  >
                    Leave
                  </button>
                )}
                {me?.is_admin && !isSelf && (
                  <button
                    type="button"
                    onClick={() => remove(member)}
                    className="text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
