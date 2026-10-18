// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"

import { CAPABILITY_CONTRACTS } from "@/lib/capabilities/catalog.generated"
import { JOURNEYS, journeyById, journeyStepHref } from "@/lib/demo/journeys"
import { fixtureUuid } from "@/lib/fixture-ids"

// Pure catalog checks against the canonical spec files (no database).
const spec = (f: string) => JSON.parse(readFileSync(path.resolve(process.cwd(), "..", f), "utf8"))
const scenarios = spec("demo-scenarios-v1.json") as { journeys: { id: string; module_keys: string[] }[] }
const routes = spec("rutas-y-pantallas.json") as { routes: { id: string; path: string }[] }
const fixtures = spec("demo-fixtures.json") as { users: { id: string }[]; platform_users: { id: string }[] }

describe("journey catalog J01–J10", () => {
  it("mirrors the ten spec journeys and their modules", () => {
    expect(JOURNEYS.map((j) => j.id)).toEqual(scenarios.journeys.map((j) => j.id))
    for (const j of JOURNEYS) {
      expect(j.moduleKeys).toEqual(scenarios.journeys.find((s) => s.id === j.id)!.module_keys)
      expect(j.name.en && j.name.es && j.expectedResult.en && j.expectedResult.es).toBeTruthy()
      expect(j.steps.length).toBeGreaterThan(0)
    }
  })

  it("every step uses a canonical route (same path) or an assistant preset, and a fixture persona", () => {
    const actors = new Set([...fixtures.users, ...fixtures.platform_users].map((u) => u.id))
    const ids = new Set<string>()
    for (const j of JOURNEYS) {
      expect(actors.has(j.actor)).toBe(true)
      for (const s of j.steps) {
        expect(ids.has(s.id)).toBe(false)
        ids.add(s.id)
        expect(actors.has(s.actor)).toBe(true)
        expect(s.label.en && s.label.es && s.expected.en && s.expected.es).toBeTruthy()
        if (s.surface.kind === "route") {
          const r = routes.routes.find((x) => x.id === (s.surface as { routeId: string }).routeId)
          expect(r?.path, `${s.id} route`).toBe(s.surface.path)
        } else {
          expect(s.surface.presetId).toMatch(/^preset\.(margin\.aurora|job\.create|skill\.agency-[a-z-]+)$/)
        }
      }
    }
  })

  it("J10 walks all 42 capabilities once; links resolve with fixture and runtime params", () => {
    const j10 = journeyById("J10")!
    const skills = j10.steps.filter((s) => s.surface.kind === "route" && s.surface.routeId === "workflow-workbench").map((s) => s.performs)
    expect(new Set(skills).size).toBe(42)
    expect(skills).toEqual(CAPABILITY_CONTRACTS.map((c) => c.skillId))
    const href = journeyStepHref(j10.steps[1]!, { fixtureId: fixtureUuid })
    expect(href).toBe(`/a/rayo-de-sol/modules/${CAPABILITY_CONTRACTS[0]!.moduleKey}/workflows/${CAPABILITY_CONTRACTS[0]!.skillId}`)
    const j09 = journeyById("J09")!
    expect(journeyStepHref(j09.steps[1]!, { fixtureId: fixtureUuid })).toBe(`/ops/incidents/${fixtureUuid("ops_csv_delimiter_mismatch")}`)
    expect(journeyStepHref(j09.steps[3]!, { fixtureId: fixtureUuid })).toBeNull()
    expect(journeyStepHref(j09.steps[3]!, { fixtureId: fixtureUuid, runtime: { changeId: "c1" } })).toBe("/ops/changes/c1")
    const j04 = journeyById("J04")!
    expect(journeyStepHref(j04.steps[2]!, { fixtureId: fixtureUuid })).toBe(`/a/rayo-de-sol/jobs/${fixtureUuid("job_demo_aurora")}?preset=preset.margin.aurora`)
    expect(journeyById("J02")!.entryCheckpoint).toBe("from_intake")
    expect(journeyById("nope")).toBeNull()
  })
})
