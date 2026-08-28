// サイト全体で共有する定数。
// ドメインやブランド文言を変更する場合は基本的にこのファイルのみを編集すればよい。

export const SITE_TITLE = 'HOBNOVA';
export const SITE_TAGLINE = '好奇心から、新しい発見を。';
export const SITE_DESCRIPTION =
  'HOBNOVA（ホブノヴァ）は、キャンプ・ガジェット・データ分析・デジタルマーケティング・Webツールなど、大人の好奇心を研究する個人メディアです。「試す」「調べる」「分析する」を通じて新しい発見を届けます。';
// TODO: ドメイン確定後に実URLへ変更（astro.config.mjs の site とも合わせる）
export const SITE_URL = 'https://hobnova.com';
export const ORG_NAME = 'HOBNOVA';
export const DEFAULT_AUTHOR = 'HOBNOVA編集部';
// TODO: 1200x630のOGP用画像を public/og-default.png に配置する
export const DEFAULT_OG_IMAGE = '/og-default.png';

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
  ...CATEGORIES.map((c) => ({ labelEn: c.navLabelEn, labelJa: c.labelJa, href: c.href })),
  { labelEn: 'ABOUT', href: '/about/' },
];

export const FOOTER_NAV: NavLink[] = [
  ...CATEGORIES.map((c) => ({ labelEn: c.navLabelEn, labelJa: c.labelJa, href: c.href })),
  { labelEn: 'ABOUT', labelJa: 'サイトについて', href: '/about/' },
  { labelEn: 'PRIVACY', labelJa: 'プライバシーポリシー', href: '/privacy/' },
];
