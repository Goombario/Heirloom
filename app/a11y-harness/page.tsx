import { notFound } from 'next/navigation';
import A11yHarnessContent from './A11yHarnessContent';

/**
 * Dev/test-only route. Renders the inline edit-mode surfaces (person: hero
 * identity editor, names panel, relationship list + add panel; family: hero
 * editor, marriage editor, children list) with static fixture
 * props so `scripts/a11y-contrast-scan.mjs` can run axe-core's color-contrast
 * rule over them without a database or seeded data. It exists purely to give
 * the contrast scan reach into surfaces the fixed `ROUTES` list can't hit
 * (edit mode isn't a distinct URL — it's client state on `/people/view`).
 *
 * Not linked from any nav and 404s outside development (`next build` runs
 * with NODE_ENV=production for both the hosted server and the static
 * Cloudflare/Tauri build) — only `npm run dev` / `npm run dev:static`
 * (NODE_ENV=development) serve it.
 */
export default function Page() {
    if (process.env.NODE_ENV === 'production') {
        notFound();
    }
    return <A11yHarnessContent />;
}
