**Type:** wayfinder:grilling
**Blocked by:** none
**Blocks:** 027, 028, 029, 030, 031, 032, 033, 034, 035, 036

## Question

Design the Electron shell, confirmed as a **sidecar** architecture (Electron shell launches/manages the
existing Express server as a separate process; it stays usable headless too, not merged into Electron
main). Resolve the remaining specifics: does the renderer talk to the sidecar server directly over
`localhost` HTTP/WS the way `ChatInterface.tsx` does today (simplest, keeps main process thin), or does
Electron main proxy those calls through `contextBridge`/IPC (more isolation, matches the munder-difflin
reference's pattern, but more plumbing)? How does main manage the server process's lifecycle (spawn on
app start, health-check, restart on crash, clean shutdown on app quit — `HiveServer.stop()` already
exists)? What port strategy avoids collisions with an already-running dev-mode server? Also decide the
live-update transport for streaming task output and dashboard/kanban state changes to the renderer — WS
(protocol types already sketched, unused, in `packages/shared/src/protocol.ts`) vs. SSE vs. polling —
since every panel ticket below needs this answered to know how it receives live data. Window
management (single window with panel-switching vs. multiple windows) is in scope here too.
