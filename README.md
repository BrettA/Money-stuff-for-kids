# Money Stuff for Kids — V3

This version changes the site from a one-off article page into a small publishing system.

## Public structure

- `/` — archive/homepage showing the latest published editions
- `/editions/<edition-id>/` — one permanent page per Money Stuff issue
- `/data/site.json` — site index, age options, newsletter preference schema
- `/data/<edition-id>.json` — structured source edition + age-specific adaptations

## Age model

The content model intentionally separates the real Money Stuff story from its adaptation:

```text
edition
  story
    sourceSection
    adaptations
      toddler
      kindergarten
      middle-school
      high-school
```

V3 only has `kindergarten`, but the other ages can be added without changing URLs or rebuilding the archive model.

## Future newsletter model

`data/site.json` includes the intended subscription fields:

```text
email
agePreference
frequency
status
createdAt
```

When we add email delivery, the publishing job can:
1. ingest the new Money Stuff email
2. generate all requested age variants
3. publish the web edition
4. render an email for each age group
5. send each subscriber the version matching their `agePreference`

Do not put subscriber email addresses into this public repository. They should eventually live in a private database/provider such as Supabase, Postgres, Buttondown, Resend/Audiences, etc.

## Current source edition

Matt Levine, Money Stuff, Aug. 13 2026, “Bilateral OTC Goat Hedge.”
