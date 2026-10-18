// Canonical job dossier tabs (?tab=). Shared by the server page and the
// client tab bar; kept out of "use client" modules so the server gets values.
export const DOSSIER_TABS = ["overview", "scope", "production", "media", "finance", "files", "activity"] as const
export type DossierTab = (typeof DOSSIER_TABS)[number]
