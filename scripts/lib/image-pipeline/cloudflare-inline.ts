import { withRetry } from './retry';
import type { GeneratedImageBuffer } from './openai-cover';

// 将来的に @cf/black-forest-labs/flux-2-klein-9b 等へ切り替えられるよう、モデル名は
// 必ず環境変数経由（resolveCloudflareImageModel）で参照し、ハードコードしない。
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export function resolveCloudflareImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
}

export interface CloudflareInlineConfig {
  accountId: string;
  apiToken: string;
  model: string;
}

interface CloudflareAiImageResponse {
  success?: boolean;
  result?: { image?: string };
  image?: string;
  errors?: Array<{ code?: number; message?: string }>;
}

/**
 * Cloudflare Workers AI（text-to-image）で本文画像を1枚生成する。
 * レスポンスはCloudflareの標準APIエンベロープ（result.image）と、モデルによっては
 * 直接 image を返す形の両方に対応する。
 */
export async function generateInlineImage(
  prompt: string,
  config: CloudflareInlineConfig
): Promise<GeneratedImageBuffer> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  return withRetry(
    async () => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as CloudflareAiImageResponse;
          detail = body.errors?.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') ?? '';
        } catch {
          // レスポンスボディがJSONでない場合は詳細なしで続行する。
        }
        throw new Error(`Cloudflare Workers AI request failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
      }

      const body = (await res.json()) as CloudflareAiImageResponse;
      const base64 = body.result?.image ?? body.image;
      if (!base64) {
        throw new Error('Cloudflare Workers AI returned no image data');
      }

      return { buffer: Buffer.from(base64, 'base64'), ext: 'jpg' };
    },
    { label: 'cloudflare-inline', maxRetries: 2 }
  );
}
