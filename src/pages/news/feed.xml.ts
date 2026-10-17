// ニュース専用RSS。サイト全体のRSSは現状存在しないため（記事/DATA LAB/TOOLSにも無い）、
// 新設はnewsに限定する。全コンテンツ向けRSSが将来必要になった場合も、このファイルの
// パターン（getCollection + rss()）をそのまま他コレクションへ展開できる。
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_DESCRIPTION, SITE_TITLE } from '../../consts';

export const GET: APIRoute = async (context) => {
  const news = (await getCollection('news', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
  );

  return rss({
    title: `${SITE_TITLE} NEWS`,
    description: SITE_DESCRIPTION,
    site: context.site ?? 'https://hobnova.jp',
    items: news.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: entry.data.publishedAt,
      link: `/news/${entry.id}/`,
    })),
  });
};
