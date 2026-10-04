export interface ImportCliOptions {
  articlePath: string;
  imagePath: string;
  type: 'cover' | 'inline';
  afterHeading?: string;
  position?: number;
  alt?: string;
  copyOnly: boolean;
  dryRun: boolean;
  force: boolean;
}

const BOOLEAN_FLAGS = new Set(['copy-only', 'dry-run', 'force']);

const USAGE =
  '使い方: npm run images:import -- --article <path> --image <path> --type <cover|inline> ' +
  '[--after-heading <見出し>] [--position <N>] [--alt <text>] [--copy-only] [--dry-run] [--force]';

export function parseImportArgs(argv: string[]): ImportCliOptions {
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`不明な引数です: "${arg}"\n${USAGE}`);
    }
    const key = arg.slice(2);

    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`--${key} には値が必要です\n${USAGE}`);
    }
    values[key] = next;
    i++;
  }

  if (!values.article) throw new Error(`--article は必須です\n${USAGE}`);
  if (!values.image) throw new Error(`--image は必須です\n${USAGE}`);
  if (values.type !== 'cover' && values.type !== 'inline') {
    throw new Error(`--type は cover または inline を指定してください\n${USAGE}`);
  }

  let position: number | undefined;
  if (values.position !== undefined) {
    const parsed = Number.parseInt(values.position, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== values.position.trim()) {
      throw new Error(`--position は1以上の整数で指定してください: "${values.position}"`);
    }
    position = parsed;
  }

  if (values.type === 'inline' && !values['after-heading'] && position === undefined) {
    throw new Error('--type inline の場合、--after-heading または --position のいずれかが必須です');
  }

  return {
    articlePath: values.article,
    imagePath: values.image,
    type: values.type,
    afterHeading: values['after-heading'],
    position,
    alt: values.alt,
    copyOnly: flags.has('copy-only'),
    dryRun: flags.has('dry-run'),
    force: flags.has('force'),
  };
}
