// Add approved PNG/JPEG/WebP images to an existing article PR in one atomic commit.
import { createBlob, createCommitObject, createTree, getBranchHeadSha, getCommit, getFileContents, resolveGitHubToken, updateRef, type GitHubAuthEnv, type TreeEntry } from './github-client';
import { bytesToBase64, validateArticlePath, validateImageInput, type ImageInputArgs } from './image-validate';
import { HOBNOVA_REPO } from './cover-publish';

export interface PublishArticleImagesArgs {
  article_path?: unknown;
  branch?: unknown;
  images?: Array<{ key?: unknown; image?: ImageInputArgs; alt?: unknown; replace_reference?: unknown }>;
  dry_run?: unknown;
}

export async function publishArticleImages(env: GitHubAuthEnv, args: PublishArticleImagesArgs) {
  const checked = validateArticlePath(args.article_path);
  if (!checked.valid || !checked.dir || !checked.slug) return { status: 'error', code: 'invalid_article_path' };
  if (typeof args.branch !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,120}$/.test(args.branch) || args.branch === 'main' || args.branch.includes('..') || args.branch.includes('//')) {
    return { status: 'error', code: 'invalid_branch' };
  }
  if (!Array.isArray(args.images) || args.images.length < 1 || args.images.length > 8) return { status: 'error', code: 'invalid_images_count' };
  const entries: Array<{ key: string; path: string; relative: string; data: Uint8Array; replaceReference?: string }> = [];
  const keys = new Set<string>();
  for (const item of args.images) {
    if (typeof item.key !== 'string' || !/^[a-z][a-z0-9-]{0,48}$/.test(item.key) || keys.has(item.key)) return { status: 'error', code: 'invalid_image_key' };
    keys.add(item.key);
    const checkedImage = validateImageInput(item.image);
    if (!checkedImage.valid || !checkedImage.bytes || !checkedImage.extension) return { status: 'error', code: 'invalid_image', message: checkedImage.error };
    const filename = `${checked.slug}-${item.key}.${checkedImage.extension}`;
    if (item.key !== 'hero' && (typeof item.replace_reference !== 'string' || !/^\.\/[a-z0-9][a-z0-9.-]*\.(svg|png|jpg|webp)$/.test(item.replace_reference) || item.replace_reference.includes('..'))) return { status: 'error', code: 'invalid_replace_reference' };
    entries.push({ key: item.key, path: checked.dir + filename, relative: './' + filename, data: checkedImage.bytes, replaceReference: item.key === 'hero' ? undefined : item.replace_reference as string });
  }
  const articlePath = args.article_path as string;
  try {
    const token = await resolveGitHubToken(env);
    const headSha = await getBranchHeadSha(token, HOBNOVA_REPO, args.branch);
    // Require an open PR with this exact head and repository before writing.
    const prResponse = await fetch(`https://api.github.com/repos/${HOBNOVA_REPO.owner}/${HOBNOVA_REPO.repo}/pulls?state=open&head=${encodeURIComponent(HOBNOVA_REPO.owner + ':' + args.branch)}&per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!prResponse.ok) return { status: 'error', code: 'pr_lookup_failed' };
    const prs = await prResponse.json() as Array<{ state: string; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string } }>;
    if (!prs.some(pr => pr.state === 'open' && pr.head.ref === args.branch && pr.head.sha === headSha && pr.head.repo?.full_name === `${HOBNOVA_REPO.owner}/${HOBNOVA_REPO.repo}` && pr.base.ref === 'main')) return { status: 'error', code: 'open_pr_not_found' };
    const article = await getFileContents(token, HOBNOVA_REPO, articlePath, args.branch);
    if (!article) return { status: 'error', code: 'article_not_found' };
    const binary = atob(article.content.replace(/\s/g, ''));
    const markdown = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    let updated = markdown;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
    if (!frontmatter) return { status: 'error', code: 'frontmatter_missing' };
    for (const item of entries) {
      if (item.key === 'hero') {
        if (!/^image:.*$/m.test(frontmatter[1])) return { status: 'error', code: 'hero_field_missing' };
        const revisedFrontmatter = frontmatter[0].replace(/^image:.*$/m, `image: "${item.relative}"`);
        updated = revisedFrontmatter + updated.slice(frontmatter[0].length);
      } else {
        const oldRef = item.replaceReference!;
        if (!updated.includes(oldRef)) return { status: 'error', code: 'image_reference_missing', key: item.key };
        updated = updated.split(oldRef).join(item.relative);
      }
    }
    if (args.dry_run === true) return { status: 'dry_run', branch: args.branch, image_paths: entries.map(e => e.path) };
    const headCommit = await getCommit(token, HOBNOVA_REPO, headSha);
    const tree: TreeEntry[] = [];
    for (const item of entries) {
      const sha = await createBlob(token, HOBNOVA_REPO, bytesToBase64(item.data));
      tree.push({ path: item.path, mode: '100644', type: 'blob', sha });
    }
    const textBytes = new TextEncoder().encode(updated);
    tree.push({ path: articlePath, mode: '100644', type: 'blob', sha: await createBlob(token, HOBNOVA_REPO, bytesToBase64(textBytes)) });
    // Preserve previous assets: other articles may still reference them.
    const treeSha = await createTree(token, HOBNOVA_REPO, headCommit.tree.sha, tree);
    const commitSha = await createCommitObject(token, HOBNOVA_REPO, 'Replace article images with approved assets', treeSha, headSha);
    await updateRef(token, HOBNOVA_REPO, args.branch, commitSha);
    return { status: 'success', branch: args.branch, commit_sha: commitSha, image_paths: entries.map(e => e.path) };
  } catch {
    return { status: 'error', code: 'github_operation_failed' };
  }
}
