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
   ..compat.extends("next/core-web-vitals", "next/typescript"),
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
];

export default eslintConfig;
