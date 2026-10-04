import { withRetry } from './retry';
import type { GeneratedImageBuffer } from './openai-cover';

// 将来的に別のFLUX系モデル等へ切り替えられるよう、モデル名は必ず環境変数経由
// （resolveCloudflareImageModel）で参照し、ハードコードしない。
//
// 実機検証の結果:
// - @cf/black-forest-labs/flux-2-klein-9b は、現在のmultipart/form-data実装・アカウント・
//   REST直叩き経路では "6003 Request body is not valid json" で失敗する（原因未特定。
//   アカウントのプラン要件、またはCloudflare側のモデル固有の不具合の可能性）。
// - @cf/black-forest-labs/flux-2-dev は、全く同じmultipart実装で実際に生成成功を確認済み
//   （文字/ロゴ/UI混入なし、記事テーマとの関連性も高い写実的な編集写真品質）。
// そのため既定モデルはflux-2-devとする。klein-9bは CLOUDFLARE_IMAGE_MODEL を明示指定すれば
// 引き続き利用・再検証できる。
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-dev';

export function resolveCloudflareImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
}

/** CLOUDFLARE_IMAGE_GUIDANCE が設定されていればfloatとして返す（未設定時はundefined＝完全に省略する）。 */
export function resolveCloudflareImageGuidance(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.CLOUDFLARE_IMAGE_GUIDANCE?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const DEFAULT_STEPS = 25;
// Cloudflare公式ドキュメントにflux-2-dev（非蒸留のフルモデル）のsteps上限が明記されていない
// ため、Black Forest LabsのFLUX [dev]系で一般的に使われる範囲（1〜50）を安全側の目安として
// 採用する。Cloudflare側の確定した公式上限ではない点に注意。範囲外・不正値は既定値25へ
// フォールバックする（無効化や例外にはしない＝動作を止めない）。
const MIN_STEPS = 1;
const MAX_STEPS = 50;

/**
 * CLOUDFLARE_IMAGE_STEPS を検証して返す。未設定・不正値・範囲外は既定値（25）へ
 * 安全にフォールバックする。
 */
export function resolveCloudflareImageSteps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLOUDFLARE_IMAGE_STEPS?.trim();
  if (!raw) return DEFAULT_STEPS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_STEPS || parsed > MAX_STEPS) {
    return DEFAULT_STEPS;
  }
  return parsed;
}

/**
 * FLUX.2系（dev / klein等）はmultipart/form-data必須、flux-1-schnell等の旧世代はJSON body。
 * モデル名で判定する（ハードコードした分岐だが、新モデル追加時はここだけ更新すればよい）。
 */
export function requiresMultipart(model: string): boolean {
  return model.includes('flux-2');
}

/** klein系はsteps固定（調整不可）のため、stepsフィールド自体を送らない。 */
function supportsConfigurableSteps(model: string): boolean {
  return requiresMultipart(model) && !model.includes('klein');
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
  /** 拡散ステップ数。multipart系モデルのみ有効（klein系は固定のため無視される）。 */
  steps?: number;
}

interface CloudflareAiImageResponse {
  success?: boolean;
  result?: { image?: string };
  image?: string;
  errors?: Array<{ code?: number; message?: string }>;
}

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

function parseCloudflareErrorDetail(rawBody: string): string {
  try {
    const body = JSON.parse(rawBody) as CloudflareAiImageResponse;
    return body.errors?.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') ?? '';
  } catch {
    return '';
  }
}

async function callMultipart(endpoint: string, prompt: string, config: CloudflareInlineConfig): Promise<Response> {
  const form = new FormData();
  form.set('prompt', prompt);
  form.set('width', String(config.width ?? DEFAULT_WIDTH));
  form.set('height', String(config.height ?? DEFAULT_HEIGHT));
  if (config.guidance !== undefined) form.set('guidance', String(config.guidance));
  if (config.seed !== undefined) form.set('seed', String(config.seed));
  if (config.steps !== undefined && supportsConfigurableSteps(config.model)) {
    form.set('steps', String(config.steps));
  }

  // Content-Typeは手動設定しない。FormDataをbodyに渡すとfetch/undiciがboundary付きの
  // multipart/form-dataヘッダーを自動生成するため、手動設定するとboundaryが欠落し壊れる。
  return fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiToken}` },
    body: form,
  });
}

async function callJson(endpoint: string, prompt: string, config: CloudflareInlineConfig): Promise<Response> {
  // flux-1-schnell等の旧世代モデル向け。width/height/steps/guidanceは実機未検証のため
  // 送らない（promptのみが実際に動作確認済みの形）。
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });
}

/**
 * Cloudflare Workers AI（text-to-image）で本文画像を1枚生成する。
 * モデル名に応じてmultipart/form-data（FLUX.2系）とJSON（flux-1-schnell等）を自動で切り替える。
 */
export async function generateInlineImage(
  prompt: string,
  config: CloudflareInlineConfig
): Promise<GeneratedImageBuffer> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;
  const useMultipart = requiresMultipart(config.model);

  return withRetry(
    async () => {
      const res = useMultipart ? await callMultipart(endpoint, prompt, config) : await callJson(endpoint, prompt, config);

      if (!res.ok) {
        const rawBody = await res.text();
        const detail = parseCloudflareErrorDetail(rawBody);
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
