// 無認証の読み取り専用diagnosticエンドポイント。/api/mcp自体はOAuth必須のため、
// 「本番が実際にどのtool schemaを返しているか」を外部から素早く確認する手段が無かった
// （2026-10-18、ChatGPT connector側が旧schemaのまま見える問題の調査で必要になった）。
//
// ここで返す内容はtools/listで認証済みクライアントへも同じ形で見える公開tool定義
// （名前・入力schemaの構造）であり、Secret・利用者データは一切含まない。
// HOBNOVA_OAUTH_OWNER_SECRET等は読み取らず、参照もしない。
import { MCP_SCHEMA_VERSION, TOOLS } from './mcp';

export const onRequestGet: PagesFunction = async () => {
  const publishTool = TOOLS.find((t) => t.name === 'publish_generated_image');
  const imageSchema = publishTool
    ? (publishTool.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>).image
    : undefined;
  const imageProps = imageSchema?.properties ? Object.keys(imageSchema.properties) : [];

  const body = {
    schemaVersion: MCP_SCHEMA_VERSION,
    toolNames: TOOLS.map((t) => t.name),
    publishGeneratedImage: publishTool
      ? {
          hasMeta: '_meta' in publishTool,
          meta: (publishTool as { _meta?: unknown })._meta ?? null,
          typeEnum: (publishTool.inputSchema.properties as Record<string, { enum?: readonly string[] }>).type?.enum ?? null,
          imageProperties: imageProps,
          inlineFields: ['after_heading', 'position', 'alt'].filter(
            (f) => f in (publishTool.inputSchema.properties as Record<string, unknown>)
          ),
        }
      : null,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
