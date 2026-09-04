// Static checking for the ROOT `scripts/` harness (issue #424).
//
// These three files had none. `eslint .` runs with `working-directory: trip`, and ESLint refuses
// to lint outside its base path, so the 584-line ruleset harness — the only thing standing
// between an anonymous user and every trip document — got zero static checking. Two of the three
// are at least exercised functionally (`rules-check.mjs` runs against a real emulator with
// negative controls, `release-gate.mjs` runs twice per release and has a unit test);
// `release-notes.mjs` is genuinely uncovered, and its one call site is `continue-on-error: true`,
// so a crash there is silent on the deploy path too.
//
// DELIBERATELY ITS OWN CONFIG, not an entry in trip's. These files must NOT join the app's
// project graph — `rules-check.mjs` stays out of it on purpose — so this config declares the
// Node globals itself rather than pulling in a shared preset or the `globals` package (there is
// no root `package.json` to install one into).
//
// TWO RULES, on purpose. The goal is the typo class — a misspelled identifier, an unused binding
// left behind by an edit — not style. Anything broader would need the app's config and would
// start failing on formatting nobody has agreed for these files.
export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
