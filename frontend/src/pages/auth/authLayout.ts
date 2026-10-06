// The frame shared by the login, sign-up, forgot-password and reset-password screens.
//
// Phones: a flat page (no card). The form hangs from the top, 12.5% of the screen's height
// down, which puts the "Burrow" label and the heading ("Welcome back", "Create your
// account") at the same height on every one of these screens. BUT if hanging it there
// would put the form's centre below the halfway mark of the screen (a tall form on a short
// phone), it is centred at exactly halfway instead.
//
// How, without measuring anything: there is a spacer above the form (::before) and one below
// it (::after). Both grow into the leftover space equally, so by default the form is
// centred; the one above is capped at 12.5% of the screen height, and once it hits that cap
// all the remaining room goes below. So the gap above is min(12.5% of the screen, half the
// leftover space), and a form that fits comfortably hangs from the top while a tall one
// centres. Nothing scrolls, and it all scales with the screen's height.
//
// The cap is measured from the top of the screen, so it already includes the iPhone clock /
// Dynamic Island (--safe-top, which is also reserved as padding so the form can never end up
// under it). To move the form, change the 0.125 (0.1 = higher, 0.15 = lower).
//
// Desktop (md and up): the card is centred in the window, as before.
export const authScreenClass =
  "flex h-[var(--app-height)] flex-col items-center bg-surface px-0 pb-[env(safe-area-inset-bottom)] pt-[var(--safe-top)] text-text before:block before:max-h-[max(0px,calc(var(--app-height)*0.125-var(--safe-top)))] before:flex-1 before:content-[''] after:block after:flex-1 after:content-[''] md:h-auto md:min-h-app md:justify-center md:bg-bg md:p-4 md:before:hidden md:after:hidden"

export const authCardClass =
  'w-full max-w-sm bg-surface p-7 md:rounded-card md:border md:border-subtle md:shadow-card'
