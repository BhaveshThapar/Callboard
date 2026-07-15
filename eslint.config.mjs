import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

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
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a string literal union instead of an enum.",
        },
      ],
    },
  },
  {
    // `src/lib/tabulation/` is pure: it takes a `TabulationInput` and returns a `TabulationResult`,
    // and that is what lets a locked run reproduce a year later from its own frozen row. Until now
    // the rule was prose in CLAUDE.md -- `import { db } from "@/db"` here passed lint and typecheck,
    // and `reproducibility.test.ts` only catches an impurity that happens to change the result.
    files: ["src/lib/tabulation/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "**/db/*", "drizzle-orm", "drizzle-orm/*"],
              message:
                "src/lib/tabulation/ is pure. It takes a TabulationInput and returns a TabulationResult; reading the database here is what makes a locked result unreproducible.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a string literal union instead of an enum.",
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "src/lib/tabulation/ is pure. Pass the time in on TabulationInput instead.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "src/lib/tabulation/ is pure. Pass the time in on TabulationInput instead.",
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "src/lib/tabulation/ is pure. A tabulation that cannot be replayed is not a result.",
        },
      ],
    },
  },
];

export default config;
