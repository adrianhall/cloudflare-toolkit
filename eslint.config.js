/**
 * @file ESLint flat config for @adrianhall/cloudflare-toolkit.
 *
 * Enforces full JSDoc on all public exports (anything exported from a barrel `index.ts` under
 * any subpath) via eslint-plugin-jsdoc, plus typescript-eslint's `recommendedTypeChecked` +
 * `stylisticTypeChecked`, plus `@typescript-eslint/no-deprecated`. Requires
 * `parserOptions.projectService` so type-aware rules can run.
 *
 * `test/node/**\/*.ts` and `test/workers/**\/*.ts` get the same type-checked ruleset (including
 * `@typescript-eslint/no-deprecated`, which is never relaxed) plus a narrow set of additional
 * relaxations for patterns that are idiomatic in test doubles rather than production code — see
 * that block below (ARCH-004, issue #122). `test/tsconfig.json` gives `parserOptions.projectService`
 * a project to resolve those files against, since the root `tsconfig.json`'s `include` is scoped
 * to `src/`.
 *
 * `test/package/**\/*.ts` is deliberately excluded from type-checked linting: those files import
 * `@adrianhall/cloudflare-toolkit/*` by its published subpaths, which `package.json#exports`
 * resolves to `dist/*` — an artifact that doesn't exist in a fresh checkout until `npm run build`
 * runs. `check:lint` (and the pre-commit hook, which runs `check:lint` without building) must
 * work without a build, so those files get the same non-type-checked ruleset as `*.config.*`
 * below instead of failing on unresolvable modules.
 */
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

const typeCheckedRules = {
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
};

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
    rules: typeCheckedRules
  },

  {
    files: ["test/node/**/*.ts", "test/workers/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    plugins: { jsdoc },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      ...typeCheckedRules,

      // These patterns are idiomatic in test doubles/fixtures rather than being genuine bugs,
      // so they're relaxed here rather than fixed at each call site (ARCH-004, issue #122):
      //  - stub objects implementing an interface's async methods without needing an internal
      //    `await` (e.g. a `FileSystem`/`WranglerRunner` fake);
      //  - accessing properties of `any`-typed values (e.g. a parsed JSON response body) in
      //    assertions;
      //  - empty-bodied stub methods (e.g. a minimal mock `ServerResponse`);
      //  - forwarding a `next(err?: unknown)`-style Connect callback error into
      //    `Promise.reject`, where `err` is untyped by the real middleware's own signature.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",

      // Leading-underscore params/vars/caught-errors are a deliberate "intentionally unused"
      // signal (e.g. a stub method matching an interface it doesn't need every parameter of).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ]
    }
  },

  {
    // See the file-level comment above for why this can't be type-checked like the block above.
    files: ["test/package/**/*.ts", "*.config.{js,mjs,ts}"],
    extends: [...tseslint.configs.recommended],
    plugins: { jsdoc },
    languageOptions: {
      sourceType: "module"
    }
  }
);
