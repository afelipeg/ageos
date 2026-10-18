// Imported BEFORE @openuidev/react-lang. In development builds the package
// auto-mounts its "OpenUI Inspect" devtools widget, which injects an overlay
// into document.body and loads a browser bundle from a public CDN. The demo
// must not show third-party overlays or make external requests, so the
// package's own auto-mount flag is set first and the bootstrap becomes a no-op.
const AUTO_MOUNT_FLAG = Symbol.for("openui.devtools.autoMount")
;(globalThis as unknown as Record<symbol, unknown>)[AUTO_MOUNT_FLAG] = true

export {}
