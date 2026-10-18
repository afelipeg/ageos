# Third-party notices

AgeOS itself is proprietary (see [LICENSE](LICENSE)). It incorporates the
third-party components below, which are **not** covered by that license and
remain subject to their own terms.

## 1. Verve template and ReUI (Keenthemes)

- **Component:** the Verve admin template (v1.1.0) and the ReUI components it is
  built on, by Keenthemes. The `app/` shell, layout, `components/ui/`,
  `components/reui/` and styling conventions derive from it.
- **License:** commercial, "licensed, not sold". It is used here under the
  owner's ReUI license. The template is **not redistributable**: the original
  terms forbid reselling, sublicensing or redistributing it, publishing it
  (in whole or in substantial part) to a public repository, template
  marketplace or component library, and sharing the license key or copy of the
  files outside the licensee's organisation.
- **Original terms:** [app/LICENSE-VERVE.md](app/LICENSE-VERVE.md) (the
  license file that shipped with the template, renamed). Full terms:
  https://reui.io/license
- **Consequence for this repository:** it must remain private and must not be
  shared with anyone outside the organisation. The licensed archive and its
  extracted copy (`inputs/reui/verve/`) are excluded from version control.
- Registry components vendored under `app/components/ui/` and
  `app/components/reui/` originate from the ReUI and shadcn registries and
  stay subject to their upstream terms; confirm them before any redistribution.
  The color theme follows the tweakcn "Vercel" theme (see D02 in
  `app/DECISIONS.md`); upstream terms apply.

## 2. npm dependencies

Packages installed from npm are governed by their own licenses, not by the
AgeOS license. Direct runtime dependencies of `app/` (`dependencies` in
`app/package.json`), with the `license` field read from each installed
package's `package.json`:

| Package | Version | License |
|---|---|---|
| `@base-ui/react` | 1.6.0 | MIT |
| `@date-fns/tz` | 1.5.0 | MIT |
| `@dnd-kit/core` | 6.3.1 | MIT |
| `@dnd-kit/modifiers` | 9.0.0 | MIT |
| `@dnd-kit/sortable` | 10.0.0 | MIT |
| `@dnd-kit/utilities` | 3.2.2 | MIT |
| `@headless-tree/core` | 1.7.0 | MIT |
| `@headless-tree/react` | 1.7.0 | MIT |
| `@openuidev/react-lang` | 0.3.0 | MIT |
| `@shadcn/react` | 0.3.1 | MIT |
| `@tanstack/react-table` | 9.0.0 | MIT |
| `@tanstack/react-virtual` | 3.14.6 | MIT |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `clsx` | 2.1.1 | MIT |
| `date-fns` | 4.4.0 | MIT |
| `drizzle-orm` | 0.45.3 | Apache-2.0 |
| `lucide-react` | 1.24.0 | ISC |
| `motion` | 12.42.2 | MIT |
| `next` | 16.2.12 | MIT |
| `next-themes` | 0.4.6 | MIT |
| `postgres` | 3.4.9 | Unlicense |
| `react` | 19.2.8 | MIT |
| `react-day-picker` | 10.0.1 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `react-phone-number-input` | 3.4.17 | MIT |
| `recharts` | 3.8.0 | MIT |
| `server-only` | 0.0.1 | MIT |
| `shadcn` | 4.13.0 | MIT |
| `sonner` | 2.0.7 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `tw-animate-css` | 1.4.0 | MIT |
| `zod` | 4.6.5 | MIT |

Development dependencies (`devDependencies`) and all transitive dependencies
are likewise governed by their own licenses; they are not listed here. Run a
license audit of the lockfile (`app/pnpm-lock.yaml`) before any distribution.
