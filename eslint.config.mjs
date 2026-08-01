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
 * A directory whose output must be a function of its input alone: no database, no clock, no
 * randomness. Two of these exist and both are load-bearing — `src/lib/tabulation/`, so a locked run
 * reproduces a year later from its own frozen row, and `src/lib/fees/schedule.ts`, so what a team
 * owes is a function of the schedule and the roster rather than of the day it was asked.
 *
 * This is a helper rather than two hand-written blocks because of a flat-config footgun: a later
 * `no-restricted-syntax` entry *replaces* an earlier one instead of merging into it, so the shared
 * selectors have to be re-declared inside every zone. Written twice by hand, the second copy is one
 * refactor away from silently losing the enum and class bans. Written once here, it cannot.
 */
const pureZone = (files, why) => ({
  files,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/db", "@/db/*", "**/db/*", "drizzle-orm", "drizzle-orm/*"],
            message: why,
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      NO_ENUM,
      NO_CLASS,
      {
        selector: "MemberExpression[object.name='Date'][property.name='now']",
        message: `${why} Pass the time in as an input instead.`,
      },
      {
        selector: "NewExpression[callee.name='Date']",
        message: `${why} Pass the time in as an input instead.`,
      },
      {
        selector: "MemberExpression[object.name='Math'][property.name='random']",
        message: why,
      },
    ],
  },
});

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
  pureZone(
    ["src/lib/tabulation/**/*.ts"],
    "src/lib/tabulation/ is pure. It takes a TabulationInput and returns a TabulationResult; reading the world here is what makes a locked result unreproducible.",
  ),
  pureZone(
    ["src/lib/fees/**/*.ts"],
    "src/lib/fees/ is pure. What a team owes must be a function of the schedule and the roster; reading the world here makes a bill unexplainable to the treasurer holding it.",
  ),
];

export default config;
