// サイト全体で共有する定数。
// ドメインやブランド文言を変更する場合は基本的にこのファイルのみを編集すればよい。

export const SITE_TITLE = 'HOBNOVA';
export const SITE_TAGLINE = '好奇心から、新しい発見を。';
export const SITE_DESCRIPTION =
  'HOBNOVA（ホブノヴァ）は、キャンプ・ガジェット・データ分析・デジタルマーケティング・Webツールなど、大人の好奇心を研究する個人メディアです。「試す」「調べる」「分析する」を通じて新しい発見を届けます。';
// TODO: ドメイン確定後に実URLへ変更（astro.config.mjs の site とも合わせる）
export const SITE_URL = 'https://hobnova.jp';
export const ORG_NAME = 'HOBNOVA';
export const DEFAULT_AUTHOR = 'HOBNOVA編集部';
// TODO: 1200x630のOGP用画像を public/og-default.png に配置する
export const DEFAULT_OG_IMAGE = '/og-default.png';

// Google Tag Manager コンテナID。全ページ共通でBaseLayout.astroから読み込む。
export const GTM_ID = 'GTM-T3RWG7HD';

// Cloudflare Turnstile のサイトキー（公開情報。secret keyとは異なりクライアント側に埋め込んでよい）。
// Cloudflareダッシュボードでウィジェット作成後に実値へ差し替える。手順は docs/contact-setup.md 参照。
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFJP-i81sub8k7xp';

export type CategoryId = 'camp' | 'gadget' | 'data-lab' | 'marketing' | 'tools';

// 通常記事（Content Collections の articles）が対応するカテゴリ。
// content.config.ts の category enum もここから生成し、定義の重複を避ける。
export const ARTICLE_CATEGORY_IDS = ['camp', 'gadget', 'marketing'] as const;
export type ArticleCategoryId = (typeof ARTICLE_CATEGORY_IDS)[number];

export interface CategoryMeta {
  id: CategoryId;
  labelEn: string;
  labelJa: string;
  navLabelEn: string;
  href: string;
  description: string;
}

// カテゴリを増やす場合はここに追加し、content/config.ts の category enum にも値を足す。
export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'camp',
    labelEn: 'CAMP',
    labelJa: 'キャンプ',
    navLabelEn: 'CAMP',
    href: '/camp/',
    description: 'キャンプ、アウトドア、ギア、収納、車載など。',
  },
  {
    id: 'gadget',
    labelEn: 'GADGET',
    labelJa: 'ガジェット',
    navLabelEn: 'GADGET',
    href: '/gadget/',
    description: 'PC、スマートフォン、スマートホーム、AI、家電など。',
  },
  {
    id: 'data-lab',
    labelEn: 'DATA LAB',
    labelJa: 'データラボ',
    navLabelEn: 'DATA LAB',
    href: '/data-lab/',
    description: '公開データを収集・分析・可視化する。',
  },
  {
    id: 'marketing',
    labelEn: 'DIGITAL MARKETING',
    labelJa: 'デジタルマーケティング',
    navLabelEn: 'MARKETING',
    href: '/marketing/',
    description: 'SEO、Web広告、CRM、マーケティング戦略など。',
  },
  {
    id: 'tools',
    labelEn: 'TOOLS',
    labelJa: 'ツール',
    navLabelEn: 'TOOLS',
    href: '/tools/',
    description: 'HOBNOVA独自のシミュレーター・計算ツール。',
  },
];

export interface NavLink {
  labelEn: string;
  labelJa?: string;
  href: string;
}

export const HEADER_NAV: NavLink[] = [
  { labelEn: 'NEWS', labelJa: 'ニュース', href: '/news/' },
  ...CATEGORIES.map((c) => ({ labelEn: c.navLabelEn, labelJa: c.labelJa, href: c.href })),
  { labelEn: 'ABOUT', href: '/about/' },
];

export const FOOTER_NAV: NavLink[] = [
  { labelEn: 'NEWS', labelJa: 'ニュース', href: '/news/' },
  ...CATEGORIES.map((c) => ({ labelEn: c.navLabelEn, labelJa: c.labelJa, href: c.href })),
  { labelEn: 'ABOUT', labelJa: 'サイトについて', href: '/about/' },
  { labelEn: 'CONTACT', labelJa: 'お問い合わせ', href: '/contact/' },
  { labelEn: 'PRIVACY', labelJa: 'プライバシーポリシー', href: '/privacy/' },
];

// --- ニュース（朝刊/夕刊） ---
// 将来的に毎日朝・夜2回、外部ニュースを元にした自動投稿を予定している領域。
// 今回のPRでは掲載先（collection・ページ・ナビ）のみを用意し、自動生成自体は実装しない。

export const NEWS_TOPIC_IDS = [
  'ai',
  'generative-ai',
  'development',
  'tech',
  'investment',
  'money',
  'work',
  'web-media',
  'lifestyle',
  'policy',
] as const;
export type NewsTopicId = (typeof NEWS_TOPIC_IDS)[number];

export interface NewsTopicMeta {
  id: NewsTopicId;
  labelEn: string;
  labelJa: string;
  href: string;
}

export const NEWS_TOPICS: NewsTopicMeta[] = [
  { id: 'ai', labelEn: 'AI', labelJa: 'AI', href: '/news/topic/ai/' },
  { id: 'generative-ai', labelEn: 'Generative AI', labelJa: '生成AI', href: '/news/topic/generative-ai/' },
  { id: 'development', labelEn: 'Development', labelJa: '開発', href: '/news/topic/development/' },
  { id: 'tech', labelEn: 'Tech', labelJa: 'テック', href: '/news/topic/tech/' },
  { id: 'investment', labelEn: 'Investment', labelJa: '投資', href: '/news/topic/investment/' },
  { id: 'money', labelEn: 'Money', labelJa: 'お金', href: '/news/topic/money/' },
  { id: 'work', labelEn: 'Work', labelJa: '仕事・働き方', href: '/news/topic/work/' },
  { id: 'web-media', labelEn: 'Web Media', labelJa: 'Webメディア', href: '/news/topic/web-media/' },
  { id: 'lifestyle', labelEn: 'Lifestyle', labelJa: '生活', href: '/news/topic/lifestyle/' },
  { id: 'policy', labelEn: 'Policy', labelJa: '制度変更', href: '/news/topic/policy/' },
];

export const NEWS_EDITIONS = {
  morning: { labelEn: 'MORNING', labelJa: '朝版' },
  evening: { labelEn: 'EVENING', labelJa: '夜版' },
} as const;
export type NewsEdition = keyof typeof NEWS_EDITIONS;

// 1ページに表示するニュース記事数（無限リスト化を避けるためpaginate()で分割する）。
export const NEWS_PAGE_SIZE = 12;
