import OpenAI from 'openai';
import { withRetry } from './retry';

// モデル名はここ1箇所のみにハードコードし、他の場所では必ずこの関数/環境変数経由で参照する。
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';

export function resolveOpenAiImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
}

export interface GeneratedImageBuffer {
  buffer: Buffer;
  /** 拡張子（ドットなし） */
  ext: string;
}

export interface OpenAiCoverConfig {
  apiKey: string;
  model: string;
}

/**
 * OpenAI Image APIでアイキャッチ画像を1枚生成する。
 * gpt-image-1系は常にbase64（b64_json）を返す。
 */
export async function generateCoverImage(prompt: string, config: OpenAiCoverConfig): Promise<GeneratedImageBuffer> {
  const client = new OpenAI({ apiKey: config.apiKey });

  return withRetry(
    async () => {
      const response = await client.images.generate({
        model: config.model,
        prompt,
        size: '1536x1024',
        n: 1,
      });

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) {
        throw new Error('OpenAI Image API returned no image data (b64_json missing)');
      }

      return { buffer: Buffer.from(b64, 'base64'), ext: 'png' };
    },
    { label: 'openai-cover', maxRetries: 2 }
  );
}
