import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const NO_ENUM = {
  selector: "TSEnumDeclaration",
  message: "Use a string literal union instead of an enum.",
};

const NO_CLASS = {
  selector: "ClassDeclaration, ClassExpression",
  message: "Functional. Use a function and a type.",
};

/**
 * `src/lib/tabulation/` is pure: it takes a `TabulationInput` and returns a `TabulationResult`, and
 * that is what makes a locked result reproduce a year later. `reproducibility.test.ts` does not
 * defend this on its own -- it replays a stored snapshot, so an impurity whose value happens not to
 * move the numbers (a clock read for a log line, a db lookup returning stable rows) passes it
 * silently. The boundary has to fail the build, or it is only a comment.
 */
const PURE = [
  {
    selector: "NewExpression[callee.name='Date']",
    message: "src/lib/tabulation must be pure -- no clock. Pass the value in on TabulationInput.",
  },
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: "src/lib/tabulation must be pure -- no clock. Pass the value in on TabulationInput.",
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: "src/lib/tabulation must be pure -- no randomness. A tie is broken by the rubric.",
  },
];

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "no-restricted-syntax": ["error", NO_ENUM, NO_CLASS],
    },
  },
  {
    files: ["src/lib/tabulation/**/*.ts"],
    ignores: ["src/lib/tabulation/__tests__/**"],
    rules: {
      // A later block *replaces* this rule rather than merging into it, so the shared selectors are
      // repeated here on purpose: drop them and the enum and class bans quietly stop applying to
      // exactly the directory that most needs them.
      "no-restricted-syntax": ["error", NO_ENUM, NO_CLASS, ...PURE],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "**/db", "**/db/*", "next", "next/*", "react", "react-dom"],
              message:
                "src/lib/tabulation must not reach the database or the framework. It takes a TabulationInput and returns a TabulationResult -- that is what makes a locked result replay.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
