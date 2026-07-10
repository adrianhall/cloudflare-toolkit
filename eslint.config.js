// ESLint flat config for @adrianhall/cloudflare-toolkit.
//
// Repository rules (docs/SPECv2.md §8):
//   - Rule 2: full JSDoc on all public exports, enforced via eslint-plugin-jsdoc.
//     "Public" = anything exported from a barrel (index.ts) under any subpath.
//   - Rule 3: typescript-eslint recommendedTypeChecked + stylisticTypeChecked,
//     plus @typescript-eslint/no-deprecated (a "strict" rule, not part of
//     recommendedTypeChecked). Requires parserOptions.projectService so
//     type-aware rules can run.
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  { ignores: ["coverage/", "dist/", "node_modules/", ".husky/"] },

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

      // Scoped to exported function/class/interface/type declarations only
      // (docs/SPECv2.md §8 rule 2) — not every function/class in the file.
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
