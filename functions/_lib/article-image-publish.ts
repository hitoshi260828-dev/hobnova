// Add approved PNG/JPEG/WebP images to an existing article PR in one atomic commit.
import { createBlob, createCommitObject, createTree, getBranchHeadSha, getCommit, getFileContents, resolveGitHubToken, updateRef, type GitHubAuthEnv, type TreeEntry } from './github-client';
import { bytesToBase64, validateArticlePath, validateImageInput, type ImageInputArgs } from './image-validate';
import { HOBNOVA_REPO } from './cover-publish';

export interface PublishArticleImagesArgs {
  article_path?: unknown;
  branch?: unknown;
  images?: Array<{ key?: unknown; image?: ImageInputArgs; alt?: unknown }>;
  dry_run?: unknown;
}

export async function publishArticleImages(env: GitHubAuthEnv, args: PublishArticleImagesArgs) {
  const checked = validateArticlePath(args.article_path);
  if (!checked.valid || !checked.dir || !checked.slug) return { status: 'error', code: 'invalid_article_path' };
  if (typeof args.branch !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,120}$/.test(args.branch) || args.branch === 'main' || args.branch.includes('..') || args.branch.includes('//')) {
    return { status: 'error', code: 'invalid_branch' };
  }
  if (!Array.isArray(args.images) || args.images.length < 1 || args.images.length > 8) return { status: 'error', code: 'invalid_images_count' };
  const entries: Array<{ key: string; path: string; relative: string; data: Uint8Array }> = [];
  const keys = new Set<string>();
  for (const item of args.images) {
    if (typeof item.key !== 'string' || !/^(hero|day-night|screen-size|checkpoints|lumens-guide)$/.test(item.key) || keys.has(item.key)) return { status: 'error', code: 'invalid_image_key' };
    keys.add(item.key);
    const checkedImage = validateImageInput(item.image);
    if (!checkedImage.valid || !checkedImage.bytes || !checkedImage.extension) return { status: 'error', code: 'invalid_image', message: checkedImage.error };
    const filename = `${checked.slug}-${item.key}.${checkedImage.extension}`;
    entries.push({ key: item.key, path: checked.dir + filename, relative: './' + filename, data: checkedImage.bytes });
  }
  const articlePath = args.article_path as string;
  try {
    const token = await resolveGitHubToken(env);
    const headSha = await getBranchHeadSha(token, HOBNOVA_REPO, args.branch);
    const article = await getFileContents(token, HOBNOVA_REPO, articlePath, args.branch);
    if (!article) return { status: 'error', code: 'article_not_found' };
    const binary = atob(article.content.replace(/\s/g, ''));
    const markdown = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    let updated = markdown;
    for (const item of entries) {
      if (item.key === 'hero') {
        if (!/^image:.*$/m.test(updated)) return { status: 'error', code: 'hero_field_missing' };
        updated = updated.replace(/^image:.*$/m, `image: "${item.relative}"`);
      } else {
        const svgName = `./${checked.slug}-${item.key}.svg`;
        // The PR may use a legacy name (Aladdin X2 article); replace by role, not by slug.
        const role = { 'day-night': 'aladdin-x2-day-night.svg', 'screen-size': 'aladdin-x2-screen-size.svg', checkpoints: 'aladdin-x2-checkpoints.svg', 'lumens-guide': 'aladdin-x2-lumens-guide.svg' }[item.key];
        const oldRef = role ? './' + role : svgName;
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
    // Delete the temporary SVGs only when replacing all five assets.
    if (entries.length === 5 && ['hero','day-night','screen-size','checkpoints','lumens-guide'].every(k => keys.has(k))) {
      for (const name of ['aladdin-x2-brightness-hero.svg','aladdin-x2-day-night.svg','aladdin-x2-screen-size.svg','aladdin-x2-checkpoints.svg','aladdin-x2-lumens-guide.svg']) {
        tree.push({ path: checked.dir + name, mode: '100644', type: 'blob', sha: null });
      }
    }
    const treeSha = await createTree(token, HOBNOVA_REPO, headCommit.tree.sha, tree);
    const commitSha = await createCommitObject(token, HOBNOVA_REPO, 'Replace temporary projector SVGs with approved images', treeSha, headSha);
    await updateRef(token, HOBNOVA_REPO, args.branch, commitSha);
    return { status: 'success', branch: args.branch, commit_sha: commitSha, image_paths: entries.map(e => e.path) };
  } catch {
    return { status: 'error', code: 'github_operation_failed' };
  }
}
