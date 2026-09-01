// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.claude/worktrees/**'],
  },
  ...tseslint.configs.recommended,
);
