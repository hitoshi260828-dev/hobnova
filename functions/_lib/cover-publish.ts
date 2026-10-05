// ChatGPT（MCP経由）から受け取った生成画像を、HOBNOVAのcoverとして取り込みPRを作るユースケース。
// scripts/lib/image-pipeline/import-image.ts（ローカルCLI版 images:import）と同じ規約
// （{slug}-hero.{ext}、既存cover優先保護、replace時は拡張子違いの旧ファイルを削除）を踏襲するが、
// 実行環境がCloudflare Workersのため、ファイルI/OではなくGitHub APIへの書き込みとして実装する。

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
  resolveGitHubToken,
  updateRef,
  type GitHubAuthEnv,
  type GitHubRepoRef,
  type TreeEntry,
} from './github-client';
import { readFrontmatterImage, writeFrontmatterImage } from './frontmatter-patch';
import { bytesToBase64, validateArticlePath, validateImageInput, type ImageInputArgs } from './image-validate';

export const HOBNOVA_REPO: GitHubRepoRef = { owner: 'hitoshi260828-dev', repo: 'hobnova' };
const BASE_BRANCH = 'main';

export interface PublishCoverArgs {
  article_path?: unknown;
  image?: ImageInputArgs;
  alt?: unknown;
  replace?: unknown;
  dry_run?: unknown;
}

export type PublishCoverResult =
  | {
      status: 'success';
      article_path: string;
      image_path: string;
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
      existing_image: string | null;
      planned_branch: string;
    }
  | { status: 'cover_exists'; article_path: string; current_image: string }
  | { status: 'error'; code: string; message: string };

function errorResult(code: string, message: string): PublishCoverResult {
  return { status: 'error', code, message };
}

function humanizeSlug(slug: string): string {
  return slug.replace(/-/g, ' ');
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function publishCover(env: GitHubAuthEnv, args: PublishCoverArgs): Promise<PublishCoverResult> {
  const pathCheck = validateArticlePath(args.article_path);
  if (!pathCheck.valid || !pathCheck.slug || !pathCheck.dir) {
    return errorResult('invalid_article_path', pathCheck.error ?? 'invalid article_path');
  }
  const articlePath = args.article_path as string;
  const slug = pathCheck.slug;

  const imageCheck = validateImageInput(args.image);
  if (!imageCheck.valid || !imageCheck.bytes || !imageCheck.extension) {
    return errorResult('invalid_image', imageCheck.error ?? 'invalid image');
  }

  const replace = args.replace === true;
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
  const current = readFrontmatterImage(markdownSource);
  if (!current.hasFrontmatter) {
    return errorResult('no_frontmatter', `${articlePath} has no frontmatter block`);
  }

  if (current.image && !replace) {
    return { status: 'cover_exists', article_path: articlePath, current_image: current.image };
  }

  const imagePath = `${pathCheck.dir}${slug}-hero.${imageCheck.extension}`;
  const imageRelativeRef = `./${slug}-hero.${imageCheck.extension}`; // frontmatterはarticleDirからの相対パス
  const branch = `feat/chatgpt-cover-${slug}-${Math.floor(Date.now() / 1000)}`;

  if (dryRun) {
    return {
      status: 'dry_run',
      article_path: articlePath,
      image_path: imagePath,
      existing_image: current.image,
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

    const updatedMarkdown = writeFrontmatterImage(markdownSource, imageRelativeRef);
    const markdownBlobSha = await createBlob(token, HOBNOVA_REPO, btoa(unescape(encodeURIComponent(updatedMarkdown))));

    const treeEntries: TreeEntry[] = [
      { path: imagePath, mode: '100644', type: 'blob', sha: imageBlobSha },
      { path: articlePath, mode: '100644', type: 'blob', sha: markdownBlobSha },
    ];

    // replace時、旧coverの拡張子が新しい画像と異なる場合は孤立ファイルとして削除する
    // （scripts/lib/image-pipeline/import-image.ts のimportCoverと同じ安全対策）。
    if (current.image) {
      const oldPath = resolveFrontmatterImagePath(pathCheck.dir, current.image);
      // 新画像パス・記事ファイル自身のパスのどちらとも異なる場合のみ削除する。
      // 既存frontmatterの値は検証済みの入力ではない（コミット済みの任意の値がありうる）ため、
      // articlePathと衝突するケースを明示的に除外しておく。
      if (oldPath && oldPath !== imagePath && oldPath !== articlePath) {
        treeEntries.push({ path: oldPath, mode: '100644', type: 'blob', sha: null });
      }
    }

    const newTreeSha = await createTree(token, HOBNOVA_REPO, mainCommit.tree.sha, treeEntries);
    const commitMessage = `Add ChatGPT cover for ${humanizeSlug(slug)}\n\nvia HOBNOVA MCP publish_generated_image tool`;
    const commitSha = await createCommitObject(token, HOBNOVA_REPO, commitMessage, newTreeSha, mainSha);
    await updateRef(token, HOBNOVA_REPO, branch, commitSha);

    const prBody = buildPrBody({ articlePath, imagePath, alt, replace, mimeBytes: imageCheck.bytes.length });
    const pr = await createPullRequest(token, HOBNOVA_REPO, {
      title: `Add ChatGPT cover for ${humanizeSlug(slug)}`,
      head: branch,
      base: BASE_BRANCH,
      body: prBody,
    });

    return {
      status: 'success',
      article_path: articlePath,
      image_path: imagePath,
      branch,
      commit_sha: commitSha,
      pr_number: pr.number,
      pr_url: pr.html_url,
      mergeable: pr.mergeable,
    };
  } catch (err) {
    // branch作成後の途中失敗で孤立branchが残らないよう、作成済みなら片付けを試みる（best-effort）。
    if (branchCreated) await deleteRefSilently(token, HOBNOVA_REPO, branch);
    return errorResult('github_api_error', (err as Error).message);
  }
}

// frontmatterの `./xxx-hero.png` のような相対パスを、リポジトリルートからのパスへ解決する。
// コレクションはフラット構成（サブディレクトリなし）のため `dir + basename` で足りる。
function resolveFrontmatterImagePath(dir: string, relativeImage: string): string | null {
  const basename = relativeImage.replace(/^\.\//, '');
  if (!basename || basename.includes('/') || basename.includes('..')) return null;
  return `${dir}${basename}`;
}

function buildPrBody(input: {
  articlePath: string;
  imagePath: string;
  alt: string | null;
  replace: boolean;
  mimeBytes: number;
}): string {
  const lines = [
    '## 概要',
    '',
    'ChatGPT上で生成・選択した画像を、HOBNOVA MCPの `publish_generated_image` tool経由で取り込んだ自動PRです。',
    '',
    `- 対象記事: \`${input.articlePath}\``,
    `- 画像: \`${input.imagePath}\`（${(input.mimeBytes / 1024).toFixed(0)} KB）`,
    input.alt ? `- alt: ${input.alt}` : null,
    input.replace ? '- 既存coverを `replace=true` で置換しています' : '- 既存coverが無い状態への新規追加です',
    '',
    '## 確認事項',
    '',
    '- [ ] 画像の内容が記事テーマと一致している',
    '- [ ] 日本語テキスト（あれば）に文字切れ・文字化けが無い',
    '- [ ] 疑似ウォーターマークや不自然なロゴが無い',
    '- [ ] astro check / build がCIでpassしている',
    '',
    'このPRは自動生成されたものであり、mainへは自動マージされません。内容を確認の上マージしてください。',
    '',
    '🤖 Generated via HOBNOVA MCP (`publish_generated_image`)',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}
