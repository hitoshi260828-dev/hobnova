import { withRetry } from './retry';
import type { GeneratedImageBuffer } from './openai-cover';

// 将来的に別のFLUX系モデル等へ切り替えられるよう、モデル名は必ず環境変数経由
// （resolveCloudflareImageModel）で参照し、ハードコードしない。
// 注意: 本実装はFLUX.2系（klein-9b等）のmultipart/form-data方式を前提にしている。
// 旧flux-1-schnell等、JSON方式のみを受け付けるモデルへ切り替えた場合は動作しない。
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';

export function resolveCloudflareImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
}

/** CLOUDFLARE_IMAGE_GUIDANCE が設定されていればfloatとして返す（未設定時はundefined＝モデル既定値を使う）。 */
export function resolveCloudflareImageGuidance(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.CLOUDFLARE_IMAGE_GUIDANCE?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface CloudflareInlineConfig {
  accountId: string;
  apiToken: string;
  model: string;
  width?: number;
  height?: number;
  /** ガイダンススケール。値が高いほどプロンプトに厳密に従う（モデルが対応する場合のみ）。 */
  guidance?: number;
  seed?: number;
}

interface CloudflareAiImageResponse {
  success?: boolean;
  result?: { image?: string };
  image?: string;
  errors?: Array<{ code?: number; message?: string }>;
}

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

/**
 * Cloudflare Workers AI（text-to-image、FLUX.2系）で本文画像を1枚生成する。
 * FLUX.2 [klein] 9B等はmultipart/form-dataでの送信が必須（JSON bodyは受け付けない）。
 * Content-Typeヘッダーは手動設定しない（FormDataをbodyに渡すとfetch/undiciが
 * boundary付きのmultipart/form-dataヘッダーを自動生成するため、手動設定すると
 * boundaryが欠落し壊れる）。
 */
export async function generateInlineImage(
  prompt: string,
  config: CloudflareInlineConfig
): Promise<GeneratedImageBuffer> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  return withRetry(
    async () => {
      const form = new FormData();
      form.set('prompt', prompt);
      form.set('width', String(config.width ?? DEFAULT_WIDTH));
      form.set('height', String(config.height ?? DEFAULT_HEIGHT));
      if (config.guidance !== undefined) form.set('guidance', String(config.guidance));
      if (config.seed !== undefined) form.set('seed', String(config.seed));

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiToken}`,
        },
        body: form,
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
