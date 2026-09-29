import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['.svelte-kit/**', 'build/**', 'coverage/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,js,svelte}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.svelte'],
    rules: {
      'svelte/no-at-html-tags': 'off'
    }
  }
);
