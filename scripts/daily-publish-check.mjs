#!/usr/bin/env node
// 毎日JST 12:00に実行する「本日まだ記事が公開されていなければ、CI green・マージ可能な
// 記事PRを安全にマージして本番公開まで確認する」チェック。
//
// このスクリプト自体は記事の執筆・画像生成は行わない（既存の外部AIエージェント/MCP経由の
// 投稿を前提とする）。やるのは「公開が止まっていないか検知し、止まっていればできる範囲で
// 前へ進める、進められなければ知らせる」こと。
//
// 冪等性: 本日のpublishDateを持つ記事が既にmain上にあれば即座に終了する
//        （同日に複数回実行されても二重公開しない）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrMergeSafety,
  listOpenContentPRs,
  squashMergePR,
  waitForProductionDeploy,
} from "./lib/github-pr.mjs";
import { isLineConfigured, sendLinePush } from "./lib/line-push.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_URL = process.env.PRODUCTION_URL ?? "https://hobnova.jp";

function todayJst(forceDate) {
  if (forceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(forceDate)) throw new Error(`FORCE_DATEの形式が不正です: ${forceDate}`);
    return forceDate;
  }
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().slice(0, 10);
}

const CONTENT_COLLECTIONS = [
  { dir: "articles", urlPrefix: null }, // カテゴリ別のためfrontmatterのcategoryを見る
  { dir: "data-lab", urlPrefix: "data-lab" },
  { dir: "tools", urlPrefix: "tools" },
];

function readFrontmatterField(source, field) {
  const block = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!block) return null;
  const match = block[1].match(new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return null;
  const raw = match[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** 本日のpublishDateを持つ記事が既にmain（チェックアウト済みのワークツリー）上にあるか確認する。 */
export function findPublishedToday(dateStr, repoRoot = REPO_ROOT) {
  for (const { dir } of CONTENT_COLLECTIONS) {
    const fullDir = path.join(repoRoot, "src/content", dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (!/\.(md|mdx)$/.test(file)) continue;
      const filePath = path.join(fullDir, file);
      const source = fs.readFileSync(filePath, "utf8");
      const publishDate = readFrontmatterField(source, "publishDate");
      if (publishDate && publishDate.slice(0, 10) === dateStr) {
        return { filePath, collection: dir };
      }
    }
  }
  return null;
}

/** mainブランチ上のfrontmatterから、本番URLを組み立てる（既存のURLルールと一致させる）。 */
export function buildProductionUrl(repoRoot, collectionDir, slug) {
  if (collectionDir === "articles") {
    const filePath = ["md", "mdx"]
      .map((ext) => path.join(repoRoot, "src/content/articles", `${slug}.${ext}`))
      .find((p) => fs.existsSync(p));
    const category = filePath ? readFrontmatterField(fs.readFileSync(filePath, "utf8"), "category") : null;
    if (!category) return null;
    return `${PRODUCTION_URL}/${category}/${slug}/`;
  }
  return `${PRODUCTION_URL}/${collectionDir}/${slug}/`;
}

function slugFromPath(filePath) {
  return path.basename(filePath).replace(/\.(md|mdx)$/, "");
}

async function verifyProductionArticle(filePath, collectionDir) {
  const slug = slugFromPath(filePath);
  const url = buildProductionUrl(REPO_ROOT, collectionDir, slug);
  if (!url) return { ok: false, reason: "URLを組み立てられませんでした（categoryが不明）" };

  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { ok: false, reason: `記事ページが${res.status}を返しました: ${url}` };

    const source = fs.readFileSync(filePath, "utf8");
    const image = readFrontmatterField(source, "image");
    if (image) {
      // frontmatterのimageはastro:assetsによりハッシュ付きファイル名へ変換されるため、
      // 元パスでは直接確認できない。ここでは「記事ページ自体が200であること」までを
      // 本番確認の範囲とし、画像の実体確認はビルドログ（astro buildが画像解決に失敗すれば
      // build自体が失敗する）に委ねる。
    }
    return { ok: true, url };
  } catch (err) {
    return { ok: false, reason: `本番URL確認に失敗しました: ${err.message}` };
  }
}

async function notify(dryRun, text) {
  console.log(`[daily-publish-check] 通知内容:\n${text}`);
  if (dryRun) {
    console.log("[daily-publish-check] dry-run: LINE APIは呼び出しません。");
    return;
  }
  if (!isLineConfigured()) {
    console.log("[daily-publish-check] LINE未設定のため通知をスキップします。");
    return;
  }
  await sendLinePush(text);
}

async function main() {
  const dryRun = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
  const skipPublish = process.env.SKIP_PUBLISH === "true" || process.argv.includes("--skip-publish");
  const forceDate = process.env.FORCE_DATE;
  const date = todayJst(forceDate);

  console.log(`[daily-publish-check] 対象日(JST): ${date}${dryRun ? " [DRY_RUN]" : ""}${skipPublish ? " [SKIP_PUBLISH]" : ""}`);

  const already = findPublishedToday(date);
  if (already) {
    console.log(`[daily-publish-check] 本日分の記事は既にmainにあります: ${already.filePath}（冪等性チェックによりここで終了）`);
    return;
  }

  console.log("[daily-publish-check] 本日分の記事がmainにまだありません。open PRを確認します。");
  const candidates = await listOpenContentPRs();
  console.log(`[daily-publish-check] 記事コンテンツを含むopen PR: ${candidates.length}件`);

  if (candidates.length === 0) {
    await notify(
      dryRun,
      `🤖 HOBNOVA Daily Check\n\n本日（${date}）まだ記事が公開されていません。\n記事コンテンツを含むPRも見つかりませんでした。\n新しい記事の執筆をご検討ください。`
    );
    return;
  }

  for (const pr of candidates) {
    const safety = await getPrMergeSafety(pr.number);
    console.log(
      `[daily-publish-check] PR #${pr.number} "${pr.title}": mergeable=${safety.mergeable} ci=${safety.ciSuccess} cloudflare=${safety.cloudflareSuccess}`
    );
    if (!safety.mergeable || !safety.ciSuccess || !safety.cloudflareSuccess) continue;

    if (dryRun || skipPublish) {
      console.log(`[daily-publish-check] マージ候補を検出: PR #${pr.number}（DRY_RUN/SKIP_PUBLISHのため実マージはしません）`);
      await notify(
        true,
        `🤖 HOBNOVA Daily Check (DRY RUN)\n\nPR #${pr.number} "${pr.title}" がマージ候補です。\n実際にはマージしていません。`
      );
      return;
    }

    console.log(`[daily-publish-check] PR #${pr.number}をsquash mergeします。`);
    const merge = await squashMergePR(pr.number);
    if (!merge.commitSha) {
      throw new Error(`PR #${pr.number}のmergeに失敗しました（commit SHAを取得できません）。`);
    }
    console.log(`[daily-publish-check] マージ完了: ${merge.commitSha}`);

    console.log("[daily-publish-check] 本番デプロイの完了を待っています...");
    const deploy = await waitForProductionDeploy(merge.commitSha);
    if (!deploy.completed || !deploy.success) {
      await notify(
        false,
        `🚨 HOBNOVA Daily Check\n\nPR #${pr.number}をマージしましたが、本番デプロイの確認に失敗しました。\nCommit: ${merge.commitSha}\n手動で確認してください。\n${merge.prUrl}`
      );
      process.exitCode = 1;
      return;
    }

    const published = findPublishedToday(date);
    if (!published) {
      await notify(
        false,
        `🚨 HOBNOVA Daily Check\n\nPR #${pr.number}をマージ・デプロイしましたが、本日付の記事が見つかりませんでした（frontmatterのpublishDateを確認してください）。\n${merge.prUrl}`
      );
      process.exitCode = 1;
      return;
    }

    const verification = await verifyProductionArticle(published.filePath, published.collection);
    if (!verification.ok) {
      await notify(
        false,
        `🚨 HOBNOVA Daily Check\n\nPR #${pr.number}を公開しましたが、本番ページの確認に失敗しました。\n理由: ${verification.reason}\n${merge.prUrl}`
      );
      process.exitCode = 1;
      return;
    }

    await notify(
      false,
      `✅ HOBNOVA Daily Check\n\n本日（${date}）の記事を公開しました。\n${verification.url}\n\nPR #${pr.number}: ${merge.prUrl}`
    );
    return;
  }

  console.log("[daily-publish-check] マージ可能（CI green・Cloudflare green）な記事PRが見つかりませんでした。");
  const list = candidates.map((c) => `- #${c.number} ${c.title}`).join("\n");
  await notify(
    dryRun,
    `🤖 HOBNOVA Daily Check\n\n本日（${date}）まだ記事が公開されていません。\nCI green・マージ可能な記事PRがありません。\n\n確認中のPR一覧:\n${list}`
  );
}

main().catch((error) => {
  console.error(`[daily-publish-check] ${error.message}`);
  process.exitCode = 1;
});
