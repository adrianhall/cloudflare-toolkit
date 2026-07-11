/**
 * @file ESLint flat config for @adrianhall/cloudflare-toolkit.
 *
 * Enforces full JSDoc on all public exports (anything exported from a barrel `index.ts` under
 * any subpath) via eslint-plugin-jsdoc, plus typescript-eslint's `recommendedTypeChecked` +
 * `stylisticTypeChecked`, plus `@typescript-eslint/no-deprecated`. Requires
 * `parserOptions.projectService` so type-aware rules can run.
 */
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  // docs/ has its own separate package.json/dependency tree (AGENTS.md) and is not linted by
  // the root config — without this, the bare "*.config.{js,mjs,ts}" files glob below would
  // match docs/.vitepress/config.ts at depth and lint it against a ruleset it was never
  // written for.
  { ignores: ["coverage/", "dist/", "node_modules/", ".husky/", "docs/"] },

  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    plugins: { jsdoc },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",

      // Scoped to exported function/class/interface/type declarations only — not every
      // function/class in the file.
      "jsdoc/require-jsdoc": [
        "error",
        {
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"],
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: false,
            MethodDefinition: false
          }
        }
      ],
      "jsdoc/require-description": "error",
      "jsdoc/check-param-names": "error"
    }
  },

  {
    files: ["*.config.{js,mjs,ts}"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      sourceType: "module"
    }
  }
);
