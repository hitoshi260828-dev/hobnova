import type { CliOptions } from './types';

export function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const flags = new Set<string>();

  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg.slice(2));
    else positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error('使い方: npm run images:generate -- path/to/article.md [--dry-run] [--force] [--cover-only] [--inline-only]');
  }

  const coverOnly = flags.has('cover-only');
  const inlineOnly = flags.has('inline-only');
  if (coverOnly && inlineOnly) {
    throw new Error('--cover-only と --inline-only は同時に指定できません');
  }

  return {
    articlePath: positional[0],
    force: flags.has('force'),
    coverOnly,
    inlineOnly,
    dryRun: flags.has('dry-run'),
  };
}
