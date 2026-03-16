import js from "@eslint/js"
import ts from "typescript-eslint"
import svelte from "eslint-plugin-svelte"
import prettier from "eslint-config-prettier"
import globals from "globals"

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  prettier,
  ...svelte.configs["flat/prettier"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    ignores: ["build/", "dist/", "*.svg"],
  },
  {
    rules: {
      eqeqeq: "error",
      "a11y-click-events-have-key-events": "off",
      "a11y-autofocus": "off",
      "no-constant-condition": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
      "no-extra-semi": "off",
      "no-async-promise-executor": "off",
      "prefer-const": ["error", {destructuring: "all"}],
      // Enforce use of src/util/logger instead of console directly.
      // VITE_LOG_LEVEL is only respected when going through the logger.
      "no-console": "warn",
      // Prefer importing from "src/app/util" (the barrel) or the new
      // "src/app/util/navigation" file rather than the deprecated barrel router.ts.
      // This rule nudges new code in the right direction without breaking existing imports.
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "src/app/util/router",
              message:
                "Prefer 'src/app/util/navigation' or 'src/app/util' to avoid confusion with the base routing engine (src/util/router).",
            },
          ],
        },
      ],
      "svelte/valid-compile": "off",
      "svelte/no-at-html-tags": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extra-semi": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {args: "none", destructuredArrayIgnorePattern: "^_d?$", caughtErrors: "none"},
      ],
    },
  },
  // The logger itself must call console — allow it there only
  {
    files: ["src/util/logger.ts"],
    rules: {"no-console": "off"},
  },
]
