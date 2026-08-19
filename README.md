# Money Stuff for Kids — V4

## What changed
- Backfilled all five Money Stuff emails currently in the project inbox (Aug 3, 10, 11, 12, 13, 2026).
- Four live reading targets: Preschool, Elementary School, Middle School, High School.
- Age choice persists in the browser with localStorage.
- Every substantive section receives its own story; generic `Things happen` link roundups are excluded.
- Newsletter signup is wired to FormSubmit -> brettaiinbox@gmail.com.
- Unsubscribe page is included.

## Prototype newsletter delivery
The website sends signup submissions to `brettaiinbox@gmail.com` with:
- `action=subscribe`
- subscriber `email`
- `agePreference`

An automation can reconstruct the active subscriber list from these signup/unsubscribe messages and send each new edition through the connected Gmail account.

IMPORTANT: FormSubmit requires a one-time activation/confirmation email before submissions flow normally. After deploying V4, submit the form once and confirm the activation email.

This Gmail-based approach is suitable for a tiny private beta. For a larger public launch, migrate subscriber storage and sending to a purpose-built email provider.

## Clean UI revision
Removed internal/prototype notes, source-ingestion explanations, edition story counts, and homepage metadata chips from the reader-facing site.

## V5 editorial direction
Elementary School has been rewritten from the source stories rather than from abstract finance summaries.
Primary goal: preserve the actual Money Stuff story, joke, people, companies, and absurdity at an elementary reading level.
Explicit lesson boxes are omitted from Elementary.

## Publishing new editions

The repeatable, repository-owned workflow is documented in [`docs/PUBLISHING.md`](docs/PUBLISHING.md). Start with an edition section inventory, scaffold it with `npm run new-edition`, write and review all four adaptations and story-specific illustrations, then run `npm run publish`. The publisher automatically rebuilds the archive, homepage, and edition pages; `npm run check` verifies both the editorial contract and generated files.
