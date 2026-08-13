import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist-extension/**",
      "dist-extension-firefox/**",
      "src/_locales/**",
      "src/images/**"
    ]
  },
  {
    ...js.configs.recommended,
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-console": "off"
    }
  }
];
