import { describe, expect, it } from 'vitest';
import { onRequestGet } from '../api/mcp-schema-check';

async function getBody(res: Response): Promise<any> {
  return JSON.parse(await res.text());
}

// このテストは/api/mcp-schema-checkの応答内容を固定することで、tools/listのschema
// （特にpublish_generated_imageのtype/image/_meta）が意図せず後退した場合にCIで検知する
// 「schema snapshot test」として機能する（2026-10-18、ChatGPT connector側が旧schemaの
// ままに見える問題の調査で追加）。
describe('GET /api/mcp-schema-check（無認証診断エンドポイント）', () => {
  it('認証なしで200を返す', async () => {
    const res = await onRequestGet({} as never);
    expect(res.status).toBe(200);
  });

  it('Secretを含まない（HOBNOVA_OAUTH_OWNER_SECRET等の文字列が応答に出ない）', async () => {
    const res = await onRequestGet({} as never);
    const text = await res.text();
    expect(text).not.toMatch(/secret|token|key/i);
  });

  it('publish_generated_imageがtype: cover/inline両方をサポートする', async () => {
    const res = await onRequestGet({} as never);
    const body = await getBody(res);
    expect(body.publishGeneratedImage.typeEnum).toEqual(['cover', 'inline']);
  });

  it('imageがdownload_url/file_id/file_name/dataを全てサポートする', async () => {
    const res = await onRequestGet({} as never);
    const body = await getBody(res);
    expect(body.publishGeneratedImage.imageProperties).toEqual(
      expect.arrayContaining(['download_url', 'file_id', 'file_name', 'data'])
    );
  });

  it('inline用フィールド（after_heading/position/alt）が存在する', async () => {
    const res = await onRequestGet({} as never);
    const body = await getBody(res);
    expect(body.publishGeneratedImage.inlineFields).toEqual(expect.arrayContaining(['after_heading', 'position']));
  });

  it('_meta["openai/fileParams"]がimageを宣言している', async () => {
    const res = await onRequestGet({} as never);
    const body = await getBody(res);
    expect(body.publishGeneratedImage.hasMeta).toBe(true);
    expect(body.publishGeneratedImage.meta['openai/fileParams']).toEqual(['image']);
  });

  it('schemaVersionが現在の期待値（2）と一致する', async () => {
    const res = await onRequestGet({} as never);
    const body = await getBody(res);
    expect(body.schemaVersion).toBe(2);
  });
});
