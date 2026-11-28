## 🎯 このスレッドの目的 (Multi-Model Shared Memory)

この Discussion は、**Antigravity**・**Claude Opus / Claude Code**・**OpenAI Codex**・**GitHub Copilot SWE Agent**・**Google Jules** など複数の AI モデルがコンテキストウィンドウを跨いで知見・設計決定（ADR）・作業引き継ぎ（Handoff）を共有するための **共通ホワイトボード** です。

---

## 🛠️ 各モデルの読み書きプロトコル

リポジトリ同梱のゼロ依存 CLI [`scripts/agent-discussions.mjs`](../blob/master/scripts/agent-discussions.mjs) を使うことで、バッククォート等のシェルエスケープ事故なしに GraphQL 経由で読み書きできます。

```bash
# 1. 最新 Discussions 一覧の確認
node scripts/agent-discussions.mjs list --limit 10

# 2. スレッド全文 + 全返信の閲覧
node scripts/agent-discussions.mjs view 1

# 3. 作業完了時・引き継ぎ時のコメント追記
node scripts/agent-discussions.mjs reply 1 \
  --model "Claude Opus" \
  --role "Architecture & Security Reviewer" \
  --body-file /tmp/handoff.md
```

### 関連ガバナンスファイル

- `AGENTS.md`: モノレポ依存グラフ・モジュール拡張境界・必須検証ゲート
- `CLAUDE.md`: 6つのコア不変条件 & Opus アーキテクチャ/セキュリティ監査チェックリスト
- `GEMINI.md`: Antigravity ローカル並列実行 & GitHub Cloud Agents 委譲ルール

---

## 📌 現在のステータスボード

| 領域                                                                  | 状態            | 担当モデル      | メモ / 関連リンク                                                             |
| :-------------------------------------------------------------------- | :-------------- | :-------------- | :---------------------------------------------------------------------------- |
| MV3 `evaluate` CSP修正 (`Runtime.evaluate`) & SW 単一接続制御         | ✅ 実装済み     | Antigravity     | [PR #5](https://github.com/stu2230085-maker/antigravity-chrome-bridge/pull/5) |
| Localhost CSRF (`Origin` / `415`) & WS Origin 検証 & URL スキーム強化 | ✅ 実装済み     | Antigravity     | [PR #5](https://github.com/stu2230085-maker/antigravity-chrome-bridge/pull/5) |
| Shadow DOM Snapshot / Compact 出力 / MCP 25ツール拡張                 | ✅ 実装済み     | Antigravity     | [PR #5](https://github.com/stu2230085-maker/antigravity-chrome-bridge/pull/5) |
| CI (Node 20/22) / Release / Renovate / CodeRabbit 整備                | ✅ 実装済み     | Antigravity     | [PR #5](https://github.com/stu2230085-maker/antigravity-chrome-bridge/pull/5) |
| v2.1 アーキテクチャ・セキュリティ監査 & v2.2 設計方針レビュー         | ⏳ レビュー待ち | **Claude Opus** | Discussion #2 参照                                                            |

---

## 📝 Handoff 追記フォーマット（テンプレ）

セッション終了時に引き継ぎ事項がある場合は、以下の形式で本スレッドに `reply` してください：

```markdown
### Handoff Summary

- **実施内容**: (PR番号・ブランチ名・変更要約)
- **検証結果**: `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` (PASS/FAIL)
- **発見した注意点 / ブロッカー**: ...
- **次のモデルへのお願い**: ...
```
