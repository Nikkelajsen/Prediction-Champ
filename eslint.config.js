// ESLint flat config. Kører i CI (.github/workflows/ci.yml) sammen med testene.
//
// Projektet er utypet JS/JSX, så linteren er det eneste statiske sikkerhedsnet.
// Opsætningen vægter derfor de regler, der fanger FEJL — formatering er Prettiers
// job, og `eslint-config-prettier` slår til sidst alle stilregler fra, så de to
// aldrig strides om samme linje.
//
// Fejl vs. advarsel: `error` er reserveret til det, der kan rettes uden at ændre
// adfærd. De React-Compiler-regler, der kræver en gennemtænkt omskrivning, står
// som `warn` og er i stedet fastlåst med `--max-warnings` i `npm run lint`, så
// antallet kan falde, men aldrig vokse ubemærket.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["dist/**", "node_modules/**"] },

  js.configs.recommended,

  {
    rules: {
      // Fire-and-forget-fangst er et bevidst mønster her (fx `logEvent`, som pr.
      // kontrakt aldrig må kaste — src/lib/analytics.js). Tom catch er derfor
      // tilladt; alt ANDET tomt blokstykke er stadig en fejl.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // `const { feltet, ...resten } = x` er den normale måde at udelade ét felt
      // på — søskende til en rest-property er altså med vilje ubrugte.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },

  // Frontend: browser + JSX.
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,

      // De fire nedenfor er reelle fund, men hver enkelt kræver en omskrivning,
      // ikke en rettelse — de hører til fil-opdelingen (punkt 2), ikke til
      // opsætningen af linteren. Se DOCUMENTATION.md afsnit 12.
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },

  // Vercel-funktionerne kører i Node, ikke i browseren.
  {
    files: ["api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },

  // Service workeren har hverken window eller Node — sit eget globale miljø.
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: globals.serviceworker,
    },
  },

  // Konfigurationsfiler i roden køres af Node.
  {
    files: ["*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },

  prettier,
];
