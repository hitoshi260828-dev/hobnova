import fs from 'node:fs/promises';

const required = ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY', 'RAKUTEN_AFFILIATE_ID'];
for (const key of required) {
  if (!process.env[key]) throw new Error('Missing required secret: ' + key);
}

const targets = [
  { id: 'benq-th575c', keyword: 'BenQ TH575C', model: 'th575c', preferredShop: 'benq-directshop' },
  { id: 'benq-gv32', keyword: 'BenQ GV32', model: 'gv32', preferredShop: 'benq-directshop' },
  { id: 'nebula-p1i', keyword: 'Nebula P1i', model: 'p1i', preferredShop: 'anker' },
  { id: 'nebula-capsule-air', keyword: 'Nebula Capsule Air', model: 'capsule air', preferredShop: 'anker' },
  { id: 'nebula-capsule-3', keyword: 'Nebula Capsule 3', model: 'capsule 3', preferredShop: 'anker' },
];

const endpoint = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const filePath = 'src/data/projectors.ts';
let source = await fs.readFile(filePath, 'utf8');

for (const target of targets) {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APPLICATION_ID,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
    keyword: target.keyword,
    hits: '30',
    format: 'json',
    formatVersion: '2',
  });

  const response = await fetch(endpoint + '?' + params, {
    headers: { accessKey: process.env.RAKUTEN_ACCESS_KEY },
  });
  if (!response.ok) throw new Error('Rakuten API failed for ' + target.id + ': ' + response.status);

  const data = await response.json();
  const rawItems = Array.isArray(data.Items) ? data.Items : [];
  const items = rawItems.map((entry) => entry.Item ?? entry);
  const candidates = items.filter((item) =>
    String(item.itemName ?? '').toLowerCase().includes(target.model)
  );
  const item =
    candidates.find((candidate) => String(candidate.shopCode ?? '') === target.preferredShop) ??
    candidates[0];

  if (!item?.affiliateUrl) {
    console.warn('No verified Rakuten affiliate result for ' + target.id + '; leaving unchanged.');
    continue;
  }

  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.includes("id:'" + target.id + "'"));
  if (index < 0) throw new Error('Projector row not found: ' + target.id);

  lines[index] = lines[index]
    .replace(/, rakutenAffiliateUrl:'[^']*'/, '')
    .replace(", checkedAt:", ", rakutenAffiliateUrl:'" + item.affiliateUrl + "', checkedAt:");
  source = lines.join('\n');

  console.log('Updated ' + target.id + ' from Rakuten shop ' + (item.shopCode ?? 'unknown'));
}

await fs.writeFile(filePath, source);
