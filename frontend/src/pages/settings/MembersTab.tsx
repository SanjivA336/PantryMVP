import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useAuth } from '../../hooks/useAuth'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { Household, Member } from '../../types/entities'

interface Props {
  members: Member[] | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function MembersTab({ members: allMembers, loading, error: loadError, reload }: Props) {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [actionError, setActionError] = useState<string | null>(null)

  // Ownership lives on the household, not the member row -- fetched
  // independently here the same way BurrowTab fetches it, since this tab
  // doesn't otherwise need any other household field.
  const { data: household, reload: reloadHousehold } = useHouseholdResource<Household>(
    householdId ? `/api/households/${householdId}` : null,
  )

  const members = (allMembers ?? []).filter((m) => m.is_active)
  const me = members.find((m) => m.user_id === user?.id)
  const isOwner = !!household && me?.user_id === household.owner_id

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

  const promoteToOwner = (member: Member) =>
    runAction(async () => {
      await apiClient.post(`/api/households/${householdId}/transfer-ownership`, {
        new_owner_member_id: member.id,
      })
      reloadHousehold()
    })

  // Deliberately not routed through runAction/reload -- once you've left,
  // you're no longer a member, so the reload that action would normally
  // trigger just 403s and strands you on a page you can't see anymore.
  const leave = async (member: Member) => {
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/members/${member.id}/leave`)
      navigate('/')
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const remove = (member: Member) =>
    runAction(() => apiClient.delete(`/api/households/${householdId}/members/${member.id}`))

  return (
    <div className="flex flex-col gap-4">
      {(loadError || actionError) && (
        <p className="text-sm text-danger">{loadError ?? actionError}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <Users size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">No members yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => {
            const isSelf = member.id === me?.id
            const isRowOwner = !!household && member.user_id === household.owner_id
            return (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-card border border-subtle bg-surface px-4 py-3 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{member.nickname}</span>
                  {isSelf && <span className="text-xs text-faint">(you)</span>}
                  {isRowOwner && (
                    <span className="rounded-pill bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      Owner
                    </span>
                  )}
                  {member.is_admin && (
                    <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
                      Admin
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && member.is_admin && !isRowOwner && (
                    <button
                      type="button"
                      onClick={() => promoteToOwner(member)}
                      className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      Promote to owner
                    </button>
                  )}
                  {me?.is_admin && !isSelf && (
                    <button
                      type="button"
                      onClick={() => toggleAdmin(member)}
                      disabled={isRowOwner}
                      title={isRowOwner ? 'Transfer ownership before changing admin status' : undefined}
                      className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {member.is_admin ? 'Revoke admin' : 'Make admin'}
                    </button>
                  )}
                  {isSelf && (
                    <button
                      type="button"
                      onClick={() => leave(member)}
                      disabled={isRowOwner}
                      title={isRowOwner ? 'Transfer ownership before leaving' : undefined}
                      className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      Leave
                    </button>
                  )}
                  {me?.is_admin && !isSelf && (
                    <button
                      type="button"
                      onClick={() => remove(member)}
                      disabled={isRowOwner}
                      title={isRowOwner ? 'Transfer ownership before removing them' : undefined}
                      className="rounded-control border border-subtle px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
