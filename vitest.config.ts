import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: [
        'src/lib/**/*.d.ts',
        'src/lib/api/**', // API stubs are implemented in D2.
        'src/lib/types/**', // Type declarations have no runtime behavior.
        'src/lib/utils/**', // Utility stubs have no testable logic yet.
        'src/routes/**', // D1 route placeholders have no implemented behavior.
        'src/lib/index.ts' // Barrel file only re-exports modules.
      ],
      thresholds: {
        // TODO(D2): raise to 70 once auth, lobby, and game views are implemented.
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    }
  },
  resolve: {
    conditions: ['browser']
  }
});
