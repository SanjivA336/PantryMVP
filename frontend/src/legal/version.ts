// Identifies the current wording of the Terms of Service and Privacy Policy
// together. It's sent at signup and stored against the account (see migration
// 0040), so a later change can tell who accepted which wording.
//
// Bump this (and each document's "updated" date, plus the Word files) whenever
// the wording changes in a way users should re-accept, such as adding billing
// or new kinds of data collection. Pure typo fixes don't need a bump.
export const LEGAL_VERSION = '2026-10-01'
