// Identifies the current wording of the Terms of Service and Privacy Policy
// together. It's sent at signup and stored against the account (see migration
// 0040), so a later change can tell who accepted which wording.
//
// Bump this (and each document's "updated" date, plus the Word files) whenever
// the wording changes in a way users should re-accept, such as adding billing
// or new kinds of data collection. Pure typo fixes don't need a bump.
//
// Format: the date of the change, plus ".N" when the wording is revised again
// on the same day (the first version of a day has no suffix). The database
// accepts any non-empty value up to 32 characters.
//
// History: 2026-10-01 (first version), 2026-10-01.2 (named Cloudflare and
// Render as hosting providers before launch).
export const LEGAL_VERSION = '2026-10-01.2'
