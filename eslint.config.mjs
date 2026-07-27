/**
 * ESLint flat config.
 *
 * Next 16 removed `next lint`, so ESLint is wired up directly here and run by
 * the `lint` script rather than through the Next CLI. `eslint-config-next`
 * ships native flat configs as of 16, so no `FlatCompat` shim is needed.
 *
 * The intent is a lint that catches real mistakes rather than one that
 * relitigates style: `core-web-vitals` for the Next/React correctness rules
 * (hook dependencies, image and script usage, client/server boundaries) and
 * `typescript` for the TS rules that TypeScript itself does not enforce.
 * Formatting is left alone entirely.
 */

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "src-tauri/target/**",
      "packages/**/dist/**",
      "public/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      /**
       * The codebase already marks a deliberately discarded binding with a
       * leading underscore, most often to drop a field out of an object while
       * spreading the rest. Honour that convention rather than reporting the
       * discards it was invented to declare.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      /**
       * The three React Compiler rules below ship as errors in
       * eslint-plugin-react-hooks 6 and each one flags a pattern that predates
       * this config by a long way: refs read during render in the editor and
       * the onboarding flow, effects that set state synchronously in the
       * settings and short-form views, and a module-scope variable reassigned
       * during render in the short-form feed. They are fair warnings and worth
       * acting on, but every fix is a behaviour change in code that currently
       * works, which is a separate piece of work from getting the suite and the
       * linter running. They stay on as warnings so they remain visible and so
       * new occurrences show up in review, rather than being switched off.
       */
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
];
