/**
 * @file An internal helper for the logging subpath — not exported from
 * `src/lib/logging/index.ts`.
 *
 * `sanitizeTerminalText()` neutralizes terminal-injection risk (SEC-007) in strings that are
 * about to be written to a real terminal by `createConsoleTransport()`. `record.message` is
 * caller-supplied and may embed attacker-controlled data (e.g. an email address or path). Left
 * unescaped, it could contain newlines that forge fake log lines, or ANSI escape sequences
 * (`\x1b...`) that manipulate the terminal (colors, cursor movement, title changes) when the
 * output is later viewed through a real terminal such as `wrangler tail`.
 *
 * `record.context` does not need the same treatment: `createConsoleTransport()` always renders
 * it via `safeStringify()` (`JSON.stringify` under the hood), which already escapes every C0
 * control character — including `\x1b` — as `\uXXXX` per the JSON spec.
 */

/**
 * Control characters (C0: `\x00`-`\x1f`, plus DEL `\x7f`) that could forge terminal output or
 * trigger ANSI escape sequences. Every terminal escape sequence begins with `\x1b` (ESC), so
 * escaping it alone is sufficient to neutralize ANSI injection; the rest of the range is
 * escaped defensively for the same reason.
 */
const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/g;

/** Readable escape sequences for the most common control characters. */
const NAMED_ESCAPES: Readonly<Record<string, string>> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t"
};

/**
 * Replace every C0 control character and DEL in `value` with a visible, non-executable escape
 * sequence.
 *
 * Common whitespace controls (`\n`, `\r`, `\t`) are rendered as their familiar backslash
 * escapes; every other control character (including ESC, `\x1b`) is rendered as a two-digit hex
 * escape (`\xHH`). This preserves the original information for debugging while preventing the
 * string from forging additional log lines or executing terminal escape sequences.
 *
 * @param value - The raw string to sanitize before writing it to a terminal.
 * @returns `value` with every control character replaced by a visible escape sequence.
 */
export function sanitizeTerminalText(value: string): string {
  return value.replace(CONTROL_CHAR_PATTERN, (char) => {
    const named = NAMED_ESCAPES[char];
    if (named !== undefined) {
      return named;
    }
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}
