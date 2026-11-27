# GEMINI.md — Antigravity 実行ポリシー & クラウドエージェント連携ルール

本ドキュメントは、本リポジトリ (`stu2230085-maker/antigravity-chrome-bridge`) における **Antigravity** の実行方針、並列サブエージェント運用、および外部 AI エージェント（**Claude Opus**・**Copilot SWE Agent**・**Claude Code Agent**・**OpenAI Codex Agent**・**Google Jules**）との連携ルールを定義します。

詳細なモノレポ構造・拡張境界は [AGENTS.md](AGENTS.md)、アーキテクチャおよびセキュリティ上の絶対不変条件は [CLAUDE.md](CLAUDE.md) を必ず参照してください。

---

## 1. デフォルト実行方針（Antigravity ローカル & 並列サブエージェント優先）

- **Antigravity 優先（GitHub Premium Requests 枠の温存）**:
  - 通常の機能実装・バグ修正・リファクタリング・テスト実行・Git ブランチ作成／PR 作成は、GitHub 側のクラウドエージェント実行枠（Premium Requests）を消費しない **Antigravity 自身** で直接実行すること。
  - 独立した複数ワークスペース（例: `packages/protocol` + `apps/server` と `apps/extension` と `CI/docs`）に跨る中〜大規模タスクでは、Antigravity 内蔵の **`invoke_subagent`** を用いて **ファイル境界（Strict File Boundary）を明確に分割した並列実行** を行い、最後に親エージェントが一括で `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` を検証すること。
- **GitHub Cloud Coding Agents への委譲条件**:
  - ユーザーから明示的に「GitHub のクラウドエージェントに投げて」「Copilot / Claude / Codex / Jules に Issue をアサインして」と指示された場合に限り、GitHub Issue 作成＋Bot アサインによってクラウドエージェントを起動すること。

---

## 2. GitHub Cloud Coding Agents 委譲リファレンス

クラウドエージェントへタスクを委譲する場合は、`.github/ISSUE_TEMPLATE/agent_task.md` の構成（対象ワークスペース・ファイル境界・MV3/セキュリティ不変条件・検証ゲート）を満たす Issue を作成し、以下の Bot またはラベルを指定します。

| エージェント                    | 指定方法 (`login` / Label)       | 主な用途・特徴                                       |
| :------------------------------ | :------------------------------- | :--------------------------------------------------- |
| **GitHub Copilot SWE Agent**    | Assignee: `copilot-swe-agent`    | 定型機能追加・テスト拡充・Draft PR の自動起票        |
| **Anthropic Claude Code Agent** | Assignee: `anthropic-code-agent` | セキュリティ境界・複雑な非同期／CDP 制御の実装・監査 |
| **OpenAI Codex Agent**          | Assignee: `openai-code-agent`    | マルチパッケージ横断リファクタリング・CLI/SDK 拡張   |
| **Google Jules**                | Label: `jules`                   | Jules GitHub App 連携時のバックグラウンド自律実装    |

> `agy-cloud-agents` スキル（`~/.gemini/config/skills/github-cloud-agents/scripts/gh_cloud_agent.py`）が導入されている環境では、`actors` / `assign` / `status` / `merge` サブコマンドでシェルエスケープ問題を起こさず安全に操作できます。

---

## 3. Claude Opus との GitHub Discussions 非同期同期ルール

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

---

## 4. タスク完了前の必須チェック

1. [AGENTS.md](AGENTS.md) のブランチ規約（`master` 直接 push 禁止・`feat/*` / `fix/*` / `docs/*` ブランチ運用）を守っているか？
2. [CLAUDE.md](CLAUDE.md) の **6つのコア不変条件**（MV3 `eval` 禁止・`executeScript` 自己完結関数・Zod 境界検証・Origin/CSRF & `timingSafeEqual`・URL スキーム／ドメインポリシー・CDP 自動デタッチ整合性）に違反していないか？
3. 必須検証ゲート `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` がすべて成功しているか？
