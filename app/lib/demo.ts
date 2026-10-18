// Demo constants shared by server and UI. Business dates come from the fixture
// clock and are always shown separately from real audit timestamps.

export const DEMO_SEED_VERSION = "ageos-demo-2027-aurora-v1"
export const BUSINESS_AS_OF = "2027-03-15"
export const BUSINESS_PERIOD = { start: "2027-03-01", end: "2027-03-31", label: "2027-03" }
export const MARGIN_FLOOR_BPS = 4000
export const DEMO_DISCLOSURE = {
  en: "Demo · Scripted assistant · Simulated integrations",
  es: "Demo · Asistente guionado · Integraciones simuladas",
} as const
