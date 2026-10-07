import { describe, expect, it } from 'vitest';
import { publishArticleImages } from '../_lib/article-image-publish';

describe('publish_article_images validation', () => {
  const env = {};
  const article_path = 'src/content/articles/aladdin-x2-projector-brightness-2026.md';
  it('rejects main branch before GitHub calls', async () => {
    expect(await publishArticleImages(env, { article_path, branch: 'main', images: [{ key: 'hero', image: { data: 'x' } }] })).toMatchObject({ status: 'error', code: 'invalid_branch' });
  });
  it('rejects empty image batches', async () => {
    expect(await publishArticleImages(env, { article_path, branch: 'article/test', images: [] })).toMatchObject({ status: 'error', code: 'invalid_images_count' });
  });
  it('rejects duplicate image roles', async () => {
    expect(await publishArticleImages(env, { article_path, branch: 'article/test', images: [{ key: 'hero', image: { data: 'x' } }, { key: 'hero', image: { data: 'x' } }] })).toMatchObject({ status: 'error', code: 'invalid_image' });
  });
  it('rejects path traversal', async () => {
    expect(await publishArticleImages(env, { article_path: '../secret.md', branch: 'article/test', images: [] })).toMatchObject({ status: 'error', code: 'invalid_article_path' });
  });
});
