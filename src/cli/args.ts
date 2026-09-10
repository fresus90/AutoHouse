/** Sehr kleiner Parser fuer --key value / --flag Argumente. */
export interface ParsedArgs {
  /** Alle benannten Argumente; reine Schalter stehen auf "true". */
  values: Record<string, string>;
  /** Alles, was ohne Schluessel uebergeben wurde. */
  rest: string[];
  get(key: string, alias?: string): string | undefined;
  flag(key: string): boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    const isLong = token.startsWith('--');
    const isShort = !isLong && token.startsWith('-') && token.length === 2;
    if (!isLong && !isShort) {
      rest.push(token);
      continue;
    }
    const key = isLong ? token.slice(2) : token.slice(1);
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      values[key] = next;
      i += 1;
    } else {
      values[key] = 'true';
    }
  }

  return {
    values,
    rest,
    get: (key, alias) => values[key] ?? (alias ? values[alias] : undefined),
    flag: (key) => values[key] === 'true',
  };
}
