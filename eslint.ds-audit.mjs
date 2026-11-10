// Design-system audit config — opt-in via `npm run lint:ds`.
// Reports raw-hex color literals across `app/**` as warnings for periodic
// drift audits. NOT part of `npm run lint` / CI. The strict (error-level)
// version of this rule lives in eslint.config.mjs scoped to app/components/ui.
import eslintConfig from "./eslint.config.mjs";

const dsAuditConfig = [
  ...eslintConfig,
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Raw hex color — use a design-system token via a CSS class or var().",
        },
      ],
    },
  },
];

export default dsAuditConfig;
