import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'prisma/migrations'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tool/*.cjs'],
    languageOptions: {
      globals: { require: 'readonly', process: 'readonly', console: 'readonly', URL: 'readonly' }
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  }
);
