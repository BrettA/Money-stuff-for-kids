'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_TEXT_MODEL, generateStory, storyInstructions
} = require('../scripts/lib/openai-generation');

function validStoryWith(line) {
  const filler = Array.from({ length: 230 }, (_, index) => `fact${index}`).join(' ');
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

test('picture-book prompt entertains first while preserving the factual spine', () => {
  const instructions = storyInstructions();
  assert.match(instructions, /not a financial-literacy lesson/i);
  assert.match(instructions, /Entertainment and clarity matter more than exhaustive precision/i);
  assert.match(instructions, /mostly natural rhyming couplets/i);
  assert.match(instructions, /Do not cram every source fact/i);
  assert.match(instructions, /Playful storybook imagery and mild comic exaggeration are allowed/i);
  assert.match(instructions, /factual anchor that lets the story stay fun/i);
});

test('playful language is not broadly rejected by subjective style guards', async () => {
  await assert.doesNotReject(generate(validStoryWith(
    'The deal went by in a blip, while spreadsheets danced on a moonlit ship.'
  )));
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

test('Elementary word-count boundaries are inclusive from 250 through 400 words', async () => {
  const storyWithWordCount = wordCount => {
    const story = validStoryWith('');
    const ending = 'What happened? A real company completed the actual transaction.';
    const endingWordCount = ending.match(/\b[\p{L}\p{N}][\p{L}\p{N}’'-]*\b/gu).length;
    story.adaptations.elementary.paragraphs = [
      Array.from({ length: wordCount - endingWordCount }, (_, index) => `word${index}`).join(' '),
      ending
    ];
    return story;
  };

  await assert.doesNotReject(generate(storyWithWordCount(250)));
  await assert.rejects(generate(storyWithWordCount(249)), /250–400 words \(received 249\)/);
  await assert.doesNotReject(generate(storyWithWordCount(400)));
  await assert.rejects(generate(storyWithWordCount(401)), /250–400 words \(received 401\)/);
});

test('harmless playful imagery is not rejected merely for being playful', async () => {
  await assert.doesNotReject(generate(validStoryWith('A tiny moon wore a bow tie while the spreadsheets did a cheerful jig.')));
});
