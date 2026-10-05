import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import { hasExistingCover, hasExistingInlineImages, loadArticleFile, publicInlineImageDir, type ArticleFile } from './article-file';
import { buildImagePlan, type ImagePlan } from './plan';
import { runImageGenerationPlan, type ImageGenerationRunResult } from './run-image-generation';
import { verifyCoverImage, verifyInlineImages, type CoverVerificationResult, type InlineVerificationResult } from './verify';

export interface CommandCheckResult {
  status: 'pass' | 'fail' | 'skipped';
  output: string;
}

export type RunCommand = (command: string, args: string[], cwd: string) => string;

export interface DailyPipelineOptions {
  articlePath: string;
  repoRoot: string;
  dryRun: boolean;
  force: boolean;
  coverOnly: boolean;
  inlineOnly: boolean;
  /** テスト用の差し替え。省略時は node:child_process の execFileSync を実際に呼ぶ。 */
  runCommand?: RunCommand;
}

export interface DailyPipelineResult {
  article: ArticleFile;
  /** frontmatterのdraftフラグ（このパイプラインは一切変更しない。参照のみ）。 */
  draft: boolean;
  plan: ImagePlan;
  generation: ImageGenerationRunResult | null;
  verification: { cover: CoverVerificationResult; inline: InlineVerificationResult } | null;
  astroCheck: CommandCheckResult;
  build: CommandCheckResult;
  gitStatus: string | null;
}

function defaultRunCommand(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function runCheckStep(run: RunCommand, command: string, args: string[], cwd: string): CommandCheckResult {
  try {
    const output = run(command, args, cwd);
    return { status: 'pass', output };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    const output = [error.stdout?.toString(), error.stderr?.toString(), error.message].filter(Boolean).join('\n');
    return { status: 'fail', output };
  }
}

/**
 * 「記事Markdown確定 → 画像生成（OpenAI cover / Cloudflare inline） → astro check → build →
 * git diff確認」までを1本にまとめたパイプライン。PR作成自体は行わない
 * （既存のPR作成は人間またはPRを作成する側のエージェントの既存運用に従うため、
 * ここでは「PR作成に渡せる状態」まで整えて終わる）。
 *
 * 画像生成APIが失敗しても例外を投げない。記事Markdownは常に保持し、成功した画像だけを
 * 反映する（runImageGenerationPlanの保証をそのまま引き継ぐ）。astro check / build も、
 * 片方が失敗しても可能な範囲で両方実行し、結果を両方とも返す。
 */
export async function runDailyArticlePipeline(options: DailyPipelineOptions): Promise<DailyPipelineResult> {
  const article = loadArticleFile(options.articlePath);
  const draft = article.data.draft === true;

  const plan = buildImagePlan({
    article,
    coverOnly: options.coverOnly,
    inlineOnly: options.inlineOnly,
    hasExistingCover: hasExistingCover(article),
    hasExistingInlineImages: hasExistingInlineImages(options.repoRoot, article.slug),
    force: options.force,
  });

  if (options.dryRun) {
    return {
      article,
      draft,
      plan,
      generation: null,
      verification: null,
      astroCheck: { status: 'skipped', output: '--dry-run のため実行していません' },
      build: { status: 'skipped', output: '--dry-run のため実行していません' },
      gitStatus: null,
    };
  }

  const generation = await runImageGenerationPlan(article, options.repoRoot, plan);

  const coverVerification = verifyCoverImage(article);
  const inlineCheckTargets = generation.inline.outcomes
    .filter((o): o is typeof o & { targetPath: string; referencePath: string } => o.status === 'success' && !!o.targetPath && !!o.referencePath)
    .map((o) => ({ targetPath: o.targetPath, referencePath: o.referencePath }));
  const inlineVerification = verifyInlineImages(article, inlineCheckTargets);

  const run = options.runCommand ?? defaultRunCommand;

  const astroCheck = runCheckStep(run, 'npx', ['astro', 'check'], options.repoRoot);
  // astro checkが失敗しても、buildは可能な範囲で続行する（どちらの結果もレポートに出すため）。
  const build = runCheckStep(run, 'npm', ['run', 'build'], options.repoRoot);

  let gitStatus: string | null;
  try {
    const inlineDir = publicInlineImageDir(options.repoRoot, article.slug);
    const pathspecs = [article.absolutePath, ...(fs.existsSync(inlineDir) ? [inlineDir] : [])];
    gitStatus = run('git', ['status', '--short', '--', ...pathspecs], options.repoRoot);
  } catch (err) {
    gitStatus = `[WARN] git status 取得に失敗: ${(err as Error).message}`;
  }

  return {
    article,
    draft,
    plan,
    generation,
    verification: { cover: coverVerification, inline: inlineVerification },
    astroCheck,
    build,
    gitStatus,
  };
}
