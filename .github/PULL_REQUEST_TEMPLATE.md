## 概要 (Summary)

<!-- この PR で実装・修正した内容を簡潔に記述してください -->

- Closes #
- Related Discussion: #<!-- 関連する GitHub Discussion 番号または URL (任意) -->

## 変更対象スコープ (Scope / Workspaces Affected)

- [ ] `packages/protocol` (`@antigravity-bridge/protocol`)
- [ ] `packages/sdk` (`@antigravity-bridge/sdk`)
- [ ] `apps/server` (`@antigravity-bridge/server`)
- [ ] `apps/extension` (`@antigravity-bridge/extension`)
- [ ] `apps/dashboard` (`@antigravity-bridge/dashboard`)
- [ ] `packages/cli` (`@antigravity-bridge/cli`)
- [ ] `packages/mcp` (`@antigravity-bridge/mcp`)
- [ ] `e2e` (`@antigravity-bridge/e2e`)
- [ ] `scripts/` / `.github/` / Multi-Agent Docs (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)

## MV3 & セキュリティ不変条件チェックリスト (`CLAUDE.md`)

- [ ] **MV3 CSP 準拠**: Service Worker / 拡張コード内に `eval()`・`new Function()` が混入していない
- [ ] **`executeScript` 自己完結性**: ページ注入関数 (`func`) が外部スコープのクロージャや `import` を参照していない
- [ ] **Zod 境界検証 & v1 互換**: `POST /command` の v1 互換性を維持し、新規・変更 API を Zod スキーマで検証している
- [ ] **Origin / CSRF / 定数時間認証**: HTTP/WS の `Origin` 検証および `timingSafeEqual` によるトークン照合が維持されている
- [ ] **URL ドメイン & スキームポリシー**: `file:`・`data:`・`blob:`・`chrome:`・`javascript:` 等の遮断とドメイン制限がバイパスされない
- [ ] **CDP ライフサイクル**: `chrome.debugger` の排他制御・アイドル自動デタッチ・テレメトリピン留め整合性が保たれている

## 検証ゲート実行結果 (Verification Gate Results)

- [ ] `pnpm lint` (Biome check passed)
- [ ] `pnpm build` (All workspaces built cleanly)
- [ ] `pnpm typecheck` (`tsc --noEmit` passed)
- [ ] `pnpm test` (Unit & E2E suites passed)
- [ ] `pnpm package:extension` (`release/*.zip` packaged cleanly)

```text
# 必要に応じてテスト結果や検証ログの抜粋を貼り付けてください
```
