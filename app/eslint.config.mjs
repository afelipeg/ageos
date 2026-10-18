import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated locally (uploads, per-agent test files, WIP migrations, E2E output).
    ".data/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "tests/e2e/.output/**",
  ]),

  // Vendored registry code. `components/reui/**` and `components/ui/**` are
  // installed and overwritten by the shadcn CLI (`shadcn add @reui/...`), so
  // they are not ours to edit: any fix here is silently reverted the next time
  // a component is added or updated, and the project rule is to reuse ReUI
  // primitives rather than restyle them.
  //
  // These rules are downgraded for those paths only, so the app code they are
  // meant to police stays fully covered. The upstream issues are real and worth
  // reporting to ReUI rather than patching locally: as of @reui data-grid on
  // TanStack Table v9 that is 6 set-state-in-effect in filters.tsx, 3
  // "cannot access refs during render" plus 2 use-memo violations in
  // data-grid.tsx, and 4 eslint-disable directives that no longer suppress
  // anything.
  {
    name: "vendored/reui-registry",
    files: ["components/reui/**/*.{ts,tsx}", "components/ui/**/*.{ts,tsx}"],
    linterOptions: {
      // Registry files ship their own eslint-disable comments, which go stale
      // as the rules move. Flagging them tells us nothing actionable.
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/use-memo": "off",
      // components/reui/gantt (ReUI 2026-10): mutates hook values, calls an
      // impure function during render and breaks manual memoization.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/incompatible-library": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
])

export default eslintConfig
