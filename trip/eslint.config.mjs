import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    // Generated output, deps, and Playwright artifacts are not source.
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "graphify-out/**",
      "public/sw.js",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Escaping every ' and " in JSX copy is pure churn — React renders them
      // correctly and the literal text is more legible than HTML entities.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // CommonJS config files legitimately use require() (Next/Tailwind read them as CJS).
    files: ["**/*.config.{js,ts,mjs}", "next.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Playwright fixtures call `use()` for fixture injection — not React's use() hook;
    // the react-hooks heuristic misfires on it. These files are not React.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // Tests deliberately pass `children` as a prop to exercise render code paths.
    files: ["**/__tests__/**"],
    rules: { "react/no-children-prop": "off" },
  },
  {
    // D-099 (LOCKED, reaffirmed by D-109): the arrows point inward. `core/` is the framework-free
    // domain layer and must not reach back into the app layers at RUNTIME. `import type` is erased
    // at build time and carries no dependency, so it stays allowed — that is the whole distinction
    // this rule exists to draw, and without it the rule is prose every new slice has to remember.
    files: ["core/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/*",
                "@/lib/**",
                "@/hooks/*",
                "@/hooks/**",
                "@/components/*",
                "@/components/**",
                "@/app/*",
                "@/app/**",
              ],
              allowTypeImports: true,
              message:
                "core/ may not import lib/, hooks/, components/ or app/ at runtime (D-099). Use `import type`, or move the value into core/.",
            },
          ],
        },
      ],
    },
  },
  {
    // The two known exceptions, both open. `backup.ts` is the whole-trip backup composition root —
    // an application-layer job that belongs in lib/, and its move is held up by its importers.
    // `outbox.ts` needs a "should I write?" gate that has no core-side home yet. Drop a path here
    // the moment its file stops needing it; nothing else may be added without a decision.
    files: ["core/vault/backup.ts", "core/sync/outbox.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
];

export default eslintConfig;
