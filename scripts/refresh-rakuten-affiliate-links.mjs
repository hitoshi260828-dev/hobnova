// 楽天市場 商品検索APIから、登録済み商品(src/data/projectors.ts)のRakuten
// アフィリエイトURLを取得・更新する。
//
// 【2026年2月の楽天ウェブサービス移行後の必須事項】
// 新API（openapi.rakuten.co.jp/ichibams）では、当アプリの登録タイプ「Webアプリケーション」の
// 場合、リクエストに Referer ヘッダーが必須。欠落すると 403(REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING)
// になる。Node.js標準の fetch() は Referer をFetch仕様上「特別扱い」しており、headersオプション
// 経由で手動設定しても実際のHTTPリクエストに反映されないため、undici.request()で明示的に
// 送信する（参考: https://8091.info/rakuten-web-service-2026-infrastructure-migration/ ほか、
// 2026年2月の移行に関する複数の独立した実装報告）。
//
// ここで送るRefererは、自サイト（hobnova.jp）自身のバックエンド処理としての自己申告であり、
// 第三者サイトへのなりすましではない。
import fs from 'node:fs/promises';
import { request } from 'undici';

const required = ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY', 'RAKUTEN_AFFILIATE_ID'];
for (const key of required) {
  if (!process.env[key]) throw new Error('Missing required secret: ' + key);
}

// Rakuten Developersに「許可されたWebサイト」として登録している本番ドメイン。
// astro.config.mjs の `site` / src/consts.ts の SITE_URL と一致させること。
const REFERER_URL = process.env.RAKUTEN_REFERER_URL ?? 'https://hobnova.jp/';

const targets = [
  { id: 'benq-th575c', keyword: 'BenQ TH575C', maker: 'benq', model: 'th575c', preferredShop: 'benq-directshop' },
  { id: 'benq-gv32', keyword: 'BenQ GV32', maker: 'benq', model: 'gv32', preferredShop: 'benq-directshop' },
  { id: 'nebula-p1i', keyword: 'Nebula P1i', maker: 'anker', model: 'p1i', preferredShop: 'anker' },
  { id: 'nebula-capsule-air', keyword: 'Nebula Capsule Air', maker: 'anker', model: 'capsule air', preferredShop: 'anker' },
  { id: 'nebula-capsule-3', keyword: 'Nebula Capsule 3', maker: 'anker', model: 'capsule 3', preferredShop: 'anker' },
];

const endpoint = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const filePath = 'src/data/projectors.ts';

/**
 * 楽天APIのエラーレスポンス本文から、秘密情報を含まない範囲で診断情報を抜き出す。
 * applicationId/accessKey/affiliateId等が万一エコーバックされても出力しない。
 */
function sanitizeRakutenError(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const code = parsed.error ?? parsed.error_description ?? null;
    const message = parsed.error_description ?? parsed.message ?? null;
    if (code || message) {
      return `code=${code ?? '(不明)'} message=${message ?? '(不明)'}`;
    }
  } catch {
    // JSONでなければ、そのまま短く切って返す(secretを含む可能性は低いが念のため長さを制限)
  }
  return bodyText.slice(0, 200).replace(/\s+/g, ' ').trim();
}

async function searchRakutenItem(target) {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APPLICATION_ID,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
    keyword: target.keyword,
    hits: '30',
    format: 'json',
    formatVersion: '2',
  });

  const res = await request(endpoint + '?' + params, {
    method: 'GET',
    headers: {
      accessKey: process.env.RAKUTEN_ACCESS_KEY,
      Referer: REFERER_URL,
    },
  });

  const bodyText = await res.body.text();

  if (res.statusCode !== 200) {
    const detail = sanitizeRakutenError(bodyText);
    throw new Error(`Rakuten API HTTP ${res.statusCode} for ${target.id}: ${detail}`);
  }

  return JSON.parse(bodyText);
}

function pickVerifiedItem(target, data) {
  const rawItems = Array.isArray(data.Items) ? data.Items : [];
  const items = rawItems.map((entry) => entry.Item ?? entry);

  const candidates = items.filter((item) => {
    const name = String(item.itemName ?? '').toLowerCase();
    return name.includes(target.model) && name.includes(target.maker);
  });

  const verified = candidates.find((candidate) => String(candidate.shopCode ?? '') === target.preferredShop);

  return { resultCount: items.length, candidateCount: candidates.length, item: verified ?? null };
}

async function main() {
  let source = await fs.readFile(filePath, 'utf8');
  let updatedCount = 0;
  let skippedCount = 0;

  for (const target of targets) {
    console.log(`[rakuten] 検索対象: ${target.id} (keyword="${target.keyword}")`);

    let data;
    try {
      data = await searchRakutenItem(target);
    } catch (err) {
      console.warn(`[rakuten] WARNING: ${target.id} の検索に失敗したためスキップします: ${err.message}`);
      skippedCount++;
      continue;
    }

    const { resultCount, candidateCount, item } = pickVerifiedItem(target, data);
    console.log(`[rakuten]   検索結果: ${resultCount}件 / 型番・メーカー一致: ${candidateCount}件`);

    if (!item?.affiliateUrl) {
      console.warn(
        `[rakuten] WARNING: ${target.id} は確度の高い一致（型番・メーカー・公式ショップ一致）が得られなかったためスキップします（既存URLは変更しません）。`
      );
      skippedCount++;
      continue;
    }

    const lines = source.split('\n');
    const index = lines.findIndex((line) => line.includes("id:'" + target.id + "'"));
    if (index < 0) {
      console.warn(`[rakuten] WARNING: ${target.id} の行が projectors.ts に見つからないためスキップします。`);
      skippedCount++;
      continue;
    }

    lines[index] = lines[index]
      .replace(/, rakutenAffiliateUrl:'[^']*'/, '')
      .replace(', checkedAt:', ", rakutenAffiliateUrl:'" + item.affiliateUrl + "', checkedAt:");
    source = lines.join('\n');

    console.log(`[rakuten]   採用商品: ${item.itemName ?? '(不明)'} / shopName: ${item.shopName ?? '(不明)'} → 更新`);
    updatedCount++;
  }

  if (updatedCount > 0) {
    await fs.writeFile(filePath, source);
    console.log(`[rakuten] 完了: 更新 ${updatedCount}件 / スキップ ${skippedCount}件`);
  } else {
    console.log(`[rakuten] 完了: 更新対象なし（スキップ ${skippedCount}件）。ファイルは変更しません。`);
  }
}

main().catch((err) => {
  console.error(`[rakuten] エラー: ${err.message}`);
  process.exitCode = 1;
});
