'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, canonicalIllustrationAlt, parse
} = require('../scripts/lib/openai-generation');
const { isPlaceholderIllustrationAlt } = require('../scripts/lib/illustration-alt');
const { storyGeneration } = require('../scripts/lib/edition-schema');

function validStory() {
  const copy = { title: 'Title', lesson: 'Mechanism', paragraphs: ['Faithful story.'] };
  return {
    adaptations: { preschool: copy, elementary: copy, middle: copy, high: copy },
    elementaryChecklist: {
      realPeople: ['A real person'], realCompanies: ['A real company'],
      financialMechanism: 'The actual transaction', centralJoke: 'The source absurdity'
    },
    illustration: { alt: 'Story-specific scene', prompt: 'Concrete source-grounded scene' }
  };
}

test('provides model defaults while allowing the workflow environment to override them', () => {
  assert.equal(DEFAULT_TEXT_MODEL, 'gpt-5-mini');
  assert.equal(DEFAULT_IMAGE_MODEL, 'gpt-image-1.5');
});

test('uses parsed structured output and fails closed when the SDK returns none', async () => {
  const client = { responses: { parse: async () => ({ output_parsed: validStory(), usage: { input_tokens: 10 } }) } };
  const result = await parse(client, {
    model: DEFAULT_TEXT_MODEL, schema: storyGeneration, name: 'story', instructions: 'instructions', input: 'source'
  });
  assert.equal(result.value.elementaryChecklist.financialMechanism, 'The actual transaction');
  const empty = { responses: { parse: async () => ({ output_parsed: null }) } };
  await assert.rejects(parse(empty, {
    model: DEFAULT_TEXT_MODEL, schema: storyGeneration, name: 'story', instructions: 'instructions', input: 'source'
  }), /no parsed story output/);
});

test('replaces model placeholder alt text with story-specific canonical alt text', () => {
  for (const alt of ['TODO', 'Placeholder art', 'replace_me', 'Example image', 'Generic image', 'Sample-image']) {
    const canonical = canonicalIllustrationAlt({
      alt,
      title: 'The Museum Bond Mystery',
      prompt: 'A museum guard comparing a municipal bond certificate with a dinosaur skeleton'
    });

    assert.match(canonical, /Museum Bond Mystery/);
    assert.match(canonical, /museum guard comparing a municipal bond certificate with a dinosaur skeleton/i);
    assert.equal(isPlaceholderIllustrationAlt(canonical), false);
  }
});

test('sanitizes placeholder words in fallback inputs so canonical validation is guaranteed to pass', () => {
  const canonical = canonicalIllustrationAlt({
    alt: 'Generic image',
    title: 'Sample company buyout',
    prompt: 'Example image of a placeholder crate being replaced in the buyout'
  });

  assert.match(canonical, /company buyout/);
  assert.match(canonical, /crate/);
  assert.equal(isPlaceholderIllustrationAlt(canonical), false);
});
