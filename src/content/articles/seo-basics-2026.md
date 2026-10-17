---
title: "個人メディアのSEOは何から設定する？Astro製HOBNOVAの実装例で見る技術設定"
description: "title・description・canonical・sitemap・robots.txt・構造化データを、Astro製の個人メディアHOBNOVAの実コードと設定値で紹介。Google公式情報と照らした着手順が分かります。"
publishDate: 2026-08-24
updatedDate: 2026-10-18
category: "marketing"
tags: ["SEO", "個人メディア", "Astro", "構造化データ"]
draft: false
featured: true
image: "./seo-basics-2026-hero.png"
---

個人ブログを自作すると、記事より先に「SEOの設定はどこまでやればいいのか」で手が止まりがちです。最初に整えるのは、記事ごとに固有のtitleとmeta description、正規URLを1つに決めるcanonical、クローラーの入口になるsitemapとrobots.txt。構造化データはその次で間に合います。以下では、Astroで作っている当サイトHOBNOVAのコードと設定値を、そのまま実例として使います。

## HOBNOVAで設定しているSEO項目

SEO関連のコンポーネントは`src/components/seo/`に、サイト全体の設定は`astro.config.mjs`に、robots.txtは`src/pages/`にまとめています。表のファイル名はそれぞれのフォルダ内のものです。

| 項目 | ファイル | 内容 |
|---|---|---|
| title | SEOHead.astro | `記事名 \| HOBNOVA` |
| description | SEOHead.astro | frontmatterの値 |
| canonical | SEOHead.astro | 絶対URLで出力 |
| OGP / Xカード | SEOHead.astro | og:imageなど |
| noindex | SEOHead.astro | propのみ用意 |
| 末尾スラッシュ | astro.config.mjs | `always` |
| sitemap | astro.config.mjs | 自動生成 |
| robots.txt | robots.txt.ts | 全許可＋sitemap |
| WebSite等 | JsonLd.astro | 全ページ共通 |
| Article | ArticleJsonLd.astro | 記事系ページ |
| パンくず | BreadcrumbJsonLd.astro | 記事系ページ |

並べてみると、記事本文に書くものは1つもありません。どれもレイアウトやコンポーネントに一度書けば、以降の全ページへ反映されます。個人運営で手間を減らすなら、このテンプレート側で済む項目を先に片付け、あとは記事の中身に時間を回すのが合理的です。

## titleとmeta descriptionは、型だけテンプレートに置く

HOBNOVAの`<head>`は、全ページ共通の`BaseLayout.astro`から`SEOHead.astro`を呼び出して組み立てています。titleとdescription、canonicalを出力しているのはこの数行です。

```astro
const pageTitle = title ? `${title} | ${SITE_TITLE}` : `${SITE_TITLE} | 好奇心から、新しい発見を。`;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
const ogImageURL = new URL(image, Astro.site);
---

<title>{pageTitle}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonicalURL} />
```

テンプレートが受け持つのは「記事タイトルの後ろにサイト名を付ける」という型だけで、中身は記事ごとのfrontmatterから来ます。Googleの[タイトルリンクのドキュメント](https://developers.google.com/search/docs/appearance/title-link?hl=ja)（2026年10月18日確認）が挙げているのも、ページごとに固有で内容を具体的に表すtitle、区切り記号で簡潔に添えるサイト名、キーワードを詰め込まないこと、の3点でした。同じページには、Googleがページ上のテキストなどを基にタイトルリンクを自動生成する場合があるとも書かれています。titleは、そのまま表示される保証のある文字列というより、Googleに渡す有力な候補です。

descriptionは、Content Collectionsのschema（`src/content.config.ts`）で`description: z.string()`として必須にしているため、書き忘れたままビルドは通りません。ただし保証されるのは「値がある」ことまでで、中身の質は誰も見てくれません。[スニペットのドキュメント](https://developers.google.com/search/docs/appearance/snippet?hl=ja)（同日確認）によると、検索結果のスニペットは主にページ本文から作られ、meta descriptionは本文よりページを正確に説明していそうなときに使われることがある、という位置付けです。長さの制限はなく、表示時に必要に応じて切り詰められます。

### 悪い例と良い例

HOBNOVAの実在記事で比べます。上段がこの記事のリライト前、中段がリライト後、下段はプロジェクターの投影距離を扱った[100インチ投影に必要な距離の記事](/gadget/projector-100inch-distance/)です。

| | title | description（要旨） |
|---|---|---|
| 悪い例 | 個人メディア運営者が押さえておきたいSEOの基本 | SEOの基本項目を3つの観点で「整理します」 |
| 改善 | 個人メディアのSEOは何から設定する？Astro製HOBNOVAの実装例で見る技術設定 | 設定項目を実コードで紹介し、着手順が分かる |
| 良い例 | 100インチ投影に必要な距離は？投写比別の早見表と6畳・8畳で映せるサイズ | 投写比1.2なら約2.66mと答えを先に書く |

旧版のtitleは誤りではありませんが、どのSEO記事にも付けられる文言で、読んで何が手に入るのかが見えません。descriptionも「整理します」で終わっていて、結論がない。改善版では、読者の疑問（何から設定するか）と中身（実装例）の両方をtitleに入れました。

下段の記事はさらに一歩進んでいます。descriptionの冒頭が「16:9の100インチは投写比1.2なら約2.66m、1.5なら約3.32m必要です」という答えそのもので、検索結果を見ただけで用が足りる読者もいるはずです。それでも、条件ごとの早見表を見たい人はクリックする。答えを出し惜しみしないdescriptionのほうが、来てほしい読者を呼べます。

## canonicalと末尾スラッシュで、URLを1つに決める

canonicalを絶対URLで出すには、Astro側がサイトのURLを知っている必要があります。HOBNOVAの`astro.config.mjs`の該当部分はこうです。

```js
site: 'https://hobnova.jp',
trailingSlash: 'always',
```

`site`があるので、先ほどの`new URL(Astro.url.pathname, Astro.site)`から、このページなら`https://hobnova.jp/marketing/seo-basics-2026/`という絶対URLが出力されます。2026年10月18日のビルド結果では、canonical・og:url・JSON-LDの`mainEntityOfPage`がすべてこの1つのURLでそろっていました。

Googleの[重複URLの統合に関するドキュメント](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls?hl=ja)（2026年10月18日確認）は、canonicalに相対パスを使うことを長期的な問題につながるとして推奨しておらず、サイト内リンクも正規URLへ向けるよう求めています。末尾スラッシュを`always`に固定しておくと、この「内部リンクも正規URLにそろえる」が守りやすくなります。`/marketing/seo-basics-2026`と`/marketing/seo-basics-2026/`が混在すると、リンクを書くたびにどちらが正なのかを考えることになるからです。

そしてcanonicalは命令ではありません。[正規化の説明ページ](https://developers.google.com/search/docs/crawling-indexing/canonicalization?hl=ja)（同日確認）には、希望を伝えることはできても、さまざまな理由からGoogleが別のページを正規として選ぶ場合があると書かれています。タグを1本入れて終わりにせず、内部リンクとsitemapのURLも同じ形にそろえる。効いてくるのはそちらです。

## sitemapとrobots.txtは、設定を最小限にする

sitemapは、`astro.config.mjs`の`integrations: [sitemap(), mdx()]`に`@astrojs/sitemap`を入れているだけです。ビルドすると`sitemap-index.xml`と`sitemap-0.xml`が生成され、2026年10月18日のビルドでは51件のURLが入っていました。404ページは含まれません。

この規模のサイトなら、sitemapは必須ではありません。[サイトマップの概要](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview?hl=ja)（2026年10月18日確認）では、おおむね500ページ以下で、内部リンクから重要なページにすべてたどり着けるサイトなら不要な場合があるとされ、送信してもすべてのURLのクロールやインデックス登録が保証されるわけではないとも書かれています。とはいえ、Astroなら設定1行で、記事を追加するたびに自動で更新されます。置いておく負担はほぼありません。

robots.txtはエンドポイントとして生成しています。

```ts
export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, '') ?? SITE_URL;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap-index.xml\n`;
```

中身は「すべて許可」とsitemapの場所だけです。誤解しやすいのは、robots.txtを「検索結果に出したくないページを隠す仕組み」だと考えてしまうこと。[robots.txtの概要](https://developers.google.com/search/docs/crawling-indexing/robots/intro?hl=ja)（同日確認）は、robots.txtはクローラーのトラフィック管理のためのもので、Googleにページを表示させないためのメカニズムではないと明言し、除外したい場合は`noindex`などを使うよう案内しています。HOBNOVAの`SEOHead.astro`には`noindex`のpropを用意してありますが、2026年10月18日時点で使っているページはありません。使いどころは、送信完了画面のように検索から直接来ても意味がないページです。

## 構造化データは、レイアウトに3種類を組み込む

構造化データはJSON-LDで、3つのコンポーネントに分けて出力しています。

| type | ファイル | 出力先 |
|---|---|---|
| WebSite / Organization | JsonLd.astro | 全ページ |
| Article | ArticleJsonLd.astro | 記事・DATA LAB・NEWS |
| BreadcrumbList | BreadcrumbJsonLd.astro | 記事系ページ |

NEWSのページでは、同じ`ArticleJsonLd.astro`から`@type`を`NewsArticle`に切り替えて出力しています。Articleのデータはこの形です。

```js
const articleSchema = {
  '@context': 'https://schema.org',
  '@type': schemaType,
  headline: title,
  description,
  image: imageURL,
  datePublished: publishDate.toISOString(),
  dateModified: (updatedDate ?? publishDate).toISOString(),
  mainEntityOfPage: canonicalURL,
  author: { '@type': 'Organization', name: author },
  publisher: { '@type': 'Organization', name: ORG_NAME },
};
```

frontmatterに`updatedDate`があれば`dateModified`に入り、なければ公開日が入ります。記事を直したら`updatedDate`を書き換えるだけで、構造化データまで追従する作りです。パンくずは、表示用の`Breadcrumb.astro`と`BreadcrumbJsonLd.astro`に同じ内容の配列を渡しているので、画面の階層とデータの階層がずれにくくなっています。

Googleは[構造化データの概要](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=ja)（2026年10月18日確認）で、サイトの設定上可能ならJSON-LDを推奨しています。ただし、リッチリザルトとして表示されるには必須プロパティをそろえる必要があり、ガイドラインに沿わないマークアップは表示されない場合があります。[SEOスターターガイド](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=ja)（同日確認）でも、構造化データは検索結果の特別な機能を使えるようにするものとして紹介されていて、順位を上げる手段としては書かれていません。入れれば順位が上がる、という期待で手を付ける項目ではない。

## 設定とビルド結果は、ずれることがある

テンプレートのコードを読んで「設定済み」と思っていても、出力されたHTMLを見ると意図と違う、ということは自作サイトで起きやすいものです。典型的なのは次のようなずれです。

1つは画像の参照先。OGPの`og:image`には記事ごとのアイキャッチを渡しているのに、JSON-LDの`image`には画像を渡し忘れていて、既定画像のパスが入っている。その既定画像のファイル自体がまだ置かれていない、というところまで重なると、構造化データだけが存在しない画像を指すことになります。[Articleの構造化データのドキュメント](https://developers.google.com/search/docs/appearance/structured-data/article?hl=ja)（2026年10月18日確認）は、Articleに必須プロパティはないとしつつ、imageの画像URLはクロールとインデックス登録に対応している必要があるとしています。

もう1つは設定の二重化です。Astroなら、`public/robots.txt`という静的ファイルと、`src/pages/robots.txt.ts`のような動的生成の両方を置けてしまいます。中身が同じうちは問題が表に出ませんが、片方だけ書き換えると、どちらが配信されているのか分からなくなる。設定の置き場所は1か所に絞るべきです。

こうしたずれは、`npm run build`の後に`dist`内のHTMLを1ページ開けば見つかります。確認するのは次の箇所です。

| 見る場所 | 確認すること |
|---|---|
| `<title>` | 記事名＋サイト名の形か |
| description | 記事ごとに違う文か |
| canonical | `https://`から始まる正規URLか |
| og:image | 開ける画像URLか |
| JSON-LDのimage | og:imageと同じく開けるか |
| `dist/robots.txt` | 出力元が1つか |

## AI機能が加わった検索でも、やることは変わらない

GoogleのAI Overviews（AIによる概要）やAIモードのために、特別な設定が要るのかを気にする人もいると思います。[AI機能とウェブサイトに関するドキュメント](https://developers.google.com/search/docs/appearance/ai-features?hl=ja)（2026年10月18日確認）の答えは、追加の要件も特別な最適化も不要で、SEOのベストプラクティスが引き続き有効、というものでした。サポートリンクとして表示されるには、インデックスに登録され、スニペットを表示できる状態であることが条件です。

ここまでの技術設定は、そのままAI機能への土台にもなります。そのうえで「AIに要約されても読みに来てもらえる記事」をどう作るかは、設定ではなくコンテンツ設計の話です。HOBNOVAでの考え方は[生成AI検索時代のコンテンツ設計](/marketing/ai-search-content-strategy-2026/)にまとめています。

## 内部リンクと表示速度も、仕組みで支える

[SEOスターターガイド](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=ja)によると、Googleは主にクロール済みのページからリンクをたどって新しいページを見つけています。リンクのテキストは、ユーザーとGoogleの両方にリンク先の内容を伝えるものです。HOBNOVAの記事ページでは、`ArticleLayout.astro`にパンくず、同カテゴリの前後記事（`PrevNextNav`）、関連記事（`RelatedArticles`）を組み込んでいるため、どこからもリンクされない記事は生まれにくい構造です。本文中のリンクだけは自動化できません。読者が次に抱きそうな疑問に答える記事へ、内容が分かる言葉でつなぐのが基本です。

表示速度はSEOの設定ファイルとは別の話ですが、テンプレート側で直すと全ページに効く点は同じです。何から手を付けるかは[Core Web Vitalsの改善優先順位](/marketing/core-web-vitals-priority-guide/)で整理しています。

## ここまでやらなくていいサイトもある

この記事の設定は、HTMLの`<head>`を自分で書き換えられる自作サイト向けです。ブログサービスを使っていて`<head>`に手を入れられないなら、表の大半は利用者が触れる範囲の外にあります。とはいえ、多くのサービスはtitleやcanonical、sitemapを自動で出力しているので、まずは記事の管理画面で説明文を設定できるか確認してください。その場合に手を入れられるのは、記事タイトル、説明文、本文と本文中のリンクです。そこに時間を使うほうが実りがあります。

自作でも、数ページのポートフォリオや、トップページから全ページへリンクしている小さなサイトなら、前述のとおりsitemapは必須ではありません。構造化データも順位のために入れるものではないので、後回しで困ることは少ないでしょう。逆に、記事が増え続ける個人メディアをこれから作るなら、テンプレートを組む最初の段階で入れておくほうが楽です。後から全ページのHTMLを確認し直すより、手間が少なくて済みます。HOBNOVAをClaude CodeとCloudflare Pagesで公開するまでの流れは[Claude Codeで個人サイトを作って公開するまで](/marketing/claude-code-astro-cloudflare-pages/)に書いています。
