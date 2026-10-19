# 開発プロジェクト全体構成図

> 更新日：2026-10-18  
> このページは「マイペル」「HOBNOVA」と共通開発監視基盤の構成を一覧するための資料です。  
> **確度について：** HOBNOVA は GitHub の現行 `main` の主要ファイルを確認。マイペルは開発会話・実装報告に基づく設計図で、現在のリポジトリや実機状態とは未照合です。

## 目次
- [比較](#比較)
- [マイペル（MAIPER）](#マイペルmaiper)
- [HOBNOVA](#hobnova)
- [共通開発運用と復旧構想](#共通開発運用と復旧構想)
- [運用と更新方法](#運用と更新方法)

## 比較

| 項目 | マイペル（MAIPER） | HOBNOVA |
| --- | --- | --- |
| 目的 | 混雑・通信不安定下でも合流する位置共有アプリ | 記事・比較・データ可視化・ツール提供サイト |
| ユーザー向けUI | React Native + Expo | Astro 7 + Tailwind CSS 4 |
| 共通言語 | TypeScript | TypeScript |
| クラウド処理 | Cloudflare Workers + REST API | Cloudflare Pages Functions、記事生成CLI/Actions |
| 永続データ | Cloudflare D1 | D1（問い合わせ）、KV（レート制限） |
| ストレージ | Cloudflare R2 | リポジトリ内のMarkdown・静的画像等 |
| 特色 | GPS + BLE + サーバー統合 | AI記事生成 + OpenAI画像 + Cloudflare Workers AI |
| 検証上の注意 | BLE実機E2Eは未確認 | 画像反映・記事品質・公開処理は継続確認が必要 |

## マイペル（MAIPER）

### 全体構成

```mermaid
flowchart TB
  U1["参加者A スマートフォン<br/>React Native / Expo / TypeScript"]
  U2["参加者B スマートフォン<br/>React Native / Expo / TypeScript"]
  GPS["GPS: 現在地取得"]
  BLE["BLE: 近隣端末の検出・近接推定"]
  STORE["LocationStore / 位置統合ロジック"]
  API["Cloudflare Workers<br/>REST API / セッション・権限制御"]
  D1[("Cloudflare D1<br/>セッション・参加者等")]
  R2[("Cloudflare R2<br/>アセット")]
  GPS --> STORE
  BLE --> STORE
  STORE --> U1
  U1 <-->|"オンライン / HTTPS"| API
  API --> D1
  API --> R2
  U2 <-->|"オンライン / HTTPS"| API
  U1 <-.->|"オフライン近距離 / BLE（実機検証待ち）"| U2
```

- 画面：会場地図、位置表示、グループ、待ち合わせ地点、セッション有効時間。
- `src/location/` 等に BLE 接続制御、イベント競合対策、GPS/BLE統合と診断UIの実装報告あり。
- セッション失効後の位置更新を拒否し、グループの操作権限を検証する方針。
- **未検証：** 実機でのBLE接続・オフライン位置推定のE2E、配布経路など。設計上の経路を本番動作保証とみなさない。

## HOBNOVA

### 公開サイトの構成

```mermaid
flowchart TB
  PC["Windows / VS Code / Claude Code<br/>Astro + TypeScript + Tailwind"]
  GH["GitHub リポジトリ<br/>記事Markdown・コード・画像"]
  CI["GitHub Actions / PRレビュー<br/>astro check・build"]
  PAGES["Cloudflare Pages<br/>静的サイト配信"]
  FUNC["Pages Functions<br/>問い合わせAPI"]
  D1[("Cloudflare D1<br/>問い合わせ")]
  KV[("Cloudflare KV<br/>レート制限")]
  TURN["Turnstile<br/>bot対策"]
  VIS["閲覧者<br/>hobnova.jp"]
  PC --> GH --> CI -->|"mainへの変更"| PAGES
  VIS <-->|HTTPS| PAGES
  VIS --> FUNC
  TURN --> FUNC
  FUNC --> D1
  FUNC --> KV
```

### 記事制作パイプライン

```mermaid
flowchart TB
  TR["記事依頼 / スケジュール"]
  RESEARCH["記事テーマ選定・調査・Markdown執筆"]
  IMG1["OpenAI Image API<br/>アイキャッチ"]
  IMG2["Cloudflare Workers AI<br/>通常記事の本文画像"]
  CHECK["ローカル/CI検証<br/>Astro check・build"]
  PR["GitHub PR"]
  REVIEW{"最終確認・マージ方針"}
  DEPLOY["Cloudflare Pages公開"]
  LINE["LINE通知（ニュースのレビューなど）"]
  TR --> RESEARCH
  RESEARCH --> IMG1
  RESEARCH --> IMG2
  IMG1 --> CHECK
  IMG2 --> CHECK
  CHECK --> PR --> REVIEW
  PR --> LINE
  REVIEW --> DEPLOY
```

- **通常記事：** `scripts/run-daily-article-pipeline.ts` は画像生成・check/buildまでのCLI。PR作成は別運用。通常記事の定期公開処理は `scripts/daily-publish-check.mjs`。
- **朝夜ニュース：** `scripts/news-publish.mjs` は調査・重複除外・記事/カバー作成・検証・PR・LINE通知まで。2026-10-18時点のコード上、**人間の最終マージを待つ設計**。
- **静的コンテンツ：** `src/content/articles/` 等のMarkdownからAstroでページを生成。訪問のたびにAI生成する仕組みではない。
- **可視化：** Chart.js、ツール類のクライアント処理。
- 技術の根拠：リポジトリの `package.json`、`wrangler.toml`、`README.md` および上記スクリプト（2026-10-18確認）。

## 共通開発運用と復旧構想

```mermaid
flowchart TB
  PC["Windowsローカル<br/>VS Code / Claude Code"]
  GH["GitHub<br/>プロジェクト別リポジトリ"]
  M["マイペル<br/>モバイル + Workers"]
  H["HOBNOVA<br/>Web + Pages"]
  MON["独立監視システム（未構築）<br/>Cloudflare Workers / HTTP heartbeat"]
  FAIL["PC停止を検知した場合<br/>クラウド復旧実行（構想）"]
  PC --> GH
  GH --> M
  GH --> H
  PC -.->|"1分間隔のHTTPハートビート（AIトークン不要）"| MON
  MON -.-> FAIL
  FAIL -.-> GH
```

監視・フェイルオーバーは両プロジェクトとは**独立リポジトリ**として作成する方針。図中の監視/クラウド復旧経路は現在の構想であり、構築済み・運用中の意味ではありません。

## 運用と更新方法

- このページをシステム構成図の**参照用入口**としてブックマークする。
- 変更時は図・使用技術・「実装済み／未検証／構想」の状態と更新日を一緒に修正する。
- マイペルの実リポジトリが特定できた時点でソース照合し、推定ベースの記述を更新する。
- 将来的にはプロジェクト横断ドキュメントを専用の独立リポジトリへ移すこともできる。現時点は既存アクセス可能なHOBNOVAリポジトリに保管している。
