---
title: "Claude Codeで個人サイトを作って公開するまで｜Astro×Cloudflare Pages"
description: "個人メディアHOBNOVAを実際に構築した流れをもとに、Claude Code・Astro・GitHub・Cloudflare Pagesを組み合わせて個人サイトを作り、インターネット上に公開するまでの手順を初心者向けに解説します。"
publishDate: 2026-08-28
category: "marketing"
tags: ["Claude Code", "Astro", "Cloudflare Pages", "個人サイト制作"]
draft: false
featured: false
image: "./claude-code-astro-cloudflare-pages-hero.png"
---

個人サイト作りは、最初の数時間がいちばん楽しいです。

ロゴ。色。トップページ。  
少しずつ“自分のサイト”になっていく。

ところが公開が近づくと、急に現実的な作業が増えます。

ビルド。Git。デプロイ。環境変数。ドメイン。

画面ではきれいに見えているのに、ターミナルには赤いエラーが1行。

あの瞬間、一気に現実へ戻されます。

HOBNOVAも、Claude Code・Astro・GitHub・Cloudflare Pagesを組み合わせながら育ててきました。

ここでは“唯一の正解”ではなく、**個人サイトを継続して触りやすかった構成**として紹介します。

## HOBNOVAの構成

HOBNOVAは「HOBBY」と「NOVA」を掛け合わせた個人メディア。

CAMP、GADGET、[DATA LAB](/data-lab/)、DIGITAL MARKETING、[TOOLS](/tools/)。

試す。調べる。分析する。作る。

詳しいコンセプトは[ABOUTページ](/about/)へ。

技術構成はシンプルです。

```
Claude Code → Astro → GitHub → Cloudflare Pages → 公開
```

| サービス | 役割 | 一言でいうと |
|---|---|---|
| Claude Code | 開発 | AIと会話しながらコードを書く・直す |
| Astro | 開発 | コンテンツサイト向けWebフレームワーク |
| GitHub | コード管理 | 変更履歴とソースコードの保管 |
| Cloudflare Pages | 公開 | GitHubからビルドして配信 |

## なぜClaude Code？

いちばん大きいのは、自然言語から作業へ入れること。

「ヘッダーに検索アイコン」  
「スマホだけ余白を狭く」  
「このページの構成をそろえる」

こういう指示から、関連ファイルまで見ながら修正できます。

ゼロからHTML/CSSを全部手書きしなくても、作りたいものを言葉にするところから始められる。

ただし、AIが書いたコードをそのまま公開はしません。

ビルド。表示。リンク。SEO。

最後の確認は必要。

AIはかなり頼れる。  
でも、責任まで丸投げはしない。

## Astro。記事と見た目を分けやすい

HOBNOVAはコンテンツ中心。

そこでAstro。

- 静的サイトと相性がいい
- JavaScriptを必要以上に配りにくい
- Markdown / MDXで記事を書ける
- UIをコンポーネント化できる

記事を書く場所と、見た目を作る場所を分けられます。

これが後から効きます。

デザイン変更はコンポーネント。  
記事追加はMarkdown。

役割が分かれていると、サイトが大きくなっても触りやすい。

## GitHub。失敗しても戻れる場所

コードのバックアップ。  
変更履歴。  
Cloudflare Pagesの起点。

GitHubがあると、「昨日まで動いていた状態」が残ります。

個人開発でこの安心感は大きい。

何か壊したとき、戻れる。

## Cloudflare Pages。公開作業を日常から消す

GitHubとつないでおけば、

```
修正 → commit → push → build → 公開
```

この流れを自動化できます。

公開のたびにファイルを手動アップロードしない。

記事を1本追加するたび、デプロイ作業で気力を削られない。

更新頻度が高いサイトほど、この差が効きます。

## STEP 1. 必要なもの

- Claude / Claude Code
- Node.js
- Git
- GitHubアカウント
- Cloudflareアカウント

Node.jsは特別な理由がなければLTS系が無難。

ここまでは準備。

## STEP 2. いきなりコードを書かない

最初に決めるのは、

- サイトのテーマ
- カテゴリ
- URL構造
- 配色・フォント
- 記事ページの共通要素

HOBNOVAではプロジェクト内にルールを書き、AIがその方針を読みながら作業できるようにしています。

日をまたいでも、デザインが毎回別人になりにくい。

**AIに自由を与える前に、基準を渡す。**

かなり重要です。

## STEP 3. Astroで分けて作る

大まかな構造。

```
src/
├─ components/
├─ layouts/
├─ content/
├─ content.config.ts
├─ pages/
└─ styles/
public/
astro.config.mjs
package.json
```

記事とUIを分離。

Markdown側ではタイトル、説明、公開日、カテゴリなどをfrontmatterへ持たせます。

```markdown
---
title: "記事タイトル"
description: "説明文"
publishDate: 2026-09-01
category: "camp"
tags: ["タグ1", "タグ2"]
draft: false
---

ここから本文。
```

記事追加のたびにページHTMLを一から作らなくていい。

この楽さは大きいです。

## STEP 4. ローカルで確認

公開前に、自分のPCで見る。

```bash
npm install
npm run dev
```

localhostはまだ自分のPCの中。

ここでレイアウト、リンク、スマホ表示。

公開してから気づくより、ここで気づく方が楽。

## STEP 5. GitHubへ

基本の流れは、

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ユーザー名/リポジトリ名.git
git push -u origin main
```

そして重要なのが秘密情報。

**.env、APIキー、パスワードはpushしない。**

gitignoreへ入れる。  
push前に git status。

地味ですが、この習慣はかなり大事です。

## STEP 6. Cloudflare Pagesと接続

GitHubリポジトリをCloudflare Pagesへ接続。

Astroなら基本は、

- Framework preset: Astro
- Build command: npm run build
- Build output directory: dist

設定画面は変わることがあるので、実際の作業時は[Cloudflare Pages公式ドキュメント](https://developers.cloudflare.com/pages/)を確認。

## STEP 7. 公開

ビルドが通れば、まず pages.dev のURLで公開できます。

HOBNOVAもここからスタートしました。

現在は独自ドメイン **hobnova.jp** で運用しています。

最初から独自ドメインまで全部やらなくてもいい。

まず公開。  
あとから整える。

この順番でも十分です。

## STEP 8. 更新のハードルを下げる

一度つながれば、その後はかなり身軽。

```
Claude Codeで修正
↓
確認
↓
GitHubへ
↓
Cloudflare Pagesがビルド
↓
公開
```

個人サイトで大切なのは、“作れること”以上に“更新を続けられること”。

手順が多いと、だんだん触らなくなります。

## STEP 9. 独自ドメイン

pages.devでも公開はできます。

ただ、長く運営するなら独自ドメインも選択肢。

HOBNOVAは現在 hobnova.jp を利用中。

ドメイン費用や条件は変わるので、契約時の最新情報を確認。

## STEP 10. Search Console

公開したらSearch Console。

1. サイト登録・所有権確認
2. sitemapを送信
3. インデックスを待つ

公開した瞬間、Googleに出るわけではありません。

ここも少し待つ作業。

## 実際にこの構成で感じるメリット

- 着手が速い
- 感覚的なデザイン修正を言葉で頼める
- 記事だけでなくDATA LABやTOOLSへ広げられる
- GitHubとCloudflareをつなぐと更新が軽い

特に最後。

更新作業が軽いと、サイトを触る回数が増えます。

## 注意点

- AI生成コードを無条件で信用しない
- 秘密情報をGitHubへ出さない
- npx astro check / npm run build を通す
- スマホ表示を見る
- リンク切れを確認
- 画像をWeb向けに最適化
- title / description / OGPを確認
- 外部サービスの最新仕様を公式で確認

## 結論。“また触りたくなる環境”を作る

個人開発は、技術構成の美しさだけでは続きません。

更新のたびに手順が10個。  
毎回どこかでエラー。  
公開だけで疲れる。

これでは記事を書く前に気力がなくなります。

AIに任せられるところは任せる。  
デプロイは自動化。  
人間は「何を作るか」に集中。

**また明日も触ろうと思える環境。**

個人サイトでは、それがかなり大事です。
