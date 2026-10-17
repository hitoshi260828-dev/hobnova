// publish_generated_image（MCP tool）向けの入力検証。
// base64画像データ自体の中身は信頼せず、ここで形式・サイズ・保存先pathを再検証する。

export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const MIME_TO_EXTENSION: Record<AllowedImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extensionForMimeType(mimeType: AllowedImageMimeType): string {
  return MIME_TO_EXTENSION[mimeType];
}

// OpenAI gpt-image-1等の実生成物は1〜3MB程度（このリポジトリの実測で最大2.8MB）。
// 将来の高解像度化や社内外からの投入を見込み、安全側に余裕を持たせた上限。
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

const CONTENT_DIRS = ['src/content/articles/', 'src/content/data-lab/', 'src/content/tools/', 'src/content/news/'] as const;

export interface ArticlePathValidation {
  valid: boolean;
  error?: string;
  slug?: string;
  /** マッチした許可ディレクトリ（例: 'src/content/articles/'）。validがtrueの時のみ設定。 */
  dir?: (typeof CONTENT_DIRS)[number];
}

/**
 * article_path が許可されたコレクション（articles/data-lab/tools/news）配下の .md/.mdx であり、
 * path traversal（`..`、絶対パス、null byte等）を含まないことを検証する。
 */
export function validateArticlePath(articlePath: unknown): ArticlePathValidation {
  if (typeof articlePath !== 'string' || articlePath.length === 0) {
    return { valid: false, error: 'article_path is required' };
  }
  if (articlePath.includes('\0')) {
    return { valid: false, error: 'invalid article_path' };
  }
  // 許可ディレクトリ配下の相対パスのみ受け付ける（絶対パス・ドライブレター・UNC・`..`を拒否）。
  if (
    articlePath.startsWith('/') ||
    articlePath.startsWith('\\') ||
    /^[a-zA-Z]:/.test(articlePath) ||
    articlePath.includes('..')
  ) {
    return { valid: false, error: 'invalid article_path' };
  }

  const dir = CONTENT_DIRS.find((d) => articlePath.startsWith(d));
  if (!dir) {
    return { valid: false, error: 'article_path must be under src/content/articles|data-lab|tools|news' };
  }

  const rest = articlePath.slice(dir.length);
  // サブディレクトリを許可しない（各コレクションはフラットな構成のため）。
  if (rest.length === 0 || rest.includes('/')) {
    return { valid: false, error: 'invalid article_path' };
  }

  const match = /^([a-z0-9][a-z0-9-]*)\.(md|mdx)$/.exec(rest);
  if (!match) {
    return { valid: false, error: 'article_path must be a flat .md or .mdx file with a lowercase-hyphen slug' };
  }

  return { valid: true, slug: match[1], dir };
}

export interface ImageInputValidation {
  valid: boolean;
  error?: string;
  bytes?: Uint8Array;
  extension?: string;
}

export interface ImageInputArgs {
  data?: unknown;
  mime_type?: unknown;
  // OpenAI MCP connectorの`_meta["openai/fileParams"]`経由で渡されるファイル参照形式。
  // ChatGPTが添付画像をBase64で手動シリアライズする代わりに、一時ダウンロードURLを
  // 発行してくる場合に使う（resolveImageInputが対応、validateImageInputは後方互換の
  // 生Base64専用経路として残す）。
  download_url?: unknown;
  file_id?: unknown;
  file_name?: unknown;
}

/**
 * base64画像データをデコードし、MIME typeとサイズを検証する。
 * `data`は生のbase64、または`data:image/png;base64,....`形式のdata URLのどちらも受け付ける
 * （ChatGPT側の「添付画像をツールへ送る」実装がどちらの形式を使うか断定できないため）。
 */
export function validateImageInput(image: ImageInputArgs | undefined): ImageInputValidation {
  if (!image || typeof image !== 'object') {
    return { valid: false, error: 'image is required' };
  }

  let mimeType = typeof image.mime_type === 'string' ? image.mime_type : undefined;
  let rawData = typeof image.data === 'string' ? image.data : undefined;

  if (!rawData) {
    return { valid: false, error: 'image.data is required' };
  }

  // data URL形式（data:image/png;base64,AAAA...）ならprefixからmime_typeを補完する。
  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/s.exec(rawData);
  if (dataUrlMatch) {
    mimeType = mimeType ?? dataUrlMatch[1];
    rawData = dataUrlMatch[2];
  }

  if (!mimeType || !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { valid: false, error: `unsupported mime_type: ${mimeType ?? 'unknown'}` };
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(rawData.replace(/\s/g, ''));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { valid: false, error: 'image.data is not valid base64' };
  }

  if (bytes.length === 0) {
    return { valid: false, error: 'image.data decoded to an empty file' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { valid: false, error: `image exceeds max size of ${MAX_IMAGE_BYTES} bytes` };
  }

  if (!matchesMagicBytes(bytes, mimeType as AllowedImageMimeType)) {
    return { valid: false, error: 'image bytes do not match declared mime_type' };
  }

  return { valid: true, bytes, extension: extensionForMimeType(mimeType as AllowedImageMimeType) };
}

// 宣言されたmime_typeと実際のファイル先頭バイト（マジックナンバー）が一致するか確認する。
// SVGなど想定外形式をPNG/JPEG/WebPと偽って送り込む攻撃を防ぐ最低限のチェック。
function matchesMagicBytes(bytes: Uint8Array, mimeType: AllowedImageMimeType): boolean {
  if (bytes.length < 12) return false;

  switch (mimeType) {
    case 'image/png':
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      // RIFF????WEBP
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

function inferMimeTypeFromBytes(bytes: Uint8Array): AllowedImageMimeType | null {
  for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
    if (matchesMagicBytes(bytes, mime)) return mime;
  }
  return null;
}

/**
 * image入力を解決する。`download_url`があれば（OpenAI MCP connectorの
 * `_meta["openai/fileParams"]`経由のファイル参照）サーバー側でfetchしてバイト列を取得する
 * ——ChatGPT（モデル）がBase64を手でシリアライズする必要がなくなり、「ダウンロード→
 * ローカル保存→Base64変換→再アップロード」をユーザーに要求しない構成になる。
 * `download_url`が無ければ既存のvalidateImageInput（生Base64）へフォールバックする。
 */
// download_url用のfetchタイムアウト。ChatGPTのファイルサーバーは通常高速に応答するはずだが、
// 攻撃者（有効なbearer tokenの保持者）が意図的に応答を引き延ばすハング攻撃を防ぐ。
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * response.bodyをストリーミングで読み、MAX_IMAGE_BYTESを超えた時点で即座に打ち切る。
 * content-lengthヘッダが無い・虚偽（実際より小さい値）であっても、response.arrayBuffer()で
 * 応答全体を無条件にバッファしてしまう（サイズ上限チェックがその後に来るため無意味になる）
 * 問題を避けるため、chunk単位でカウントしながら読む。
 */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
  controller: AbortController
): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (!response.body) {
    // bodyが無い環境（一部のテストダブル等）向けのフォールバック。実fetch()では通常発生しない。
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) return { error: `image exceeds max size of ${maxBytes} bytes` };
    return { bytes: new Uint8Array(buffer) };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        return { error: `image exceeds max size of ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } catch (err) {
    return { error: `failed to read download_url response: ${(err as Error).message}` };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export async function resolveImageInput(
  image: ImageInputArgs | undefined,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<ImageInputValidation> {
  if (!image || typeof image !== 'object') {
    return { valid: false, error: 'image is required' };
  }

  const downloadUrl = typeof image.download_url === 'string' && image.download_url.length > 0 ? image.download_url : undefined;
  if (!downloadUrl) {
    return validateImageInput(image);
  }

  // スキームをhttpsのみに制限する（defense-in-depth）。Cloudflare Workersのfetch()は
  // プライベートIP帯への直接アクセスを標準で拒否するとドキュメントされているが、これは
  // Cloudflare側のプラットフォーム動作であり本リポジトリのコードが保証するものではない
  // ため、こちら側でも最低限の制約（httpsのみ・file:等を拒否）を明示的に課す。
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return { valid: false, error: 'download_url is not a valid URL' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return { valid: false, error: 'download_url must use https' };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchFn(downloadUrl, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    return { valid: false, error: `failed to fetch download_url: ${(err as Error).message}` };
  }
  if (!response.ok) {
    clearTimeout(timeout);
    return { valid: false, error: `download_url returned HTTP ${response.status}` };
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
    clearTimeout(timeout);
    return { valid: false, error: `image exceeds max size of ${MAX_IMAGE_BYTES} bytes` };
  }

  const bodyResult = await readBodyWithCap(response, MAX_IMAGE_BYTES, controller);
  clearTimeout(timeout);
  if ('error' in bodyResult) {
    return { valid: false, error: bodyResult.error };
  }
  const bytes = bodyResult.bytes;
  if (bytes.length === 0) {
    return { valid: false, error: 'downloaded image is empty' };
  }

  const declaredMimeType =
    typeof image.mime_type === 'string' && (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(image.mime_type)
      ? (image.mime_type as AllowedImageMimeType)
      : undefined;
  const mimeType = declaredMimeType ?? inferMimeTypeFromBytes(bytes);
  if (!mimeType) {
    return { valid: false, error: 'could not determine a supported mime_type for the downloaded image' };
  }
  if (!matchesMagicBytes(bytes, mimeType)) {
    return { valid: false, error: 'image bytes do not match declared mime_type' };
  }

  return { valid: true, bytes, extension: extensionForMimeType(mimeType) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // 大きな配列を1回のString.fromCharCode(...bytes)へ渡すとスタック制限に当たりうるため分割する。
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
