// What kind of place a place is (#45), read from GEDCOM's PLAC.FORM. FORM names each
// level of the place name in the same order ("City, County, State, Country"), so the
// leaf's kind is its first title, and a parent's is the title at its own position in
// any descendant's name. The words are the exporting app's own, shown as written.

/** A place name's levels, as import splits them: an empty level still counts. */
function levels(name: string): string[] {
    return name.trim().split(', ');
}

/** The FORM's titles, one per level of the name it describes. */
function titles(form: string): string[] {
    return form.split(',').map((t) => t.trim());
}

/**
 * The kind a place's own FORM gives it, or null. The FORM must have one title per
 * level of the name: a header default ("City, County, State, Country") applied to
 * "USA" would otherwise call a country a city.
 */
export function kindFromOwnForm(name: string, form: string | null | undefined): string | null {
    if (!form?.trim()) return null;
    const t = titles(form);
    return t.length === levels(name).length ? t[0] || null : null;
}

/**
 * The kind a descendant's FORM gives a place: "Minnesota, USA" inside
 * "Minneapolis, Hennepin, Minnesota, USA" with "City, County, State, Country" is a
 * State. Null unless the descendant's name ends with the place's and its FORM has one
 * title per level.
 */
export function kindFromDescendant(name: string, descendant: { name: string; form: string | null }): string | null {
    if (!descendant.form?.trim()) return null;
    const own = levels(name);
    const theirs = levels(descendant.name);
    if (theirs.length <= own.length) return null;
    if (!descendant.name.trim().toLowerCase().endsWith(`, ${name.trim().toLowerCase()}`)) return null;
    const t = titles(descendant.form);
    if (t.length !== theirs.length) return null;
    return t[theirs.length - own.length] || null;
}

/** A place's kind from its own FORM, else from the first descendant that names it. */
export function placeKindFromForms(
    name: string,
    form: string | null | undefined,
    descendants: ReadonlyArray<{ name: string; form: string | null }>,
): string | null {
    const own = kindFromOwnForm(name, form);
    if (own) return own;
    for (const d of descendants) {
        const kind = kindFromDescendant(name, d);
        if (kind) return kind;
    }
    return null;
}
