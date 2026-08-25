// eslint-config-next@16 ships native flat config (an array, not a named
// classic-shareable-config string), so FlatCompat.extends("next/core-web-vitals")
// no longer applies — it fed the array through the legacy schema validator, which
// choked on the plugin objects with a circular-JSON crash. Spread the array directly.
import nextConfig from "eslint-config-next/core-web-vitals";

// Firebase is reachable ONLY through a dynamic `import()`, behind the configured/auth gate.
// A single static import puts the SDK in the initial bundle of every route that transitively
// reaches the module, which breaks the local-first default with a green build and no failing
// test — the rule was prose in four module headers (core/ports.ts, lib/firebase-remote.ts,
// core/sync/outbox.ts, each *-remote.ts) and held only because every author remembered.
//
// No allowlist is needed for the modules that legitimately use firebase: the rule only has
// ImportDeclaration / Export*Declaration / TSImportEquals listeners, so `await import('firebase/x')`
// and the inline `import('firebase/x').Type` annotation are invisible to it by construction.
// `allowTypeImports` covers `import type {...} from 'firebase/x'`, which erases at compile time;
// a value-syntax import used only as a type still errors, which is correct — that is the form
// whose elision depends on compiler settings.
//
// Shared, and spliced into the core/ blocks below rather than added as a new block: flat config
// REPLACES a rule's options when a later block sets the same rule name, so a separate firebase
// block matching core/** would silently switch the D-099 boundary off.
const NO_STATIC_FIREBASE = {
  group: ["firebase", "firebase/*", "firebase/**", "@firebase/*", "@firebase/**"],
  allowTypeImports: true,
  message:
    "firebase may only be reached through a dynamic `await import('firebase/...')` behind the configured gate. A static import lands the SDK in the first-load bundle. Use `import type` for types.",
};

// Companion to NO_STATIC_FIREBASE, same reasoning (#272): each `lib/*-remote.ts` is only ever
// meant to be reached via a dynamic `import('@/lib/*-remote')` behind isRemoteConfigured() /
// isTripRemoteConfigured(), so firebase-touching code stays off the first-load path. The
// `*-remote.ts` files themselves import each other (e.g. `./firebase-remote`) via RELATIVE
// specifiers, which this alias-only glob deliberately does not match — that internal composition
// already sits behind the dynamic-import boundary and isn't the violation this rule targets.
const NO_STATIC_REMOTE = {
  group: ["@/lib/*-remote"],
  allowTypeImports: true,
  message:
    "*-remote modules may only be reached through a dynamic `await import('@/lib/*-remote')` behind the isRemoteConfigured()/isTripRemoteConfigured() gate. A static import lands firebase-touching code in the first-load bundle. Use `import type` for types.",
};

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
  ...nextConfig,
  {
    rules: {
      // Escaping every ' and " in JSX copy is pure churn — React renders them
      // correctly and the literal text is more legible than HTML entities.
      "react/no-unescaped-entities": "off",

      // eslint-plugin-react-hooks v7 (pulled in by the eslint-config-next@16 bump)
      // expanded "recommended" from 2 rules to 16: React Compiler readiness
      // diagnostics, most set to "error". Four of them fire 91 times across ~20
      // files on patterns this codebase uses throughout on purpose — the
      // SSR-safe `useEffect(() => setMounted(true), [])` hydration idiom,
      // stable-callback refs assigned during render, and a `Date.now()` read in
      // a presence hook. Fixing those means restructuring hook usage repo-wide
      // for React Compiler compatibility, which nothing here opts into — that's
      // a separate initiative, not a lint-version bump. Off until that's scoped;
      // everything else in the new recommended set (static-components,
      // preserve-manual-memoization, error-boundaries, etc.) stays on and is
      // clean today.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
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
            NO_STATIC_FIREBASE,
          ],
        },
      ],
    },
  },
  {
    // The one remaining exception, and it is narrow rather than blanket: `outbox.ts` needs the two
    // app-wide "should I write?" gates, which have no core-side home yet. The rule stays ON here —
    // only those two modules are negated out of the group — so a NEW lib/ import in this file still
    // errors. Nothing may be added to the negation list without a decision.
    files: ["core/sync/outbox.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/*",
                "@/lib/**",
                "!@/lib/firebase-config",
                "!@/lib/token-auth",
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
            NO_STATIC_FIREBASE,
          ],
        },
      ],
    },
  },
  {
    // The app layers. `core/` gets the same pattern spliced into its blocks above, since it
    // already sets this rule. Vitest files are excluded: they static-import `firebase/firestore`
    // to build the module mock, and never reach a bundle.
    files: ["app/**", "components/**", "hooks/**", "lib/**"],
    ignores: ["**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [NO_STATIC_FIREBASE, NO_STATIC_REMOTE] },
      ],
    },
  },
];

export default eslintConfig;
