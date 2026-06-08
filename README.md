# MovieToText

YouTube動画の字幕（自動生成含む）をテキストに変換する無料Webツール。

## 特徴

- **完全無料・認証不要** — アカウント作成なしで即利用可能
- **YouTube専用** — YouTube動画の字幕・コメントを取得
- **複数出力形式** — TXT, SRT, VTT, Markdown, クリップボードコピー
- **コメント取得** — オプションでコメントも取得・表示
- **ダークテーマ** — 視覚的にも快適なUI

## 対応プラットフォーム

| プラットフォーム | 対応状況 |
|-----------------|---------|
| YouTube | ✅ 対応 |
| Twitter/X | ❌ 非対応 |
| TikTok | ❌ 非対応 |
| Instagram | ❌ 非対応 |

> ※ 本ツールはYouTube専用です。他のプラットフォームには対応していません。

## 技術構成

- **フロントエンド**: HTML, CSS, JavaScript（Cloudflare Pages）
- **バックエンド**: Cloudflare Workers
- **YouTube字幕取得**: InnerTube API（ANDROID クライアント）

## デプロイ

```bash
# Cloudflare Workers デプロイ
npm run deploy:worker

# Cloudflare Pages デプロイ
npm run deploy:pages
```

## ローカル開発

```bash
npm install
npm run dev
```

## 使用方法

1. YouTube動画のURLを入力
2. 「文字起こしを取得」をクリック
3. タブで文字起こし/整形テキスト/コメントを切り替え
4. ボタンで形式を選んでダウンロード

## ライセンス

MIT
