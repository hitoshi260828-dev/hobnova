import fs from 'node:fs';
import path from 'node:path';

// 将来的に ChatGPT -> base64 -> GitHub blob という経路を追加する際、ここに
// 'base64' | 'remote' 等のkindを増やすだけで済むようにする（import-image.ts側の
// 呼び出しコードは変更不要）。
export type ImageSourceKind = 'local-file';

export interface ImageSource {
  kind: ImageSourceKind;
  path: string;
}

export interface ResolvedImage {
  buffer: Buffer;
  /** 拡張子（ドットなし、小文字） */
  ext: string;
}

export const SUPPORTED_IMPORT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'] as const;

export function createLocalFileSource(filePath: string): ImageSource {
  return { kind: 'local-file', path: filePath };
}

/**
 * 画像ソースから実体（バイト列＋拡張子）を取得する。現状はローカルファイルのみ対応。
 * 入力画像は再圧縮・再エンコードせず、そのままのバイト列を返す（最適化処理を入れる
 * 場合は呼び出し側 import-image.ts に別処理として追加し、ここは変更しない）。
 */
export async function resolveImageSource(source: ImageSource): Promise<ResolvedImage> {
  switch (source.kind) {
    case 'local-file': {
      const absolutePath = path.resolve(process.cwd(), source.path);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Image file not found: ${absolutePath}`);
      }
      const ext = path.extname(absolutePath).slice(1).toLowerCase();
      if (!(SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(
          `Unsupported image extension: .${ext} (supported: ${SUPPORTED_IMPORT_EXTENSIONS.join(', ')})`
        );
      }
      const buffer = fs.readFileSync(absolutePath);
      return { buffer, ext };
    }
    default: {
      const exhaustiveCheck: never = source.kind;
      throw new Error(`Unsupported image source kind: ${exhaustiveCheck}`);
    }
  }
}
