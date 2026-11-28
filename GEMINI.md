# GEMINI.md — Antigravity / Gemini 実行ポリシー & クラウドエージェント連携ルール

本ドキュメントは、本リポジトリ (`stu2230085-maker/antigravity-chrome-bridge`) における **Antigravity** および **Gemini（Web 版 + GitHub Remote MCP）** の実行方針、コードベース主要エントリポイント、並列サブエージェント運用、外部 AI エージェント（**Claude Opus**・**Copilot SWE Agent**・**Claude Code Agent**・**OpenAI Codex Agent**・**Google Jules**）との連携ルールを定義します。

詳細なモノレポ構造・拡張境界は [AGENTS.md](AGENTS.md)、アーキテクチャおよびセキュリティ上の絶対不変条件は [CLAUDE.md](CLAUDE.md) を必ず参照してください。

---

## 1. 実行方針（Antigravity ローカル & Gemini Web MCP の使い分け）

### Antigravity ローカル優先（GitHub Premium Requests 枠の温存）

- 通常の機能実装・バグ修正・リファクタリング・テスト実行・Git ブランチ作成／PR 作成は、GitHub 側のクラウドエージェント実行枠（Premium Requests）を消費しない **Antigravity 自身** で直接実行すること。
- 独立した複数ワークスペース（例: `packages/protocol` + `apps/server` と `apps/extension` と `CI/docs`）に跨る中〜大規模タスクでは、Antigravity 内蔵の **`invoke_subagent`** を用いて **ファイル境界（Strict File Boundary）を明確に分割した並列実行** を行い、最後に親エージェントが一括で `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` を検証すること。
- **GitHub Cloud Coding Agents への委譲条件**:
  - ユーザーから明示的に「GitHub のクラウドエージェントに投げて」「Copilot / Claude / Codex / Jules に Issue をアサインして」と指示された場合に限り、GitHub Issue 作成＋Bot アサインによってクラウドエージェントを起動すること。

### Gemini Web 版（GitHub Remote MCP 経由）の運用ルール

Gemini Web 版から GitHub 公式リモート MCP サーバー（`https://api.githubcopilot.com/mcp/`）経由でリポジトリを操作する場合は、以下の制約と手順を必ず守ること。

- **`master` への直接コミット禁止**: ブランチ保護が未設定であっても `master` へ直接 `create_or_update_file` / `push_files` を行わず、必ず `create_branch` → 変更コミット → `create_pull_request` で PR を経由すること。
- **検証ゲートの代替運用**: Web セッションからはローカルの `pnpm` コマンドを実行できないため、PR 作成後に GitHub Actions CI（`.github/workflows/ci.yml`、Node 20 / 22）の通過を確認し、PR 説明文に「ローカル検証ゲート未実行（CI 待ち）」と明記すること。
- **Discussions 同期のフォールバック**: Web セッションからは `scripts/agent-discussions.mjs`（GraphQL）を直接実行できないため、Discussion への返信・ADR 提出は `.github/discussions/NN-*.md` を PR に含め、マージ後に `.github/workflows/agent-discussions.yml`（またはローカル環境）経由で同期すること。
- **MCP ファイル閲覧時の注意**: クライアント環境によっては `get_file_contents` がファイル本文を返さずメタデータ（SHA）のみ返す場合がある。その場合は推測で書かず、`pull_request_read` (`get_files` / `get_diff`)・`get_commit` (`detail: "full_patch"`)・`search_code` 等で根拠を確認した範囲のみを編集し、未確認箇所は明示すること。

---

## 2. コードベース主要エントリポイント（編集時の実コードマップ）

v2.1 時点の実装に基づく、よく変更・監査対象となる主要ファイルと注意点です。

| 領域 | 主要ファイル | 実装上の重要ポイント |
| :--- | :--- | :--- |
| **プロトコル / 共通定数** | `packages/protocol/src/commands.ts`<br>`packages/protocol/src/messages.ts`<br>`packages/protocol/src/constants.ts` | `validateTypedCommand` で全コマンドのアクション・パラメータを Zod 検証。`formatCompactSnapshot` で省トークン出力を生成。`DEFAULT_WS_URL` は `ws://127.0.0.1:8767`、`DEFAULT_CDP_IDLE_DETACH_MS` は `30_000`。 |
| **サーバー境界 / 認証 / URL ポリシー** | `apps/server/src/middleware/security.ts`<br>`apps/server/src/routes/api.ts`<br>`apps/server/src/ws/ws-hub.ts`<br>`apps/server/src/config.ts` | `createCsrfAndOriginMiddleware` で外部 `Origin` を `403`、Simple Request (`text/plain` 等) を `415` 遮断。WS も `isAllowedOrigin` で `4003` 拒否。トークン照合は `tokensMatch` (`timingSafeEqual`)。`/command`・`/api/v2/batch`・`/api/v2/workflows` の入口で `validateTypedCommand` と `validateCommandPolicy` を強制。`X-Forwarded-For` は `AGB_TRUST_PROXY=true` 時のみ信頼。 |
| **拡張機能 SW / WS 接続** | `apps/extension/src/background/ws-client.ts`<br>`apps/extension/src/background/index.ts`<br>`apps/extension/src/popup/popup.ts` | `WsClient.connect()` は `connectInFlight` single-flight ロックで重複接続を防止し、`hello` ハンドシェイクに `authToken` を含める。 |
| **拡張機能 Scripting / Snapshot** | `apps/extension/src/engines/scripting/content.ts`<br>`apps/extension/src/engines/scripting/dom.ts`<br>`apps/extension/src/engines/snapshot/index.ts` | `cmdEvaluate` は `new Function` を使わず CDP `Runtime.evaluate` を使用。`cmdClick`/`cmdType` は `engine: 'auto'` 時に CDP へ自動フォールバック。`queryDeep` と `cmdSnapshot` は Open Shadow DOM を走査するため、注入 `func` 内の完全自己完結性を維持すること。 |
| **拡張機能 CDP ライフサイクル** | `apps/extension/src/engines/cdp/debugger-manager.ts`<br>`apps/extension/src/engines/cdp/telemetry.ts`<br>`apps/extension/src/engines/cdp/actions.ts` | `DebuggerManager` は 30 秒アイドルで自動 `detach` するが、`cmdGetConsoleLogs` / `cmdGetNetworkLogs` が `pinTelemetry(tabId)` を呼んだタブは監視維持のため自動デタッチ対象外。 |
| **MCP / CLI / SDK** | `packages/mcp/src/server.ts`<br>`packages/cli/src/cli.ts`<br>`packages/sdk/src/client.ts` | MCP は全 25 ツールを登録（`browser_snapshot` の `format: "compact"` 対応）。CLI (`agb`) は `--compact`・`wait`・`url` 等を提供。いずれも通信は `@antigravity-bridge/sdk` 経由に統一。 |

> **ビルド・フォーマット注意**: Biome (`biome.json`) は `.md` ファイルもチェック対象に含めます。ローカル作業時はコミット前に `pnpm lint:fix` を実行し、ルート `package.json` の既存スクリプト構成（`pnpm -r build/typecheck/test`）は勝手に書き換えないこと。

---

## 3. GitHub Cloud Coding Agents 委譲リファレンス

クラウドエージェントへタスクを委譲する場合は、`.github/ISSUE_TEMPLATE/agent_task.md` の構成（対象ワークスペース・ファイル境界・MV3/セキュリティ不変条件・検証ゲート）を満たす Issue を作成し、以下の Bot またはラベルを指定します。

| エージェント | 指定方法 (`login` / Label) | 主な用途・特徴 |
| :--- | :--- | :--- |
| **GitHub Copilot SWE Agent** | Assignee: `copilot-swe-agent` | 定型機能追加・テスト拡充・Draft PR の自動起票 |
| **Anthropic Claude Code Agent** | Assignee: `anthropic-code-agent` | セキュリティ境界・複雑な非同期／CDP 制御の実装・監査 |
| **OpenAI Codex Agent** | Assignee: `openai-code-agent` | マルチパッケージ横断リファクタリング・CLI/SDK 拡張 |
| **Google Jules** | Label: `jules` | Jules GitHub App 連携時のバックグラウンド自律実装（※利用可能時のみ） |

> `agy-cloud-agents` スキル（`~/.gemini/config/skills/github-cloud-agents/scripts/gh_cloud_agent.py`）が導入されている環境では、`actors` / `assign` / `status` / `merge` サブコマンドでシェルエスケープ問題を起こさず安全に操作できます。

---

## 4. Claude Opus との GitHub Discussions 非同期同期ルール

大規模な設計変更・セキュリティ強化（Origin/CSRF・ドメインポリシー・CDP ライフサイクル等）・複数フェーズに跨る実装を行う際は、**`scripts/agent-discussions.mjs`** を通じて GitHub Discussions 上で **Claude Opus** や他のエージェントとコンテキストを同期してください。

```bash
# 1. 作業開始前に直近の Discussions (ADR・引き継ぎ・Opus からの指摘) を確認
node scripts/agent-discussions.mjs list --limit 10
node scripts/agent-discussions.mjs view <DISCUSSION_NUMBER>

# 2. 設計提案 (ADR) やフェーズ完了の引き継ぎログを投稿
node scripts/agent-discussions.mjs create \
  --category General \
  --title "Handoff: v2.1 Security Hardening & CI Pipeline" \
  --model "Antigravity" \
  --role "Implementer" \
  --body-file /tmp/antigravity_handoff.md

# 3. Claude Opus のレビューコメントに対して修正報告・コミット証跡を返信
node scripts/agent-discussions.mjs reply <DISCUSSION_NUMBER> \
  --model "Antigravity" \
  --role "Implementer" \
  --body-file /tmp/antigravity_reply.md
```

> **Web セッション／`discussions: write` 未付与環境でのフォールバック**: `gh` トークンや GraphQL が使えない場合は、本文を `.github/discussions/NN-*.md` として PR で提出し、`.github/workflows/agent-discussions.yml` 経由で同期してください。

---

## 5. レビュー・返信の書き方 & コミット・PR の帰属

[CLAUDE.md](CLAUDE.md) と歩調を合わせ、Discussion・PR・Issue での透明性とトレーサビリティを保つため、以下のルールを守ってください。

### レビュー・返信の書式

1. **署名は実際のモデル名で**: `Model` / `Role` / `Commit` を先頭に明記し、実際に作業したモデル名を使う。
2. **確認済み範囲と未検証範囲を区別**: 読んだファイル・実行した検証ゲート・未実行の項目（Web MCP 経由でローカルテスト未実行など）を冒頭に明記し、未検証項目を「問題なし」と書かない。
3. **指摘は優先度順（高 / 中 / 低）**: 根拠となるファイル・関数名または再現手順を添え、推測を含む場合は「要確認」と明記する。
4. **設計論点には推奨案と理由を提示**: 選択肢を並べるだけで終わらせず、推奨案と選択条件を示す。

### コミット・PR の帰属

Gemini / Antigravity が作成するコミットには、末尾に共著者トレーラーを付与します（スカッシュマージ時もマージコミットに残すこと）。

```text
Co-Authored-By: Gemini <noreply@google.com>
```

---

## 6. タスク完了前の必須チェック

1. [AGENTS.md](AGENTS.md) のブランチ規約（`master` 直接 push 禁止・`feat/*` / `fix/*` / `docs/*` ブランチ運用）を守っているか？
2. [CLAUDE.md](CLAUDE.md) の **6つのコア不変条件**（MV3 `eval` 禁止・`executeScript` 自己完結関数・Zod 境界検証・Origin/CSRF & `timingSafeEqual`・URL スキーム／ドメインポリシー・CDP 自動デタッチ整合性）に違反していないか？
3. ローカル実行時は必須検証ゲート `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` がすべて成功しているか？（Gemini Web MCP 経由の場合は PR の GitHub Actions CI 結果を確認し、未検証項目を PR 説明文に明記しているか？）
