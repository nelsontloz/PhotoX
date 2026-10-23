import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import tseslint from 'typescript-eslint'

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
)
