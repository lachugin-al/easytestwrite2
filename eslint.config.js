// eslint.config.ts
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  // игнор
  { ignores: ["node_modules", "dist", "build", "eslint.config.ts"] },

  // JS
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },

  // TS базовый пресет (parser+plugin+rules)
  ...tseslint.configs.recommended,

  // Общие твики под проект
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Больные места — ослабляем, чтобы не стопорить разработку
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-expressions": "off",

      // Поддержим соглашение: переменные/аргументы, начинающиеся с _ — можно не использовать
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],

      // Мягкие подсказки вместо стоп-ошибок
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },

  // Тесты: vitest globals
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.vitest, ...globals.node },
    },
  },
];