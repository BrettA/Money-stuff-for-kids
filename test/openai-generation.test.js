'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_GENERATION_STYLE, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, canonicalIllustrationAlt, generateStory,
  parse, storyInstructions
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

function validRhymingStory() {
  const story = validStory();
  story.adaptations.elementary = {
    title: 'A Real Deal',
    lesson: 'The actual transaction',
    paragraphs: [
      `A real person at A real company made a deal one day. ${'story '.repeat(235)}Facts stay clear while playful pairs can rhyme.`,
      'What happened? A real company completed the actual transaction.'
    ]
  };
  return story;
}

test('provides model defaults while allowing the workflow environment to override them', () => {
  assert.equal(DEFAULT_GENERATION_STYLE, 'rhyming-picture-book');
  assert.equal(DEFAULT_TEXT_MODEL, 'gpt-5-mini');
  assert.equal(DEFAULT_IMAGE_MODEL, 'gpt-image-1.5');
});

test('rhyming prompt protects the real story and picture-book structure', () => {
  const instructions = storyInstructions();
  for (const requirement of [
    /real person/i, /real company/i, /important number/i, /financial mechanism/i,
    /central joke or absurdity/i, /coherent story arc/i, /250–400 words/i,
    /rhyming couplets/i, /read-aloud cadence/i, /What happened\?/i
  ]) assert.match(instructions, requirement);
  assert.match(instructions, /Never invent a person or company/i);
  assert.match(instructions, /lemonade stands, allowances, apples/i);
  assert.match(instructions, /one or two non-rhyming, plain-English sentences/i);
});

test('generation defaults to rhyme while retaining an explicit legacy escape hatch', async () => {
  const calls = [];
  const client = { responses: { parse: async request => {
    calls.push(request);
    return { output_parsed: validRhymingStory() };
  } } };
  const section = { heading: 'A real deal', sourceText: 'A real person at A real company made a real deal.' };
  await generateStory({ client, model: DEFAULT_TEXT_MODEL, section });
  await generateStory({ client, model: DEFAULT_TEXT_MODEL, section, style: 'legacy' });
  assert.match(calls[0].instructions, /rhyming picture-book story/i);
  assert.doesNotMatch(calls[1].instructions, /rhyming picture-book story/i);
  assert.match(calls[1].instructions, /Preschool must be simple but factual/i);
  await assert.rejects(generateStory({ client, model: DEFAULT_TEXT_MODEL, section, style: 'unknown' }), /Unknown generation style/);
});

test('rhyming editorial validation rejects structural and source-fidelity regressions', async () => {
  const section = { heading: 'The deal', sourceText: 'A real person at A real company completed the actual transaction.' };
  const generate = story => generateStory({
    client: { responses: { parse: async () => ({ output_parsed: story }) } },
    model: DEFAULT_TEXT_MODEL,
    section
  });

  const missingEnding = validRhymingStory();
  missingEnding.adaptations.elementary.paragraphs[1] = 'The ordinary prose ending has no explanatory heading.';
  await assert.rejects(generate(missingEnding), /What happened\?/);

  const genericShortCopy = validRhymingStory();
  genericShortCopy.adaptations.elementary.paragraphs = ['A lemonade stand analogy.', 'What happened? A transaction occurred.'];
  await assert.rejects(generate(genericShortCopy), /250–400 words/);

  const inventedCompany = validRhymingStory();
  inventedCompany.elementaryChecklist.realCompanies = ['Invented Lemonade LLC'];
  await assert.rejects(generate(inventedCompany), /invented or altered company/);

  const omittedPerson = validRhymingStory();
  omittedPerson.adaptations.elementary.paragraphs[0] = omittedPerson.adaptations.elementary.paragraphs[0]
    .replace('A real person', 'Someone');
  await assert.rejects(generate(omittedPerson), /omitted real person/);
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
