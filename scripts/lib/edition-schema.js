'use strict';

const { z } = require('zod');

const nonempty = z.string().trim().min(1);
const adaptation = z.object({
  title: nonempty,
  lesson: nonempty,
  paragraphs: z.array(nonempty).min(1)
}).strict();

const storyGeneration = z.object({
  adaptations: z.object({
    preschool: adaptation,
    elementary: adaptation,
    middle: adaptation,
    high: adaptation
  }).strict(),
  elementaryChecklist: z.object({
    realPeople: z.array(nonempty).min(1),
    realCompanies: z.array(nonempty).min(1),
    financialMechanism: nonempty,
    centralJoke: nonempty
  }).strict(),
  illustration: z.object({
    alt: nonempty,
    prompt: nonempty
  }).strict()
}).strict();

const editionMetadata = z.object({
  newsletterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newsletterTitle: nonempty,
  editionSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sectionHeadings: z.array(nonempty).min(1)
}).strict();

function assertCanonicalEdition(edition) {
  if (edition.schemaVersion !== 2) throw new Error('Canonical edition schemaVersion must be 2');
  if (edition.sourceSections.length !== edition.stories.length +
      edition.sourceSections.filter(value => /^things\s+happen[.!?]?$/i.test(value.trim())).length) {
    throw new Error('Canonical source-section inventory does not match generated stories');
  }
  for (const story of edition.stories) storyGeneration.omit({ illustration: true }).parse({
    adaptations: story.adaptations,
    elementaryChecklist: story.elementaryChecklist
  });
  return edition;
}

module.exports = { assertCanonicalEdition, editionMetadata, storyGeneration };
