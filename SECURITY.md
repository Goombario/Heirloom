# Security policy

Heirloom holds family history, which often includes living people's names, dates, places and
photos. Security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through
GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**.
Only the maintainers can see the report.

Include what you can of:

- which flavour is affected (hosted server, static site or desktop app) and which version
  (shown on the About page)
- the steps to reproduce, or a proof of concept
- what an attacker could do with it

This is a small volunteer project, so replies are best effort. You should hear back within
a couple of weeks. Please give a reasonable chance to release a fix before you disclose the
problem publicly.

## Supported versions

Fixes go into the latest release only. If you run your own copy, upgrade to the latest
release to get them ([upgrading](SELF_HOSTING.md#backups-and-upgrades)).

## Scope

In scope, for example:

- getting into a tree, or a site, without having been given access
- going beyond the access you were given, such as editing with view-only access
- reading or changing another tree's data, media or audit log
- uploads or imports (GEDCOM, zip, spreadsheet, photos) that run code, escape the media
  folder or expose other files
- leaking private data through exports, backups, logs or error messages

Out of scope:

- problems that require an already compromised server, browser or computer
- the static site and desktop app keeping data unencrypted on the user's own device; that
  is by design, and the data never leaves it unless the user backs it up
- weaknesses in one self-hoster's configuration, such as a weak `AUTH_SECRET` or an
  exposed database, unless the defaults or the documentation caused them
- missing hardening headers or rate limits, without a concrete way to exploit them
