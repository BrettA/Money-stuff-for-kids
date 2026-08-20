'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_TEXT_MODEL, generateStory, storyInstructions
} = require('../scripts/lib/openai-generation');

function validStoryWith(line) {
  const filler = Array.from({ length: 255 }, (_, index) => `fact${index}`).join(' ');
  const copy = { title: 'Title', lesson: 'The actual transaction', paragraphs: ['Faithful story.'] };
  return {
    adaptations: {
      preschool: copy,
      elementary: {
        title: 'A Real Deal',
        lesson: 'The actual transaction',
        paragraphs: [
          `A real person at A real company completed the actual transaction. ${line} ${filler}`,
          'What happened? A real company completed the actual transaction.'
        ]
      },
      middle: copy,
      high: copy
    },
    elementaryChecklist: {
      realPeople: ['A real person'],
      realCompanies: ['A real company'],
      financialMechanism: 'The actual transaction',
      centralJoke: 'The source absurdity'
    },
    illustration: { alt: 'Story-specific scene', prompt: 'Concrete source-grounded scene' }
  };
}

function generate(story) {
  const section = {
    heading: 'The deal',
    sourceText: 'A real person at A real company completed the actual transaction.'
  };
  return generateStory({
    client: { responses: { parse: async () => ({ output_parsed: story }) } },
    model: DEFAULT_TEXT_MODEL,
    section
  });
}

test('rhyming prompt makes factual meaning and natural English outrank rhyme', () => {
  const instructions = storyInstructions();
  assert.match(instructions, /Factual meaning and natural, idiomatic English are mandatory; rhyme is optional/i);
  assert.match(instructions, /never sacrifice factual meaning or natural English to complete a rhyme/i);
  assert.match(instructions, /prefer an unrhymed line to filler, nonsense, awkward wording, or factual distortion/i);
  assert.match(instructions, /Do not cram every source statistic into the poem/i);
  assert.match(instructions, /silently read every verse line as ordinary prose/i);
  assert.match(instructions, /Prefer two short sentences when several numbers or mechanics need explanation/i);
});

test('known forced-rhyme failures from the July 30 review are rejected', async () => {
  const badLines = [
    'as more investors were sold',
    'Ken Griffins Citadel hand',
    'Citadel took them for keepsakes',
    'spent forty-four thousand dollars on a sell',
    'pivoted into other grids',
    'make the product light',
    'sixtys what you store',
    'other values must be stood',
    'a different kind of join',
    'a market worth of $2.8 billion, chimed'
  ];
  for (const line of badLines) {
    await assert.rejects(generate(validStoryWith(line)), /reusable rhyme filler/);
  }
});

test('ordinary words used naturally are not globally banned', async () => {
  await assert.doesNotReject(generate(validStoryWith('The source described a bell on the exchange floor and a hand signal used in the trade.')));
});
