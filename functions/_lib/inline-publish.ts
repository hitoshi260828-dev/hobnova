// ChatGPT（MCP経由）から受け取った生成画像を、HOBNOVAの本文（inline）画像として取り込みPRを作る。
// cover-publish.ts（publish_generated_image の type: 'cover'）と対になるtype: 'inline'実装。
// GitHub Git Data APIの使い方・branch命名・既存コードの保護方針はcover-publish.tsを踏襲し、
// scripts/lib/image-pipeline/import-image.ts（ローカルCLI版 images:import --type inline）と
// 同じ保存規約（public/images/articles/{slug}/inline-NN.{ext}）を使う。

import {
  createBlob,
  createCommitObject,
  createPullRequest,
  createRef,
  createTree,
  deleteRefSilently,
  getBranchHeadSha,
  getCommit,
  getFileContents,
  listDirectory,
  resolveGitHubToken,
  updateRef,
  type GitHubAuthEnv,
  type TreeEntry,
} from './github-client';
import { findHeadings, insertInlineImage, isAlreadyInserted, resolveInsertPosition } from './inline-image-insert';
import { bytesToBase64, resolveImageInput, validateArticlePath, type ImageInputArgs } from './image-validate';
import { BASE_BRANCH, decodeBase64Utf8, HOBNOVA_REPO, humanizeSlug } from './cover-publish';

const INLINE_FILENAME_PATTERN = /^inline-(\d+)\.(png|jpe?g|webp)$/i;
// コスト暴走防止のハードキャップ。scripts/lib/image-pipeline/sections.ts の既定上限と揃える。
const MAX_INLINE_IMAGES = 4;

export interface PublishInlineArgs {
  article_path?: unknown;
  image?: ImageInputArgs;
  alt?: unknown;
  after_heading?: unknown;
  position?: unknown;
  dry_run?: unknown;
}

export type PublishInlineResult =
  | {
      status: 'success';
      article_path: string;
      image_path: string;
      reference_path: string;
      heading: string;
      branch: string;
      commit_sha: string;
      pr_number: number;
      pr_url: string;
      mergeable: boolean | null;
    }
  | {
      status: 'dry_run';
      article_path: string;
      image_path: string;
      reference_path: string;
      heading: string;
      planned_branch: string;
    }
  | { status: 'already_inserted'; article_path: string; reference_path: string }
  | { status: 'error'; code: string; message: string };

function errorResult(code: string, message: string): PublishInlineResult {
  return { status: 'error', code, message };
}

function nextInlineIndex(entries: Array<{ name: string }> | null): number {
  if (!entries) return 1;
  const max = entries
    .map((e) => INLINE_FILENAME_PATTERN.exec(e.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number.parseInt(m[1], 10))
    .reduce((acc, n) => Math.max(acc, n), 0);
  return max + 1;
}

export async function publishInlineImage(env: GitHubAuthEnv, args: PublishInlineArgs): Promise<PublishInlineResult> {
  const pathCheck = validateArticlePath(args.article_path);
  if (!pathCheck.valid || !pathCheck.slug) {
    return errorResult('invalid_article_path', pathCheck.error ?? 'invalid article_path');
  }
  const articlePath = args.article_path as string;
  const slug = pathCheck.slug;

  const imageCheck = await resolveImageInput(args.image);
  if (!imageCheck.valid || !imageCheck.bytes || !imageCheck.extension) {
    return errorResult('invalid_image', imageCheck.error ?? 'invalid image');
  }
  // 本文画像はJPEG/WebPを主用途として設計している（既存CLIと同様）が、png自体は拒否しない。
  // ただしinline-NN.{ext}の{ext}は検証済みのimageCheck.extensionをそのまま使う。

  const afterHeading = typeof args.after_heading === 'string' ? args.after_heading : undefined;
  const position = typeof args.position === 'number' ? args.position : undefined;
  const dryRun = args.dry_run === true;
  const alt = typeof args.alt === 'string' && args.alt.trim().length > 0 ? args.alt.trim().slice(0, 200) : null;

  let token: string;
  try {
    token = await resolveGitHubToken(env);
  } catch (err) {
    return errorResult('github_auth_failed', (err as Error).message);
  }

  let fileContents;
  try {
    fileContents = await getFileContents(token, HOBNOVA_REPO, articlePath, BASE_BRANCH);
  } catch (err) {
    return errorResult('github_api_error', (err as Error).message);
  }
  if (!fileContents) {
    return errorResult('article_not_found', `${articlePath} was not found on ${BASE_BRANCH}`);
  }

  const markdownSource = decodeBase64Utf8(fileContents.content);
  if (findHeadings(markdownSource).length === 0) {
    return errorResult('no_headings', `${articlePath} has no H2 headings to insert an image after`);
  }
  const position_ = resolveInsertPosition(markdownSource, { afterHeading, position });
  if ('error' in position_) {
    return errorResult('invalid_position', position_.error);
  }

  const inlineDir = `public/images/articles/${slug}`;
  let existingEntries;
  try {
    existingEntries = await listDirectory(token, HOBNOVA_REPO, inlineDir, BASE_BRANCH);
  } catch (err) {
    return errorResult('github_api_error', (err as Error).message);
  }

  const existingCount = (existingEntries ?? []).filter((e) => INLINE_FILENAME_PATTERN.test(e.name)).length;
  if (existingCount >= MAX_INLINE_IMAGES) {
    return errorResult('inline_limit_reached', `${articlePath} already has ${existingCount} inline images (max ${MAX_INLINE_IMAGES})`);
  }

  const index = String(nextInlineIndex(existingEntries)).padStart(2, '0');
  const fileName = `inline-${index}.${imageCheck.extension}`;
  const imagePath = `${inlineDir}/${fileName}`;
  const referencePath = `/images/articles/${slug}/${fileName}`;

  if (isAlreadyInserted(markdownSource, referencePath)) {
    return { status: 'already_inserted', article_path: articlePath, reference_path: referencePath };
  }

  const resolvedAlt = alt ?? `「${position_.heading.replace(/[「」]/g, '')}」を示す画像`;
  const branch = `feat/chatgpt-inline-${slug}-${Math.floor(Date.now() / 1000)}`;

  if (dryRun) {
    return {
      status: 'dry_run',
      article_path: articlePath,
      image_path: imagePath,
      reference_path: referencePath,
      heading: position_.heading,
      planned_branch: branch,
    };
  }

  let branchCreated = false;
  try {
    const mainSha = await getBranchHeadSha(token, HOBNOVA_REPO, BASE_BRANCH);
    const mainCommit = await getCommit(token, HOBNOVA_REPO, mainSha);

    await createRef(token, HOBNOVA_REPO, branch, mainSha);
    branchCreated = true;

    const imageBlobSha = await createBlob(token, HOBNOVA_REPO, bytesToBase64(imageCheck.bytes));

    const updatedMarkdown = insertInlineImage(markdownSource, position_.headingEndIndex, resolvedAlt, referencePath);
    const markdownBlobSha = await createBlob(token, HOBNOVA_REPO, btoa(unescape(encodeURIComponent(updatedMarkdown))));

    const treeEntries: TreeEntry[] = [
      { path: imagePath, mode: '100644', type: 'blob', sha: imageBlobSha },
      { path: articlePath, mode: '100644', type: 'blob', sha: markdownBlobSha },
    ];

    const newTreeSha = await createTree(token, HOBNOVA_REPO, mainCommit.tree.sha, treeEntries);
    const commitMessage = `Add ChatGPT inline image for ${humanizeSlug(slug)}\n\nvia HOBNOVA MCP publish_generated_image tool (type: inline)`;
    const commitSha = await createCommitObject(token, HOBNOVA_REPO, commitMessage, newTreeSha, mainSha);
    await updateRef(token, HOBNOVA_REPO, branch, commitSha);

    const prBody = buildPrBody({ articlePath, imagePath, heading: position_.heading, alt: resolvedAlt, mimeBytes: imageCheck.bytes.length });
    const pr = await createPullRequest(token, HOBNOVA_REPO, {
      title: `Add ChatGPT inline image for ${humanizeSlug(slug)}`,
      head: branch,
      base: BASE_BRANCH,
      body: prBody,
    });

    return {
      status: 'success',
      article_path: articlePath,
      image_path: imagePath,
      reference_path: referencePath,
      heading: position_.heading,
      branch,
      commit_sha: commitSha,
      pr_number: pr.number,
      pr_url: pr.html_url,
      mergeable: pr.mergeable,
    };
  } catch (err) {
    if (branchCreated) await deleteRefSilently(token, HOBNOVA_REPO, branch);
    return errorResult('github_api_error', (err as Error).message);
  }
}

function buildPrBody(input: { articlePath: string; imagePath: string; heading: string; alt: string; mimeBytes: number }): string {
  const lines = [
    '## 概要',
    '',
    'ChatGPT上で生成・選択した画像を、HOBNOVA MCPの `publish_generated_image`（type: inline）tool経由で取り込んだ自動PRです。',
    '',
    `- 対象記事: \`${input.articlePath}\``,
    `- 挿入位置: 「${input.heading}」の直後`,
    `- 画像: \`${input.imagePath}\`（${(input.mimeBytes / 1024).toFixed(0)} KB）`,
    `- alt: ${input.alt}`,
    '',
    '## 確認事項',
    '',
    '- [ ] 画像の内容がそのセクションの内容と一致している',
    '- [ ] 日本語テキスト（あれば）に文字切れ・文字化けが無い',
    '- [ ] 疑似ウォーターマークや不自然なロゴが無い',
    '- [ ] astro check / build がCIでpassしている',
    '',
    'このPRは自動生成されたものであり、mainへは自動マージされません。内容を確認の上マージしてください。',
    '',
    '🤖 Generated via HOBNOVA MCP (`publish_generated_image`, type: inline)',
  ];
  return lines.join('\n');
}
