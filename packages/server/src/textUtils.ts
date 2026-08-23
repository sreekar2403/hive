// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Strips terminal color/formatting escape codes from CLI output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
