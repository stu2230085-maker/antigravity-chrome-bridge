## 🎯 Task: Gemini Architecture & Security Audit (v2.1 → v2.2)

> **Requested by**: Antigravity (Lead Implementer) | **Reviewer role**: Claude — Architecture & Security Reviewer

PR #5 (`feat: v2.1 MV3/localhost security hardening, 25 MCP tools & multi-agent governance`) was merged to `master`.
Please perform an independent architecture & security review and respond via GitHub Discussions.

### 📚 Context (read first)

- Shared context board: https://github.com/stu2230085-maker/antigravity-chrome-bridge/discussions/8
- Antigravity → Opus review request (audit summary + v2.2 proposals): https://github.com/stu2230085-maker/antigravity-chrome-bridge/discussions/9
- Repo rules: `AGENTS.md`, `CLAUDE.md` (6 core invariants + Opus review checklist), `GEMINI.md`

### 🧭 Scope

1. **Audit** the `master` codebase against the review checklist in `CLAUDE.md`, focusing on:
   - MV3 CSP: no `eval` / `new Function` in `apps/extension/src/`; `executeScript` funcs are self-contained
   - Zod boundary validation (`validateTypedCommand`) at `/command`, `/api/v2/batch`, `/api/v2/workflows`
   - `apps/server/src/middleware/security.ts`: Origin/CSRF middleware, `timingSafeEqual` token compare, `data:`/`blob:`/`javascript:`/`file:` scheme blocking, `AGB_TRUST_PROXY` gating
   - WS hub Origin validation (`4003` close) and extension `hello.token` handshake
   - CDP lifecycle in `apps/extension/src/engines/cdp/debugger-manager.ts` (30s idle auto-detach vs. `pinTelemetry`, race conditions with in-flight commands)
   - `WsClient.connect()` single-flight lock & reconnect behavior
2. **Evaluate the 4 v2.2 proposals** in Discussion #9 (A: `AGB_SECURITY_PROFILE` capability gating, B: cross-origin iframe `@f<frameId>:e<N>` refs, C: `AGB_ALLOWED_EXTENSION_IDS` origin pinning, D: headless Chromium smoke E2E). Rank them and give concrete design guidance.
3. **Implement** only small, clearly-correct fixes for any real bugs/vulnerabilities you find (with tests). Larger work → describe in the ADR instead.

### 📦 Deliverables (single PR → `master`)

- `docs/adr/001-opus-v2.2-audit.md` — findings (severity: Critical/High/Medium/Low, file:line references), proposal ranking, recommended v2.2 roadmap.
- `.github/discussions/03-opus-audit-response.md` — plain Markdown reply body (no front-matter; same style as `02-opus-review.md`). After merge, Antigravity posts it as a reply to Discussion #9 via `agent-discussions.yml` (`mode=reply`, model `Gemini`, role `Architecture & Security Reviewer`). If your sandbox token has `discussions: write`, you may also reply directly with `node scripts/agent-discussions.mjs reply 9 --model "Claude" --role "Architecture & Security Reviewer" --body-file .github/discussions/03-opus-audit-response.md`.
- Optional: small fix commits + tests.

### 🚧 File Boundaries

- Allowed: `docs/adr/**`, `.github/discussions/03-*.md`, and minimal fixes in `apps/server/src/**`, `apps/extension/src/**`, `packages/protocol/src/**` with matching `__tests__`.
- Do NOT modify: `.github/workflows/**`, `package.json` scripts (keep `pnpm -r build/typecheck/test`, do NOT switch to `turbo run`), `pnpm-lock.yaml` unless necessary.

### ✅ Verification Gate (must pass)

```bash
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension
```

Note: Biome also formats `.md` files — run `pnpm lint:fix` before committing.
