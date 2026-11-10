/**
 * The shape of a record site (#1017 section 3; #1026). Each file in
 * `lib/research/sites/` exports one `defineSite({...})`: data only, with no
 * functions, so the list could move to JSON. `docs/research-sites.md` walks
 * through adding one.
 */

import type { SourceType } from '@/lib/db/queries/sources';
import type { FactKind } from '@/lib/research/fact-query';
import type { QueryValueKey } from '@/lib/research/query';
import type { Transform } from '@/lib/research/transforms';

/**
 * - `documented`: the parameters are in the site's own docs or official examples.
 * - `observed`: the parameters come from the site's own result URLs; undocumented, so they can change.
 * - `form`: the search is a form with no shareable URL; Open goes to the search page and the values are copied in.
 */
type SiteStatus = 'documented' | 'observed' | 'form';

/** A condition on the query, as data. Every listed part must hold. */
export interface Condition {
    /** The person's sex. */
    sex?: 'F' | 'M';
    /** Values that must all be present. */
    has?: QueryValueKey[];
}

/** One value a site receives: a query value or a fixed one, possibly limited and transformed. */
interface ValueSpec {
    /** A query value, or several joined by a space with the missing ones left out. */
    value?: QueryValueKey | QueryValueKey[];
    /** A fixed value, sent whenever the parameter applies. */
    const?: string;
    /** Only for these fact kinds. */
    kinds?: FactKind[];
    /** Only when the query meets this condition. */
    when?: Condition;
    /** The value's replacement, such as `{ F: 'Female' }`. A value with no entry is sent as it is. */
    map?: Record<string, string>;
    transform?: Transform | Transform[];
}

export interface SiteParam extends ValueSpec {
    param: string;
}

/** A form field's label, a message key under `research.fields`. */
export type FormFieldLabel =
    | 'type' | 'surname' | 'given_names' | 'spouse_surname' | 'start_year' | 'end_year'
    | 'year' | 'birth_year' | 'district' | 'county' | 'province';

interface FormField extends ValueSpec {
    label: FormFieldLabel;
}

interface LinkSearch {
    kind?: 'link';
    url: string;
    params: SiteParam[];
}

interface FormSearch {
    kind: 'form';
    /** The site's search page. */
    url: string;
    fields: FormField[];
}

/** A second search offered beside the first, such as "Mrs. Walter Ashby". */
interface Alternate {
    when: Condition;
    /** Parameters that replace or add to the main search's. The first one's value labels the row. */
    params: SiteParam[];
}

/** Each requirement has a reason, a message key under `research.reasons`. */
export type Requirement =
    /** A surname. */
    | 'surname'
    /** A given name or a surname. */
    | 'name'
    /** A first given name and a surname. */
    | 'fullName'
    /** The person's sex. */
    | 'sex';

export interface SiteDefinition {
    /** Lowercase letters only; also the message key `research.sites.<id>`. */
    id: string;
    /** The site's own name, not translated. */
    name: string;
    /** The repository a find is filed under. */
    repository: { name: string; website: string };
    factKinds: FactKind[];
    /** Region codes from `regions.ts` the site covers, or null for worldwide. */
    regions: string[] | null;
    status: SiteStatus;
    /** The date (YYYY-MM-DD) the link was last checked by hand. */
    verified: string;
    /** Where the parameters are documented or were observed. */
    docs: string;
    requires?: Requirement[];
    /** The collection's span; a search wholly outside it can't run. */
    years?: { min?: number; max?: number };
    search: LinkSearch | FormSearch;
    alternates?: Alternate[];
    /** Only what the site settles: a source title per fact kind, and a source type for every kind or per kind. */
    prefill?: {
        title?: Partial<Record<FactKind, string>>;
        type?: SourceType | Partial<Record<FactKind, SourceType>>;
    };
}

export function defineSite(site: SiteDefinition): SiteDefinition {
    return site;
}
