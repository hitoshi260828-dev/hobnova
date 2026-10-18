#!/usr/bin/env node
// NEWS朝版/夜版の自動投稿パイプライン。
// 収集(OpenAI Responses API, web_search) -> 重複除外 -> 記事生成 -> ローカルcheck/build
// -> news collectionへcover待ち（draft: true）として保存 -> branch/commit/push -> PR作成
// -> LINE通知（確認待ち） -> 停止
//
// 方針（2026-10-18改訂、2回目）: 文章生成（OpenAI Responses API）と画像生成の役割を分離する。
// OpenAI Image APIをNEWSの標準ルートから外し、画像は「ChatGPTで生成 -> HOBNOVA MCP
// publish_generated_image -> GitHub PR」という既存の正式ルートに統一した（記事用の
// images:generateパイプラインとは別に、NEWS専用でOpenAI Image APIを直接叩く経路を持つと、
// 画像生成の運用・コスト管理・品質基準がルートごとに分裂するため）。
// このスクリプトはcover無し・`draft: true`の記事PRを作るところまでを行う。cover未定の間は
// newsスキーマ上 `draft: true` のため本番には一切表示されない（「画像なしでNEWSを本番公開
// しない」という不変条件を、画像生成の実行順序ではなくdraftフラグで担保する）。
// cover追加（`draft: false`への切り替えを含む）はfunctions/_lib/cover-publish.tsが
// `publish_generated_image(type: cover)` 呼び出し時に行う（別PR、cover-publish.ts側で
// article_pathがsrc/content/news/配下ならcover:フィールド名とdraft解除を自動で扱う）。
//
// 方針（2026-10-18改訂、1回目）: docs/ai-article-guidelines.md 9章「最終Mergeは必ず人間が行う。」に
// 従い、このスクリプトは「レビュー可能なPRを準備する」までしか行わない。mainへのmerge・
// 本番デプロイ確認は一切行わない。
//
// daily-publish-check.mjs（通常記事、JST12:00、1日1本、CI green前提でsquash mergeまで行う）
// とは完全に独立したscheduler/スクリプト。対象ディレクトリ（src/content/news/）・PR検出方式
// （自分で作ったPR番号を直接扱う。既存PRを検索するdaily-publish-check.mjsの方式は使わない）
// のどちらも重複しない設計。
//
// 重要: このスクリプトの実行（DRY_RUN無し、SKIP_PUBLISH無し）はOpenAI APIへの課金が必ず発生する
// （research 1回。画像生成はこのスクリプトでは行わないため課金無し）。DRY_RUNで十分に
// 確認してから実行すること。
//
// GitHub Actionsの既知の仕様: ジョブ内のGITHUB_TOKENで作成したPRのpull_requestイベントは、
// 新しいworkflow実行をトリガーしない（無限ループ防止のための仕様。
// https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow ）。
// そのため pr-check.yml の必須check「astro check & build」はこのPRでは自動発火しない可能性が
// 高い（実機再現検証済み。2026-10-17、PR #62で実際にこの通りの挙動を確認した）。
// このスクリプトは同じcheck/buildを自分のjob内で事前に実行し、結果をPR本文・LINE通知に
// 含めることでこの制約を補う。mainへのmerge可否は人間が判断する。
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectRecentSourceUrls, filterDuplicates } from "./lib/news/dedup.mjs";
import { buildNewsMarkdown, newsFilePath, newsSlug } from "./lib/news/markdown.mjs";
import { researchNews, resolveNewsTextModel } from "./lib/news/research.mjs";
import { withRetry } from "./lib/news/retry.mjs";
import { isLineConfigured, sendLinePush } from "./lib/line-push.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function todayJst(forceDate) {
  if (forceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(forceDate)) throw new Error(`FORCE_DATEの形式が不正です: ${forceDate}`);
    return forceDate;
  }
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().slice(0, 10);
}

export function publishedAtIso(date, edition) {
  // 朝版08:00 JST / 夜版20:00 JST を記事内の公開時刻として記録する（実際の投稿時刻の目安）。
  const hour = edition === "morning" ? "08:00:00" : "20:00:00";
  return `${date}T${hour}+09:00`;
}

async function run(cmd, args, opts = {}) {
  const { stdout } = await execFileAsync(cmd, args, { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024, ...opts });
  return stdout.trim();
}

async function git(args) {
  return run("git", args);
}

async function ghRaw(args) {
  return run("gh", args);
}

async function notify(dryRun, text) {
  console.log(`[news-publish] 通知内容:\n${text}`);
  if (dryRun) {
    console.log("[news-publish] dry-run: LINE APIは呼び出しません。");
    return;
  }
  if (!isLineConfigured()) {
    console.log("[news-publish] LINE未設定のため通知をスキップします。");
    return;
  }
  await sendLinePush(text);
}

/**
 * このslug用のbranchに既に開いているPRがあれば返す（前回実行が失敗後にbranch/PRだけ
 * 残っている場合の再実行に対応する。無ければ毎回research/coverを再実行して課金が重複し、
 * かつgit push/gh pr createがnon-fast-forward/重複PRで失敗する）。
 */
async function findOpenPrForBranch(branch) {
  const output = await ghRaw(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"]);
  const list = JSON.parse(output || "[]");
  return list[0] ? { number: list[0].number, url: list[0].url } : null;
}

/** pr-check.ymlと同じcheckをこのjob内で事前に実行する（GITHUB_TOKEN起点PRではそちらが
 * 自動発火しない可能性があるため）。戻り値のokがfalseならPRを作成しない。 */
async function runLocalCheck() {
  const steps = [
    { label: "astro check", cmd: "npx", args: ["astro", "check"] },
    { label: "build", cmd: "npm", args: ["run", "build"] },
  ];
  for (const step of steps) {
    try {
      await run(step.cmd, step.args);
      console.log(`[news-publish] local check OK: ${step.label}`);
    } catch (err) {
      return { ok: false, failedStep: step.label, message: err.message };
    }
  }
  return { ok: true };
}

const REVIEW_NOTE = [
  "⚠️ GitHub Actionsの仕様により、このPRでは`pr-check.yml`のrequired check「astro check & build」が自動発火しない場合があります",
  "（GITHUB_TOKEN起点で作成されたPRのpull_requestイベントは新しいworkflow実行をトリガーしないため）。",
  "このjob内で同じcheck/buildを事前実行済みです（結果は上記参照）。",
  "mergeボタンが無効なままの場合は、このbranchへご自身の認証で軽微なcommitをpush（例: GitHub Web UIでのファイル編集）すると",
  "pull_requestイベントが正常に発火し、required checkが実行されます。",
].join("\n");

async function main() {
  const dryRun = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
  const skipPublish = process.env.SKIP_PUBLISH === "true" || process.argv.includes("--skip-publish");
  const forceDate = process.env.FORCE_DATE;
  const edition = process.env.EDITION;

  if (edition !== "morning" && edition !== "evening") {
    throw new Error('EDITIONは"morning"または"evening"を指定してください。');
  }

  const date = todayJst(forceDate);
  const slug = newsSlug(date, edition);
  const filePath = newsFilePath(date, edition);
  const branch = `news/${slug}`;
  const editionJa = edition === "morning" ? "朝版" : "夜版";

  console.log(`[news-publish] edition=${edition} date=${date}${dryRun ? " [DRY_RUN]" : ""}${skipPublish ? " [SKIP_PUBLISH]" : ""}`);

  // 冪等性: 同日・同editionの記事が既にmain上に存在すれば即終了する（二重投稿防止）。
  // この判定はAI生成記事が実際にmainへmergeされた後の状態を見るものなので、mergeを人間が
  // 行う今回の方針でも変わらず必要（人間がmergeした後の再実行で再度PRを作らないため）。
  if (fs.existsSync(path.join(REPO_ROOT, filePath))) {
    console.log(`[news-publish] ${filePath} は既に存在します。本日分の${edition}版は公開済みのため終了します。`);
    return;
  }

  const recentUrls = collectRecentSourceUrls(REPO_ROOT, { today: new Date(`${date}T00:00:00Z`) });
  console.log(`[news-publish] 直近の既出source URL: ${recentUrls.size}件（重複除外対象）`);

  // 前回実行がPR作成までで中断した、または単にまだ人間がレビュー中の場合、branchに既に
  // open PRがある可能性がある。その場合はresearch/coverを再実行せず（課金重複防止）、
  // 既存PRの案内のみ再送する。
  const existingPr = await findOpenPrForBranch(branch).catch(() => null);

  if (dryRun) {
    console.log("[news-publish] 計画:");
    console.log(`  slug: ${slug}`);
    console.log(`  planned file: ${filePath}`);
    console.log(`  planned branch: ${branch}`);
    console.log(`  text model: ${resolveNewsTextModel()}`);
    console.log(`  cover: このスクリプトでは生成しない（ChatGPT + publish_generated_imageで後付け、追加までdraft: true）`);
    if (existingPr) {
      console.log(`  既存PRを検出: #${existingPr.number} (${existingPr.url})。実行時はresearch/coverを再生成せずこのPRの案内のみ再送します。`);
    }
    console.log("[news-publish] dry-run: OpenAI APIは呼び出しません。GitHubへの書き込みも行いません。mergeはこのスクリプトでは一切行いません（人間が行います）。");
    return;
  }

  if (existingPr) {
    console.log(`[news-publish] ブランチ${branch}の既存PRを検出: #${existingPr.number} (${existingPr.url})。再生成せず案内のみ再送します。`);
    await notify(
      false,
      `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRは既に作成済みです。レビュー・mergeをお願いします。\n${existingPr.url}`
    );
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です。ニュース生成には必須のため処理を中止します。");
  }

  // --- 1. 収集 + 記事生成（研究と執筆を1コールにまとめる） ---
  console.log("[news-publish] ニュースを収集・生成しています（OpenAI, web_search）...");
  const research = await withRetry(
    () => researchNews({ edition, date, excludeUrls: [...recentUrls] }, { apiKey, model: resolveNewsTextModel() }),
    { maxRetries: 2, onAttemptError: (err, attempt) => console.warn(`[news-publish] research失敗(試行${attempt + 1}): ${err.message}`) }
  );

  if (research.rejectedSources?.length > 0) {
    // 実際に解決しない（ハルシネートされた）sourceUrlはresearchNews内で既に除外済み。
    // ここではログに残すだけ（PR #62で実際に発生した事故の再検知例）。
    for (const rejected of research.rejectedSources) {
      console.warn(`[news-publish] sourceUrlが解決できないため除外しました: "${rejected.heading}" -> ${rejected.sourceUrl}`);
    }
  }

  research.items = filterDuplicates(research.items, recentUrls);
  if (research.items.length === 0) {
    throw new Error("収集したニュースが全て直近で既出または無効なsourceUrlのため、公開対象がありません。");
  }
  console.log(`[news-publish] ニュース項目: ${research.items.length}件`);

  // --- 2. Markdown組み立て + ローカル書き込み（cover無し、draft: true = cover待ち状態） ---
  // 画像生成はこのスクリプトでは行わない（方針2026-10-18改訂2回目）。coverは後でChatGPT経由の
  // publish_generated_image(type: cover)で追加される（functions/_lib/cover-publish.tsが
  // そのPRでcover:フィールドの書き込みとdraft: falseへの切り替えを同じcommitで行う）。
  const markdown = buildNewsMarkdown({
    date,
    edition,
    publishedAtIso: publishedAtIso(date, edition),
    title: research.title,
    description: research.description,
    summary: research.summary,
    topics: research.topics,
    items: research.items,
  });

  const newsDir = path.join(REPO_ROOT, "src/content/news");
  fs.mkdirSync(newsDir, { recursive: true });
  fs.writeFileSync(path.join(newsDir, `${slug}.md`), markdown, "utf8");
  console.log(`[news-publish] 記事をローカルへ書き込みました（cover待ち、draft: true）: ${filePath}`);

  if (skipPublish) {
    console.log("[news-publish] SKIP_PUBLISH: git/PR操作は行わず、生成結果のみ報告してここで終了します。");
    await notify(
      true,
      `🤖 HOBNOVA NEWS ${editionJa} (SKIP_PUBLISH)\n\n記事を生成しました（PR作成・commit/pushは行っていません）。\n\n📄 ${research.title}\n📝 ${research.description}\n項目数: ${research.items.length}\nローカルパス: ${filePath}`
    );
    return;
  }

  // --- 4. ローカルcheck（pr-check.ymlと同じ内容。壊れた内容ではPRを作らない） ---
  console.log("[news-publish] ローカルでastro check / buildを実行しています...");
  const localCheck = await runLocalCheck();
  if (!localCheck.ok) {
    throw new Error(`ローカルcheckに失敗したため、PRを作成せず中止します（${localCheck.failedStep}）: ${localCheck.message}`);
  }

  // --- 5. branch/commit/push ---
  // -B: 前回実行がpush前に失敗し、ローカルにbranchの残骸だけ残っているケースでも
  // クラッシュせずHEADから作り直す（この分岐に来る時点でopen PRは無いことを確認済み）。
  await git(["checkout", "-B", branch]);
  await git(["add", `src/content/news/${slug}.md`]);
  await git([
    "-c", "user.name=hobnova-news-bot",
    "-c", "user.email=actions@users.noreply.github.com",
    "commit", "-m", `Add ${editionJa} news for ${date} (cover待ち)`,
  ]);
  await git(["push", "-u", "origin", branch]);

  // --- 6. PR作成（mainへのmergeはここでは行わない。最終判断は人間。cover待ちのためdraft: true） ---
  const prBody = [
    "## 概要",
    "",
    `NEWS自動投稿（${editionJa}）。OpenAI（web_search + ${resolveNewsTextModel()}）による収集・要約。`,
    "",
    `- 対象日: ${date}`,
    `- ニュース項目数: ${research.items.length}`,
    `- ローカルcheck（astro check / build）: PASS`,
    `- cover: 未設定（\`draft: true\`、cover待ち）`,
    "",
    "⚠️ この記事はcoverが無いため本番には表示されません（`draft: true`）。" +
      "このPRをmergeした後、ChatGPTで生成した画像をHOBNOVA MCPの`publish_generated_image`" +
      `（type: cover, article_path: \`${filePath}\`）で追加してください。追加されると同じcommitで\`draft: false\`に` +
      "切り替わり、本番に表示されます。画像なしでのdraft手動変更は行わないでください。",
    "",
    "自動生成コンテンツのため、内容の事実確認の上で人間がmergeしてください。このPRは自動でmergeされません。",
    "",
    REVIEW_NOTE,
    "",
    "🤖 Generated via news-publish.mjs",
  ].join("\n");

  const prUrl = await ghRaw([
    "pr", "create",
    "--base", "main",
    "--head", branch,
    "--title", `NEWS ${editionJa} ${date}`,
    "--body", prBody,
  ]);
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? Number(prNumberMatch[1]) : null;
  console.log(`[news-publish] PR作成: ${prUrl}`);
  if (!prNumber) throw new Error(`PR番号をURLから取得できませんでした: ${prUrl}`);

  await notify(
    false,
    `🤖 HOBNOVA NEWS ${editionJa}\n\n${date}分のPRを作成しました（ローカルcheck PASS、cover待ち）。\n内容を確認し、問題なければGitHubでmergeしてください。mergeした後、ChatGPTでcoverを追加するまで本番には表示されません。\n${prUrl}`
  );
  console.log("[news-publish] PR作成完了。mergeは人間が行うため、ここで終了します。");
}

// news-publish.mjs/daily-publish-check.mjs/notify-article-ready.mjsで実際に発生した「importする
// だけでmain()が実行されてしまう」不具合と同じ対策。テストがこのファイルをimportしても
// main()が走らないようガードする。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    // Secret値・APIレスポンス本文はログへ出さない（error.messageのみ）。
    console.error(`[news-publish] ${error.message}`);
    process.exitCode = 1;
  });
}
