# MovieToText

YouTube動画の字幕をテキストに変換する無料Webツール。

## 特徴

- **完全無料・認証不要** — アカウント作成なしで即利用可能
- **YouTube専用** — YouTube動画の字幕を取得
- **日英UI切替** — 日本語/English対応
- **複数出力形式** — TXT, Markdown, クリップボードコピー
- **ダークテーマ** — 視覚的にも快適なUI
- **訪問者カウンター** — フッターに表示

## 技術構成

- **フロントエンド**: HTML, CSS, JavaScript（Cloudflare Pages）
- **バックエンド**: Cloudflare Workers
- **字幕取得**: InnerTube API（ANDROID クライアント）
- **データストア**: Cloudflare KV（訪問者カウンター）

## 対応プラットフォーム

| プラットフォーム | 対応状況 |
|-----------------|---------|
| YouTube | ✅ 対応 |
| その他 | ❌ 非対応（YouTube専用） |

> ※ 本ツールはYouTube専用です。他のプラットフォームには対応していません。
> ※ 一部の動画ではYouTubeのレート制限により字幕が取得できない場合があります。

## デプロイ

```bash
# Cloudflare Workers デプロイ
npx wrangler deploy

# Cloudflare Pages デプロイ
npx wrangler pages deploy public --project-name=movie-to-text --commit-dirty=true
```

## ローカル開発

```bash
npm install
npx wrangler dev
```

## 使用方法

1. YouTube動画のURLを入力
2. 「字幕を取得」をクリック
3. タブでタイムスタンプ付き/プレーンテキストを切替
4. プルダウンで字幕言語を変更可能
5. ボタンで形式を選んでダウンロード

## ライセンス

MIT
