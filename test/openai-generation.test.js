'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, parse } = require('../scripts/lib/openai-generation');
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
