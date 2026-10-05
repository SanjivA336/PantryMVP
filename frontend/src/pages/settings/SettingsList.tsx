import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileText,
  History,
  Home,
  LogOut,
  ShieldCheck,
  Trash2,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { AppVersion } from '../../components/AppVersion'
import { DeleteBurrowModal } from '../../components/DeleteBurrowModal'
import { LogoutConfirmModal } from '../../components/LogoutConfirmModal'
import { useAuth } from '../../hooks/useAuth'
import { InviteCard } from './InviteCard'
import type { SettingsContext } from './settingsContext'

const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL

const rowClass =
  'flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors'

interface RowProps {
  icon: LucideIcon
  label: string
  // What the row currently holds ("606 Standard", "4"), shown on the right.
  value?: string | number
  danger?: boolean
}

function RowBody({
  icon: Icon,
  label,
  value,
  danger,
  trailing,
}: RowProps & { trailing?: ReactNode }) {
  return (
    <>
      <Icon size={18} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value !== undefined && value !== '' && (
        <span className={`max-w-[45%] truncate font-normal ${danger ? '' : 'text-muted'}`}>
          {value}
        </span>
      )}
      {trailing}
    </>
  )
}

// A row that opens one of the Settings screens (highlighted on desktop when it
// is the one showing).
function ScreenRow(props: RowProps & { to: string }) {
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) =>
        `${rowClass} ${isActive ? 'bg-primary-soft text-primary' : 'text-text hover:bg-surface-hover'}`
      }
    >
      <RowBody
        {...props}
        trailing={<ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-faint" />}
      />
    </NavLink>
  )
}

// A row that opens a web page in a new tab.
function LinkRow(props: RowProps & { href: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${rowClass} text-text hover:bg-surface-hover`}
    >
      <RowBody
        {...props}
        trailing={<ExternalLink size={14} strokeWidth={1.75} className="shrink-0 text-faint" />}
      />
    </a>
  )
}

// A row that does something right here.
function ActionRow(props: RowProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`${rowClass} ${
        props.danger ? 'text-danger hover:bg-danger-soft' : 'text-text hover:bg-surface-hover'
      }`}
    >
      <RowBody {...props} />
    </button>
  )
}

function Group({
  title,
  danger,
  children,
}: {
  title?: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section>
      {title && (
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
          {title}
        </h3>
      )}
      <div
        className={`divide-y overflow-hidden rounded-card border ${
          danger
            ? 'divide-danger/20 border-danger/30 bg-danger-soft'
            : 'divide-subtle border-subtle bg-surface'
        }`}
      >
        {children}
      </div>
    </section>
  )
}

// The Settings home: everything about this burrow, the people in it, your own
// account and the app, as short grouped rows. Each row opens its own screen (or
// a link, or a confirmation), so no screen is a long wall of controls.
export function SettingsList({ ctx }: { ctx: SettingsContext }) {
  const { household, members, isAdmin } = ctx
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const memberCount = (members ?? []).filter((m) => m.is_active).length

  const handleSignOut = async () => {
    setLoggingOut(true)
    try {
      await signOut()
      navigate('/login')
    } finally {
      setLoggingOut(false)
      setLogoutOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {household && <InviteCard household={household} />}

      <Group title="This burrow">
        <ScreenRow to="burrow" icon={Home} label="Burrow details" value={household?.name} />
        <ScreenRow
          to="members"
          icon={Users}
          label="Members"
          value={members ? memberCount : undefined}
        />
        <ScreenRow to="activity" icon={History} label="Activity" />
      </Group>

      <Group title="You">
        <ScreenRow to="account" icon={UserCircle} label="Account" value={user?.email} />
        <ActionRow icon={LogOut} label="Log out" onClick={() => setLogoutOpen(true)} />
      </Group>

      <Group title="Help and about">
        {SUPPORT_URL && <LinkRow href={SUPPORT_URL} icon={CircleHelp} label="Contact support" />}
        <LinkRow href="/terms" icon={FileText} label="Terms of Service" />
        <LinkRow href="/privacy" icon={ShieldCheck} label="Privacy Policy" />
      </Group>

      {isAdmin && household && (
        <Group danger>
          <ActionRow
            danger
            icon={Trash2}
            label="Delete this burrow"
            onClick={() => setDeleteOpen(true)}
          />
        </Group>
      )}

      <AppVersion className="text-center" />

      {logoutOpen && (
        <LogoutConfirmModal
          loggingOut={loggingOut}
          onClose={() => setLogoutOpen(false)}
          onConfirm={() => void handleSignOut()}
        />
      )}
      {deleteOpen && household && (
        <DeleteBurrowModal household={household} onClose={() => setDeleteOpen(false)} />
      )}
    </div>
  )
}
