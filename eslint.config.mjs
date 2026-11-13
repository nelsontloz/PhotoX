import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // config files sit outside every package tsconfig, so type-aware linting can't resolve them
      '**/vitest.config.ts',
      '**/vitest.*.config.ts',
      '**/vite.config.ts',
      'apps/web/test/browser/**',
      'e2e/.features-gen/**',
      'e2e/playwright-report/**',
      'e2e/test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
  {
    // Structure rules — the long form is docs/core-structure.md.
    // The data layer owns the schema and may not reach back into a feature: a helper that the
    // database bootstrap or an entity needs lives in common/ or shared-config, not in a module.
    // Feature-to-feature service imports stay allowed (the module graph is acyclic), but they must
    // go through an exported service, never another feature's repository or entity query.
    files: ['apps/core/src/database/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'admin',
                'albums',
                'assets',
                'auth',
                'backup',
                'detections',
                'embeddings',
                'faces',
                'ingest',
                'groups',
                'health',
                'maintenance',
                'persons',
                'places',
                'queue',
                'search',
                'settings',
                'shares',
                'storage',
                'uploads',
                'users',
                'worker',
              ].flatMap((feature) => [
                `../${feature}/*`,
                `../${feature}/**`,
                `../../${feature}/**`,
                `../../../${feature}/**`,
              ]),
              message: 'The data layer must not import feature code — move the helper to common/.',
            },
          ],
        },
      ],
    },
  },
);
