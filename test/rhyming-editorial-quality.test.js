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

test('picture-book prompt makes factual meaning and natural English outrank optional rhyme', () => {
  const instructions = storyInstructions();
  assert.match(instructions, /Natural, idiomatic English and factual fidelity are absolute requirements/i);
  assert.match(instructions, /Rhyme is optional and secondary/i);
  assert.match(instructions, /prefer an unrhymed line to filler, nonsense, awkward wording, or factual distortion/i);
  assert.match(instructions, /Do not cram every source statistic into the narrative/i);
  assert.match(instructions, /read every story line as normal prose/i);
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
    'a market worth of $2.8 billion, chimed',
    'in a blip',
    'with legal eyes',
    'have real feel',
    'put the old debt claims to a frame',
    'a very big fleece',
    'lost its tense',
    'media moved next because it saw the grin',
    'made a headline law'
  ];
  for (const line of badLines) {
    await assert.rejects(generate(validStoryWith(line)), /prohibited filler/);
  }
});

test('concrete PR 33 factual regressions are rejected', async () => {
  const section = sourceText => ({ heading: 'The deal', sourceText });
  const generateFrom = (story, sourceText) => generateStory({
    client: { responses: { parse: async () => ({ output_parsed: story }) } },
    model: DEFAULT_TEXT_MODEL,
    section: section(sourceText)
  });

  await assert.rejects(
    generateFrom(validStoryWith('Returns rose a thousandfold since the start.'), 'A real person at A real company earned a return of about 1,000%.'),
    /incorrectly converts a 1,000% return/
  );
  await assert.rejects(
    generateFrom(validStoryWith('The trader said, “This will work!”'), 'A real person at A real company completed the actual transaction.'),
    /invents a direct quotation/
  );
  await assert.rejects(
    generateFrom(validStoryWith('The trader was selling no contracts.'), 'A real person at A real company was buying the no side.'),
    /reverses buying the no side/
  );
});

test('ordinary words used naturally are not globally banned', async () => {
  await assert.doesNotReject(generate(validStoryWith('The source described a bell on the exchange floor and a hand signal used in the trade.')));
});
