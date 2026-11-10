# Record sites for "Source this fact"

The citation sidebar's **Search records** tab turns a fact into a search on free record
sites (#1017). Each site is a link the person opens: Heirloom never fetches a results
page, calls a site API or scrapes. The site list is data, so adding or fixing a site is a
data edit, not a code change.

## Where things live

| File | What it holds |
|---|---|
| `lib/research/sites/<id>.ts` | One site: `export default defineSite({...})`. Data only, no functions. |
| `lib/research/sites/index.ts` | The list of sites, in the order the tab shows them. |
| `lib/research/query.ts` | The query vocabulary: the named values a parameter can send. |
| `lib/research/transforms.ts` | The named transforms a parameter can apply. |
| `lib/research/regions.ts` | Countries, their aliases and provinces, as region codes. |
| `lib/research/site.ts` | The `defineSite` shape, with a comment on every field. |
| `messages/{en,fr,ru}.json` | `research.sites.<id>.coverage`, `.searches` and `.note`. |
| `__tests__/unit/research-sites.test.ts` | Checks every site, and snapshots each site's link for a fixed set of facts. |

## Adding a site

1. **Write the site file**, `lib/research/sites/<id>.ts`. The id is lowercase letters only.
   Copy the closest existing site and change it:

   ```ts
   import { defineSite } from '@/lib/research/site';

   export default defineSite({
       id: 'examplearchive',
       name: 'Example Archive',              // the site's own name, not translated
       repository: { name: 'Example Archive', website: 'https://www.example.org' },
       factKinds: ['birth', 'marriage', 'death'],
       regions: ['GB-SCT'],                  // or null for a worldwide site
       status: 'observed',                   // see "Statuses" below
       verified: '2026-10-04',               // the day you opened the link by hand
       docs: 'https://www.example.org/search-help',
       requires: ['surname'],
       years: { min: 1855 },                 // the collection's span
       search: {
           url: 'https://www.example.org/search',
           params: [
               { param: 'surname', value: 'surname' },
               { param: 'forename', value: 'givenFirst' },
               { param: 'from', value: 'event.yearFrom', transform: { name: 'clampYear', min: 1855 } },
               { param: 'to', value: 'event.yearTo' },
               { param: 'type', const: 'B', kinds: ['birth'] },
           ],
       },
       prefill: { type: 'Vital' },
   });
   ```

2. **Add one line** to `lib/research/sites/index.ts`: the import and its place in `SITES`.

3. **Add three message strings** under `research.sites.<id>` in `en`, `fr` and `ru`:
   - `coverage`: what the site holds ("Scottish civil registration, from 1855").
   - `searches`: what it searches for this fact. It can vary by fact kind with ICU
     `select` on `kind`: `"{kind, select, birth {Birth index} other {Death index}}"`.
   - `note`: one short line, such as "Free, no account".

   A proper noun after the first word (a country, an institution) may need adding to
   `__tests__/unit/messages-sentence-case.test.ts`.

4. **Add any new country or province** to `lib/research/regions.ts`. A region code is ISO
   3166: `IE`, a UK nation as `GB-SCT`, a province as `CA-NS`. List the names a place may
   end with; matching ignores case, accents and dots, so `U.S.A.` matches `USA`.

5. **Update the snapshots**: `npx vitest run __tests__/unit/research-sites.test.ts -u`.
   Read the diff: your site should appear for the fixture facts in its region and kinds,
   and nowhere else. If no fixture covers it, add one to `FIXTURES` in the test.

6. **Open every new link by hand** in a browser (several sites block automated fetches),
   check that the site's search shows the details you sent, and record the date in
   `verified`.

## How a parameter is built

Each entry in `params` (or a form's `fields`) sends one value:

- `value`: a key from the query vocabulary, or a list of keys joined by a space with the
  missing ones left out (`['fullNamePhrase', 'event.locality']`).
- `const`: a fixed value instead, such as `dl: 'page'`.
- `kinds`: send it only for these fact kinds.
- `when`: send it only when the query meets a condition, such as `{ sex: 'F' }` or
  `{ has: ['spouse.surname'] }`.
- `map`: replace a value, such as `{ F: 'Female', M: 'Male' }`.
- `transform`: one named transform, or a list applied in order.

An empty value is never sent, so a detail the person removed stays out of every link.

The vocabulary (`lib/research/query.ts`) is: `given`, `givenFirst`, `givenMiddle`, `surname`,
`fullName`, `fullNamePhrase` (`"givenFirst surname"` in quotes), `sex` (`F` or `M`); the fact's
`event.yearFrom|yearTo|yearMid|yearHalfSpan|yearRange|decade` and
`event.place|locality|county|state|country`; the same year keys under `birth.*` and `death.*`
for the person's own birth and death; and `spouse.given|givenFirst|surname`.

The transforms are `upper`, `isoYearStart`, `isoYearEnd`, `clampYear`, `roundToSteps`,
`stripPrefix` (a leading word) and `format` (a `{value}` template). A site that needs another
adds it to `transforms.ts`, with a test.

**Requirements.** `requires` lists what a search can't run without: `surname`, `name` (a given
name or surname), `fullName` (first given name and surname) or `sex`. `years` is the
collection's span. When either fails, the row shows the reason and Open is disabled.

**Alternates** add a second search, such as Chronicling America's "Mrs. Walter Ashby". Each has
a `when` condition and `params` that replace or add to the main ones; the first param's value
labels the row.

**Prefill** sets only what the site settles. Today that's FreeBMD's title (it transcribes only
the GRO indexes), and the source type for sites that hold one kind of record. Everything else
starts blank.

## Statuses

| Status | Meaning |
|---|---|
| `documented` | The parameters appear in the site's own docs or official example URLs. `docs` links to them. |
| `observed` | The parameters come from URLs the site's own search produces. They're undocumented and can change without notice, so re-check the link when a search looks wrong. `docs` links to the search page. |
| `form` | The search is a form with no shareable URL. Open goes to the search page, and the tab shows the values with copy buttons. Heirloom never posts the form: the desktop CSP allows `form-action 'self'` only. |

A broken `observed` link should still land on the site's search page, so the person loses
the prefilled details but not the search. If a site's link stops working altogether, change it
to `form` or remove it.
