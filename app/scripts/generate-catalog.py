#!/usr/bin/env python3
"""Regenerates lib/capabilities/catalog.generated.ts from the package contracts.

Run from app/: python3 -I scripts/generate-catalog.py
Reads ../cobertura-42-skills.json, ../rutas-y-pantallas.json and
../referencias/agency-erp-matriz-42-skills.json. IDs and routes are copied
verbatim; nothing is renamed.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
cov = json.loads((root / "cobertura-42-skills.json").read_text())
rut = json.loads((root / "rutas-y-pantallas.json").read_text())
mat = json.loads((root / "referencias/agency-erp-matriz-42-skills.json").read_text())
wb = {w["skill_id"]: w for w in rut["workflow_bindings"]}
mx = {s["skill"]: s for s in mat["skills"]}

modules = [
    {
        "id": m["id"], "key": m["key"], "label": m["label"],
        "navigationGroup": m["navigation_group"]["en"].lower(),
        "skillIds": m["skill_ids"], "icon": m["sidebar_icon"]["name"],
        "reuiReferences": m.get("reui_references", []),
    }
    for m in rut["modules"]
]
caps = []
for s in cov["skills"]:
    w, m = wb[s["skill_id"]], mx[s["skill_id"]]
    caps.append({
        "skillId": s["skill_id"], "moduleKey": s["module_key"], "moduleId": w["module_id"],
        "actionId": s["action_id"], "specialistKey": s["future_agent"], "route": s["route"],
        "label": w["label"], "primaryAction": w["primary_action"],
        "deliverableSummary": m["deliverable_summary"],
        "inputRequirement": s["input_requirement"], "inputsFromRepository": m["inputs_from_repository"],
        "outputRequirement": s["output_requirement"], "repositoryOutputs": s["repository_outputs"],
        "calculatorDependencies": s["calculator_dependencies"],
        "connectorOptions": m.get("connector_options", []), "externalMode": s["external_mode"],
        "acceptance": {
            "positive": s["acceptance"]["positive"], "negative": s["acceptance"]["negative"],
            "testId": s["acceptance"]["test_id"], "sourceAcceptance": w["source_acceptance"],
        },
        "completionRequires": w["completion_requires"],
    })
assert len(caps) == 42 and len({c["skillId"] for c in caps}) == 42 and len(modules) == 9

header = (
    "// GENERATED from cobertura-42-skills.json, rutas-y-pantallas.json and\n"
    "// referencias/agency-erp-matriz-42-skills.json by scripts/generate-catalog.py.\n"
    "// Do not edit by hand: IDs, routes and contracts are the canonical scope.\n\n"
    'import type { CapabilityContract, ModuleDefinition } from "./types"\n\n'
)
body = (
    "export const MODULES: readonly ModuleDefinition[] = "
    + json.dumps(modules, ensure_ascii=False, indent=2) + " as const\n\n"
    "export const CAPABILITY_CONTRACTS: readonly CapabilityContract[] = "
    + json.dumps(caps, ensure_ascii=False, indent=2) + " as const\n"
)
(Path(__file__).resolve().parents[1] / "lib/capabilities/catalog.generated.ts").write_text(header + body)
print(f"wrote {len(caps)} capabilities, {len(modules)} modules")
