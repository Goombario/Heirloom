# Voice & Microcopy

> Status: **Stub** — fill before Phase 1 (any user-facing string changes).
>
> Covers: tone, citation labels, error messages, empty-state strings, button labels, confirmation dialogs.

---

## 1. Tone

**Warm-academic.** Matter-of-fact, faintly literary, never patronizing.

- Address the user as *you*
- Past tense for historical events ("Eleanor was born in Glasgow")
- Present tense for system state ("3 children listed below", "No sources yet")
- Never say "individual" — say "person"
- "Unknown" is a valid, honest value — don't hide it or soften it to "not provided"
- Precision is earned — "abt. 1882" and "?" are fine

---

## 2. UI Labels (standard)

| Context | Label |
|---|---|
| Primary nav | Home · People · Families · Places · Tree · Cases · Library |
| Page title (new person) | "New person" |
| Page title (edit) | "Edit [FirstName LastName]" |
| Partnership type options | Marriage · Civil union · Domestic partnership · Relationship · Unknown |
| Ended reason options | Divorce · Death of partner · Separation · Annulment · Unknown |
| Sex options | Female · Male · Non-binary · Unknown |
| Name variant types | Given name · Nickname · Maiden name · Anglicized · Alias |
| Source type options | Census · Vital record · Church record · Newspaper · Oral history · Document · Photo · Other |

---

## 3. Action Labels

| Action | Label |
|---|---|
| Create person | "Add person" |
| Create family | "Add family" |
| Attach citation | "Attach source" |
| Attach new citation | "Add new source" |
| Open descendants panel | "Descendants ([n])" |
| View tree | "View in tree" |
| Create case | "Start a case" |
| New case (nav) | "+ New case" |
| Save | "Save" |
| Save and create another | "Save & add another" |
| Revert audit entry | "Revert this change" |

---

## 4. Citation Labels

| Context | String |
|---|---|
| Empty cite pin (tooltip) | "Attach source" |
| Empty cite pin (aria-label) | "Attach source for [field name]" |
| Filled cite pin (tooltip) | "[Source title]" |
| Filled cite pin (aria-label) | "Source [n]: [title]. View in library." |
| Citation linter — unsourced | "N facts not yet sourced" |
| Citation linter — single | "1 fact not yet sourced" |
| Sources count (green pill) | "✓ [n] source" / "✓ [n] sources" |
| Unsourced count (amber pill) | "[n] unsourced" |

---

## 5. Empty States

| Page / context | Heading | Body | CTA |
|---|---|---|---|
| Dashboard (new user) | "Your tree is empty." | "Add your first person to get started." | "Add person" / "Import GEDCOM" |
| People list | "No people yet." | "Start by adding yourself or the person you're researching." | "Add person" |
| People list (filtered) | "No matches." | "Try clearing the filters or searching by name." | "Clear filters" |
| Family list | "No families recorded." | — | "Add family" |
| Cases (no open) | "No open cases." | "Cases help you track research questions." | "Start a case" |
| Library (no sources) | "No sources cited yet." | "Once you attach a record, it'll appear here with a numbered amber pin." | "Attach a source" |
| Library Uncited tab | "Every source is cited." | "Nothing here — all sources are attached to at least one fact." | — |
| Places | "No places recorded." | "Add birth, death, or event places to people to see them here." | — |
| Sources panel (person) | "No sources cited for [name]." | — | "Attach source" |

---

## 6. Confirmation Dialogs

**Principle:** Say what will happen in plain English. No "Are you sure?" without context. One "scary" sentence max.

| Action | Confirmation text |
|---|---|
| Delete person | "Removes [name] and all their event and relationship links. Sources stay in the library." |
| Delete family | "Removes this partnership. Partners and children stay in the tree." |
| Delete citation | "Removes this source link. The source stays in the library." |
| GEDCOM overwrite import | "This will delete all people, families, events, and sources in your tree, then import the file. This cannot be undone." |
| Revert audit entry | "Reverts [field] on [entity] from '[new value]' to '[old value]'." |
| Discard new case (Esc) | "Discard this case? Nothing has been saved." |

---

## 7. Error Messages

| Trigger | Message |
|---|---|
| API failure (generic) | "Something went wrong. Try again." |
| Network offline | "You're offline. Changes won't save until you reconnect." |
| Invalid date input | "Enter a year (e.g. 1882), a full date (e.g. 14 Mar 1882), or 'abt. 1882' for approximate." |
| Duplicate person warning | "Possible duplicate of [name] (born [year])." |
| GEDCOM parse error | "Couldn't read this file. Make sure it's a valid .ged file and try again." |
| File too large | "File is too large. Maximum upload size is 10 MB." |
| Wrong file type | "Only image files can be uploaded here." |

---

## 8. TODO

- [ ] Review all existing button labels and error messages against this guide (Phase 1 cleanup)
- [ ] Standardize toast messages (success, warning, error, info — see missing-design-work.md)
- [ ] Decide: "Save" vs "Save changes" for the edit form save bar
- [ ] Localization: French and Russian strings need to be updated in `messages/fr.json` and `messages/ru.json` to match new labels
