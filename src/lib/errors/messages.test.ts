import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_MESSAGES, userFacingMessage } from './messages';

describe('userFacingMessage', () => {
  it.each(Object.entries(USER_MESSAGES))('maps %s to its user-facing message', (code, message) => {
    expect(userFacingMessage(code)).toBe(message);
  });

  it('uses the fallback for missing and unknown codes', () => {
    expect(userFacingMessage(undefined)).toBe(USER_MESSAGES.UNKNOWN_ERROR);
    expect(userFacingMessage('UNRECOGNIZED_CODE')).toBe(USER_MESSAGES.UNKNOWN_ERROR);
    expect(userFacingMessage(undefined, 'Connection lost.')).toBe('Connection lost.');
  });

  it('does not interpolate WebSocket payload messages into Svelte templates', async () => {
    const srcDirectory = resolve(process.cwd(), 'src');

    async function svelteFiles(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (entry) => {
          const path = `${directory}/${entry.name}`;
          if (entry.isDirectory()) return svelteFiles(path);
          return entry.name.endsWith('.svelte') ? [path] : [];
        })
      );
      return nested.flat();
    }

    const files = await svelteFiles(srcDirectory);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const template = source.slice(source.indexOf('</script>') + '</script>'.length);
      expect(template, file).not.toMatch(/\{[^{}]*\bpayload\??\.message\b[^{}]*\}/);
    }
  });
});
