// The in-app Terms/Privacy pages render from plain data rather than hand-
// written JSX, so the wording lives in one place and the page markup can
// change without touching the legal text. `**bold**` is the only inline
// markup; bare https:// URLs are turned into links by the renderer.
export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }

export interface LegalDocument {
  title: string
  updated: string
  blocks: LegalBlock[]
}
