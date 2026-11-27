# CLAUDE.md — Claude Code / Claude Opus アーキテクチャ & セキュリティ協調ガイド

本ドキュメントは、**Claude Code** およびアーキテクチャ・セキュリティ監査役を担う **Claude Opus** が、`antigravity-chrome-bridge` モノレポの実装・設計レビュー・Pull Request 監査・GitHub Discussions 上での合意形成を行うための専用ガイドラインです。

全体構成・モジュール境界・ビルド手順については [AGENTS.md](AGENTS.md) も併せて参照してください。

---

## 1. 絶対遵守のコア不変条件 (6 Core Architectural & Security Invariants)

本プロジェクトは「AI エージェントから実在の Chrome プロファイルを操作するローカルブリッジ」という性質上、拡張機能 CSP とローカルサーバー境界の安全性が最優先されます。いかなる機能追加・リファクタリングにおいても、以下の **6つの不変条件** を絶対に破ってはなりません。

1. **[不変条件 1] MV3 Service Worker における `eval` / `new Function` 完全禁止**
   - Chrome Manifest V3 の拡張機能ページおよび Service Worker (`apps/extension/src/**`) では CSP `script-src 'self'` が強制され、`unsafe-eval` は一切使用できない。
   - 拡張機能バンドル内に `eval()`・`new Function()`・文字列指定の `setTimeout` / `setInterval` を混入させてはならない（ページの任意 JS 評価アクション `evaluate` は対象タブ側の CDP `Runtime.evaluate` 等で処理し、拡張機能自身のコンテキストでは決して動的評価しないこと）。

2. **[不変条件 2] `chrome.scripting.executeScript` 注入関数の完全自己完結性**
   - `chrome.scripting.executeScript({ target, func, args })` に渡す `func` は、Chrome によって `func.toString()` で文字列化され対象ページの実行コンテキストへ注入される。
   - そのため、`func` 内部からモジュールスコープの `import`・外部ヘルパー関数・クロージャ変数を参照すると実行時 `ReferenceError` となる。`func` は 100% 自己完結した純粋関数として記述し、必要なパラメータはすべて JSON シリアライズ可能な `args` 配列経由で渡すこと。

3. **[不変条件 3] HTTP / WebSocket 境界における厳格な Zod スキーマ検証 & v1 互換維持**
   - `apps/server` が受け取るすべての外部ペイロード（`POST /command`、`/api/v2/batch`、`/api/v2/workflows`、WebSocket `hello` メッセージ等）は、`@antigravity-bridge/protocol` で定義された Zod スキーマ（`safeParse`）を通過してから内部ロジックへ渡すこと。
   - 同時に、既存の `POST /command`（`{ action, params, sessionId }`）の v1 ワイヤフォーマット後方互換性を破壊しないこと。

4. **[不変条件 4] Origin / CSRF / 定数時間 Bearer 認証 & `chrome-extension://` WS Origin 防御**
   - ローカルポート (`127.0.0.1:8766` / `:8767`) に対する悪意ある外部 Web サイトからの Drive-by Localhost CSRF および不正 WebSocket 接続を防ぐため、HTTP リクエストと WebSocket ハンドシェイクの `Origin` ヘッダーを検証し、未許可の外部 `http(s)://` オリジンを拒否すること（拡張機能の `chrome-extension://` オリジンおよび許可済みローカルオリジン、`Origin` を持たない CLI/MCP/SDK からのリクエストのみを許可）。
   - `AGB_AUTH_TOKEN` の照合には必ず `node:crypto` の `timingSafeEqual`（`apps/server/src/middleware/security.ts` の `tokensMatch`）を使用し、タイミング攻撃に対して脆弱な `===` 比較を行わないこと。

5. **[不変条件 5] URL ドメイン・スキームポリシーの全経路強制**
   - `navigate` / `new_tab` 単発実行だけでなく、`/api/v2/batch` や `/api/v2/workflows/:id/run` を含む全コマンド実行経路において URL ポリシー検査（`validateUrlPolicy` / `validateCommandPolicy`）を適用すること。
   - `chrome:`・`chrome-extension:`・`javascript:`・`vbscript:`・`data:`・`blob:`・`devtools:`・`edge:` 等の特権・危険スキームを確実にブロックし、`file:` スキームは `AGB_ALLOW_FILE_URLS=true` 明示時以外すべて遮断すること。また、`AGB_BLOCKED_DOMAINS` は常に `AGB_ALLOWED_DOMAINS` より優先して拒否すること。

6. **[不変条件 6] CDP アイドル自動デタッチ vs テレメトリピン留めの整合性**
   - `chrome.debugger` (`apps/extension/src/engines/cdp/debugger-manager.ts`) のアタッチ中は Chrome 上部にデバッグバナーが表示され他ツールと競合し得るため、`attachInFlight` による多重アタッチ排他制御・タブ閉鎖 (`tabs.onRemoved`) / 手動解除 (`debugger.onDetach`) 時の即座の状態破棄・一定時間アイドル後の自動デタッチを行うこと。
   - ただし、コンソールログ／ネットワーク通信監視（`telemetry.ts`）のために明示的にピン留め（監視アクティブ化）されているタブについては、アイドルタイマーで誤ってデタッチしてログ欠損を引き起こさないようライフサイクルを厳密に区別すること。

---

## 2. Claude Opus 向け GitHub Discussions & PR レビュー操作コマンド

Antigravity や他のエージェントが起票した設計提案（ADR）・実装引き継ぎ・Pull Request を確認・レビューする際は、以下のコマンドを使用してください。

### GitHub Discussions の確認・返信 (`scripts/agent-discussions.mjs`)

Markdown 内のコードブロックやバッククォートによるシェル展開事故を防ぐため、必ず `scripts/agent-discussions.mjs` と `--body-file` を使用します。

```bash
# 直近の Discussions トピック一覧を確認
node scripts/agent-discussions.mjs list --limit 10

# 特定の Discussion (#N) の全文とスレッド議論を確認
node scripts/agent-discussions.mjs view <DISCUSSION_NUMBER>

# アーキテクチャ・セキュリティレビューコメントを投稿
node scripts/agent-discussions.mjs reply <DISCUSSION_NUMBER> \
  --model "Claude Opus" \
  --role "Architecture & Security Reviewer" \
  --body-file /tmp/opus_discussion_reply.md

# 新規の設計・セキュリティ提案 (ADR) を起票する場合
node scripts/agent-discussions.mjs create \
  --category Ideas \
  --title "Security Review: WebSocket Origin & Session Isolation" \
  --model "Claude Opus" \
  --role "Architecture & Security Reviewer" \
  --body-file /tmp/opus_adr.md
```

### Pull Request の取得・ローカル検証・レビュー投稿

```bash
# オープン中の PR 一覧と CI ステータスの確認
gh pr list --repo stu2230085-maker/antigravity-chrome-bridge

# PR の概要・変更ファイル・差分の確認
gh pr view <PR_NUMBER> --repo stu2230085-maker/antigravity-chrome-bridge
gh pr diff <PR_NUMBER> --repo stu2230085-maker/antigravity-chrome-bridge

# ローカルで PR をチェックアウトして必須検証ゲートを実行
gh pr checkout <PR_NUMBER>
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension

# 指摘事項のコメント / 変更要求
gh pr review <PR_NUMBER> --repo stu2230085-maker/antigravity-chrome-bridge \
  --comment --body-file /tmp/opus_pr_review.md

# 全監査項目クリア時の承認 & Squash マージ
gh pr review <PR_NUMBER> --repo stu2230085-maker/antigravity-chrome-bridge \
  --approve --body "Reviewed by Claude Opus: All MV3 CSP constraints, localhost CSRF/Origin defenses, domain/scheme policies, and test suites verified."
gh pr merge <PR_NUMBER> --repo stu2230085-maker/antigravity-chrome-bridge --squash --delete-branch
```

---

## 3. Opus アーキテクチャ・セキュリティ監査チェックリスト (全7項目)

PR または Discussion 上の設計提案を監査する際は、以下の **7項目** を漏れなく確認してください。

1. **[監査 1: MV3 CSP & 自己完結 Script 注入]**
   - `apps/extension/` 内に `eval` / `new Function` が存在しないか？ `chrome.scripting.executeScript` に渡す `func` が外部スコープのクロージャ変数やモジュール `import` を参照せず、`args` のみで完結しているか？
2. **[監査 2: Localhost CSRF / Origin & WS ハンドシェイク防御]**
   - HTTP エンドポイントおよび WebSocket サーバー (`ws-hub.ts`) が、悪意ある外部 Web オリジン (`https://evil.example` 等) からのブラウザリクエスト／接続を確実に拒否し、`chrome-extension://` と許可されたローカルオリジンのみを受け入れているか？
3. **[監査 3: 定数時間 Bearer 認証 & マルチセッション分離]**
   - HTTP API・SSE (`/api/v2/events`)・WebSocket `hello` のトークン検証がすべて `timingSafeEqual` (`tokensMatch`) を通っているか？ 複数プロファイル接続時に `sessionId` ごとのソケットと保留中レスポンス Promise が厳密に分離されているか？
4. **[監査 4: URL スキーム・ドメインポリシーの網羅性]**
   - `chrome:`・`chrome-extension:`・`javascript:`・`data:`・`blob:`・`devtools:` 等の禁止スキーム、`AGB_ALLOW_FILE_URLS=false` 時の `file:` 拒否、および `AGB_BLOCKED_DOMAINS` 優先評価が `/command`・`/api/v2/batch`・`/api/v2/workflows/:id/run` のすべてで一貫して強制されているか？
5. **[監査 5: CDP デバッガライフサイクル & テレメトリ整合性]**
   - `DebuggerManager` で同一タブへの並列 `attach` 競合が防止されているか？ アイドル自動デタッチが機能しつつ、ログ監視（ピン留め）中のタブを誤って切断しないか？ タブ閉鎖時にメモリリークが残らないか？
6. **[監査 6: v1 ワイヤ後方互換性 & v2 Zod バリデーション]**
   - 既存クライアント向けの `POST /command` 入出力形式を維持しつつ、追加・変更されたコマンドや API の入力がすべて `@antigravity-bridge/protocol` の Zod スキーマで検証されているか？
7. **[監査 7: 検証ゲート完走 & テスト証跡]**
   - `pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm package:extension` がエラー・警告ゼロで通過し、変更箇所（特にセキュリティ境界や異常系）に対するユニットテスト／E2E テストが含まれているか？
