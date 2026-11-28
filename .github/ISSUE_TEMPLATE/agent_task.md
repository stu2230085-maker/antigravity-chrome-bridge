---

name: "🤖 AI Agent Task"
description: "Antigravity / Copilot / Claude / Codex / Jules 向けの構造化実装タスク定義"
title: "[Task]: "
labels: ["agent-task"]
---

## 1. 概要・目的 (Goal)

<!-- 何を解決・実装するタスクか簡潔に記述してください -->

## 2. 対象スコープ・ファイル境界 (Scope & Workspace Affected)

<!-- 変更を許可するワークスペースにチェックを入れ、並列作業時のファイル境界を明示してください -->

- [ ] `packages/protocol` (`@antigravity-bridge/protocol`)
- [ ] `packages/sdk` (`@antigravity-bridge/sdk`)
- [ ] `apps/server` (`@antigravity-bridge/server`)
- [ ] `apps/extension` (`@antigravity-bridge/extension`)
- [ ] `apps/dashboard` (`@antigravity-bridge/dashboard`)
- [ ] `packages/cli` (`@antigravity-bridge/cli`)
- [ ] `packages/mcp` (`@antigravity-bridge/mcp`)
- [ ] `e2e` (`@antigravity-bridge/e2e`)
- [ ] `scripts/` / `.github/` / ドキュメント

**編集対象ファイル / 非編集境界 (Strict File Boundary)**:

- 編集可: `...`
- 編集禁止: `...`

## 3. 実装要件・受け入れ条件 (Acceptance Criteria)

- [ ] 要件 1:
- [ ] 要件 2:
- [ ] 対応するユニットテストまたは E2E テストの追加

## 4. MV3 & セキュリティ不変条件チェックリスト (`CLAUDE.md`)

- [ ] **MV3 CSP 準拠**: `apps/extension` 内で `eval()` / `new Function()` を一切使用しない
- [ ] **注入関数の自己完結性**: `chrome.scripting.executeScript` の `func` は外部クロージャ・`import` を参照せず `args` のみを受け取る
- [ ] **境界バリデーション & 互換性**: `@antigravity-bridge/protocol` の Zod スキーマで入力を検証し、`POST /command` の v1 互換を維持する
- [ ] **認証 & Origin 防御**: トークン比較に `timingSafeEqual` を使用し、HTTP/WS の `Origin`（CSRF・`chrome-extension://`）防御を維持する
- [ ] **URL スキーム & ドメインポリシー**: `file:`・`data:`・`blob:`・`chrome:`・`javascript:` 等のスキーム制御とドメイン制限を全経路で適用する
- [ ] **CDP ライフサイクル**: `chrome.debugger` の多重アタッチ防止・アイドル自動デタッチ・テレメトリピン留め保護を維持する

## 5. 必須検証ゲート (Verification Gate)

PR 提出前に以下のコマンドがすべてエラー・警告ゼロで通過することを確認してください：

```bash
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension
```

## 6. 関連リンク (Related Discussion / ADR)

- Related Discussion: #<!-- Discussion 番号または URL (`node scripts/agent-discussions.mjs view <N>`) -->
- Reference Docs: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
