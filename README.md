# 🤖 Antigravity Chrome Bridge

AntigravityからChromeブラウザを操作するための拡張機能とブリッジサーバーのセットです。

## 📋 概要

```
Antigravity ──HTTP──▶ ブリッジサーバー ──WebSocket──▶ Chrome拡張 ──▶ ブラウザ操作
                        (Node.js)                     (MV3)
```

- **ブリッジサーバー**: Antigravityからのコマンドを受け取り、Chrome拡張に中継
- **Chrome拡張**: ブラウザ内でコマンドを実行（クリック、入力、スクロールなど）
- **タブグループ**: 操作は自動的に「🤖 Antigravity」タブグループ内で行われます

## 🚀 セットアップ

### 1. ブリッジサーバーの起動

```bash
cd server
npm install
node bridge-server.js
```

または `server/start.bat` をダブルクリック。

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

Antigravityの `run_command` ツールでHTTPリクエストを送信します：

```bash
# ページに移動
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"navigate\", \"params\": {\"url\": \"https://example.com\"}}"

# 要素をクリック
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"click\", \"params\": {\"selector\": \"#submit-btn\"}}"

# テキスト入力
curl -X POST http://localhost:8766/command -H "Content-Type: application/json" -d "{\"action\": \"type\", \"params\": {\"selector\": \"input[name=search]\", \"text\": \"検索ワード\"}}"
```

## 📖 コマンドリファレンス

### ナビゲーション

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `navigate` | URLに移動 | `url` (必須) |
| `new_tab` | 新しいタブを開く | `url` (任意) |
| `close_tab` | タブを閉じる | `tabId` (任意, デフォルト: グループ内タブ) |
| `switch_tab` | タブを切り替え | `tabId` (必須) |
| `go_back` | 戻る | — |
| `go_forward` | 進む | — |
| `reload` | リロード | — |
| `get_url` | 現在のURLを取得 | — |
| `get_tabs` | タブ一覧を取得 | — |

### DOM操作

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `click` | 要素をクリック | `selector` (必須, CSSセレクタ) |
| `type` | テキスト入力 | `selector` (必須), `text` (必須), `clear` (任意, デフォルト: true) |
| `hover` | 要素にホバー | `selector` (必須) |
| `select` | ドロップダウン選択 | `selector` (必須), `value` (必須) |
| `scroll` | スクロール | `direction` + `amount`、または `x` + `y`、または `selector` |

### コンテンツ取得

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `get_content` | HTMLを取得 | `selector` (任意) |
| `get_text` | テキストを取得 | `selector` (任意) |
| `get_elements` | 要素情報を取得 | `selector` (必須), `limit` (任意, デフォルト: 20) |
| `screenshot` | スクリーンショット | `format` (任意: png/jpeg), `quality` (任意) |

### その他

| コマンド | 説明 | パラメータ |
|:---|:---|:---|
| `evaluate` | JavaScript実行 | `code` (必須) |
| `wait_for` | 要素の出現を待機 | `selector` (必須), `timeout` (任意, デフォルト: 10000ms) |

### レスポンス例

```json
// 成功
{ "id": "cmd_123", "success": true, "tabId": 42, "url": "https://example.com" }

// 失敗
{ "id": "cmd_123", "success": false, "error": "Element not found: #missing" }
```

## ⚙️ 設定

### サーバーURL変更

拡張機能のポップアップでサーバーURLを変更できます（デフォルト: `ws://localhost:8767`）。

### ポート変更

ブリッジサーバーのポートを変更する場合は `server/bridge-server.js` の以下を編集：

```javascript
const WS_PORT = 8767;   // WebSocket (Chrome拡張用)
const HTTP_PORT = 8766;  // HTTP API (Antigravity用)
```

## 📁 構成

```
antigravity-chrome-bridge/
├── extension/           # Chrome拡張機能
│   ├── manifest.json    # MV3マニフェスト
│   ├── background.js    # Service Worker
│   ├── popup.html       # ポップアップUI
│   ├── popup.js         # ポップアップロジック
│   ├── popup.css        # ポップアップスタイル
│   └── icons/           # アイコン
├── server/              # ブリッジサーバー
│   ├── package.json     # 依存パッケージ
│   ├── bridge-server.js # メインサーバー
│   └── start.bat        # 起動スクリプト
└── README.md
```

## ⚠️ 注意事項

- Chrome 116以降が必要です（WebSocket keepalive対応）
- `chrome://` や拡張機能ページなど、Chromeの内部ページでは操作できません
- スクリーンショットは表示中のタブのみ撮影可能です
- ブリッジサーバーはローカルでのみ動作します（localhost）
