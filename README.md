# Antigravity Chrome Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-116%2B-brightgreen.svg)](https://www.google.com/chrome/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933.svg)](https://nodejs.org/)

AntigravityからChromeブラウザを操作するための拡張機能とブリッジサーバーのセットです。本家使えないとき用

## 概要

```text
Antigravity ──HTTP──▶ ブリッジサーバー ──WebSocket──▶ Chrome拡張 ──▶ ブラウザ操作
                        (Node.js)                     (MV3)
```

- **ブリッジサーバー**: Antigravityからのコマンドを受け取り、Chrome拡張に中継
- **Chrome拡張**: ブラウザ内でコマンドを実行（クリック、入力、スクロール、スクリーンショットなど）
- **タブグループ**: 操作は自動的に「🤖 Antigravity」タブグループ内で行われます

## セットアップ

### 1. ブリッジサーバーの起動

```bash
cd server
npm install
npm start
```

または `server/start.bat` をダブルクリック（Windows）。

サーバーが起動すると以下が利用可能になります：
- **WebSocket**: `ws://localhost:8767` (Chrome拡張用)
- **HTTP API**: `http://localhost:8766` (Antigravity用)

### 2. Chrome拡張のインストール

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `extension/` フォルダを選択
5. 拡張機能のアイコンをクリックし、接続状態を確認

### 3. Antigravityから使う

Antigravityの `run_command` ツールなどからHTTPリクエストを送信します：

```bash
# 接続状態の確認
curl http://localhost:8766/status

# ページに移動
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"navigate\", \"params\": {\"url\": \"https://example.com\"}}"

# 要素をクリック
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"click\", \"params\": {\"selector\": \"#submit-btn\"}}"

# テキスト入力
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"type\", \"params\": {\"selector\": \"input[name=search]\", \"text\": \"検索ワード\"}}"
```

## 🔌 HTTP API エンドポイント

| メソッド | パス | 説明 |
|:---|:---|:---|
| `POST` | `/command` | Chrome拡張へコマンドを送信し、実行結果を返す |
| `GET` | `/status` | 拡張機能の接続状態・待機中コマンド数・稼働時間を取得 |
| `GET` | `/health` | サーバーのヘルスチェック |

## 📖 コマンドリファレンス

### ナビゲーション

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `navigate` | URLに移動 | `url` (必須), `tabId` (任意) |
| `new_tab` | 新しいタブを開く | `url` (任意) |
| `close_tab` | タブを閉じる | `tabId` (任意, デフォルト: グループ内タブ) |
| `switch_tab` | タブを切り替え | `tabId` (必須) |
| `go_back` | 戻る | `tabId` (任意) |
| `go_forward` | 進む | `tabId` (任意) |
| `reload` | リロード | `tabId` (任意) |
| `get_url` | 現在のURLを取得 | `tabId` (任意) |
| `get_tabs` | タブ一覧を取得 | — |

### DOM操作

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `click` | 要素をクリック | `selector` (必須, CSSセレクタ), `allFrames` (任意) |
| `click_at` | 座標を指定してクリック | `x` (必須), `y` (必須), `allFrames` (任意) |
| `type` | テキスト入力 | `selector` (必須), `text` (必須), `clear` (任意, デフォルト: `true`), `allFrames` (任意) |
| `hover` | 要素にホバー | `selector` (必須), `allFrames` (任意) |
| `select` | ドロップダウン選択 | `selector` (必須), `value` (必須) |
| `scroll` | スクロール | `direction` + `amount`、または `x` + `y`、または `selector` |

### コンテンツ取得

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `get_content` | HTMLを取得 | `selector` (任意), `allFrames` (任意) |
| `get_text` | テキストを取得 | `selector` (任意), `allFrames` (任意) |
| `get_elements` | 要素情報を取得 | `selector` (必須), `limit` (任意, デフォルト: `20`), `allFrames` (任意) |
| `screenshot` | スクリーンショット | `format` (任意: `png`/`jpeg`), `quality` (任意) |

### iframe操作

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `iframe_click` | iframe内の要素をクリック | `selector` (必須), `frameUrl` (任意: 対象フレームURLの部分一致) |
| `iframe_click_at` | iframe内の座標をクリック | `x` (必須), `y` (必須), `frameUrl` (任意) |
| `iframe_get_elements` | iframe内の要素情報を取得 | `selector` (必須), `limit` (任意, デフォルト: `30`), `frameUrl` (任意) |
| `iframe_get_text` | iframe内のテキストを取得 | `selector` (任意), `frameUrl` (任意) |

### その他

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `evaluate` | JavaScript実行 | `code` (必須) |
| `wait_for` | 要素の出現を待機 | `selector` (必須), `timeout` (任意, デフォルト: `10000`ms) |

### レスポンス例

```json
// 成功
{
  "success": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "result": { "id": "550e8400-e29b-41d4-a716-446655440000", "success": true, "tabId": 42, "url": "https://example.com" }
}

// 失敗
{
  "error": "Chrome extension is not connected"
}
```

## ⚙️ 設定

### サーバーURL変更

拡張機能のポップアップでサーバーURLを変更できます（デフォルト: `ws://localhost:8767`）。

### ポート・ホスト変更

環境変数で設定を変更できます（デフォルトは `127.0.0.1` のみでリッスンします）：

| 環境変数 | デフォルト値 | 説明 |
|:---|:---|:---|
| `HOST` | `127.0.0.1` | バインドするホストアドレス |
| `WS_PORT` | `8767` | WebSocketポート (Chrome拡張用) |
| `HTTP_PORT` | `8766` | HTTP APIポート (Antigravity用) |
| `COMMAND_TIMEOUT_MS` | `30000` | コマンドのタイムアウト (ms) |

```bash
WS_PORT=9767 HTTP_PORT=9766 node bridge-server.js
```

## 📁 構成

```text
antigravity-chrome-bridge/
├── extension/           # Chrome拡張機能 (Manifest V3)
│   ├── manifest.json    # MV3マニフェスト
│   ├── background.js    # Service Worker
│   ├── popup.html       # ポップアップUI
│   ├── popup.js         # ポップアップロジック
│   ├── popup.css        # ポップアップスタイル
│   └── icons/           # アイコン
├── server/              # ブリッジサーバー (Node.js)
│   ├── package.json     # 依存パッケージ
│   ├── bridge-server.js # メインサーバー
│   └── start.bat        # Windows用起動スクリプト
├── LICENSE              # MITライセンス
└── README.md
```

## ⚠️ 注意事項

- Chrome 116以降が必要です（WebSocket keepalive対応）
- `chrome://` や拡張機能ページなど、Chromeの内部ページでは操作できません
- スクリーンショットは表示中のタブのみ撮影可能です
- ブリッジサーバーはデフォルトでローカル（`127.0.0.1`）のみで動作します
- ドパガキ駆動開発のため動かなくても知りません

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。
