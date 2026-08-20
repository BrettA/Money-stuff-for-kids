'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_GENERATION_STYLE, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, canonicalIllustrationAlt,
  ILLUSTRATION_STYLE_PROMPT, entityAppearsInSource,
  generateImage, generateStory, isPictureBookStyle, parse, storyInstructions
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
      `A real person at A real company made a deal one day. ${'story '.repeat(270)}Facts stay clear while playful words sound bright.`,
      'What happened? A real company completed the actual transaction.'
    ]
  };
  return story;
}

test('provides model defaults while allowing the workflow environment to override them', () => {
  assert.equal(DEFAULT_GENERATION_STYLE, 'picture-book-narrative');
  assert.equal(DEFAULT_TEXT_MODEL, 'gpt-5-mini');
  assert.equal(DEFAULT_IMAGE_MODEL, 'gpt-image-1.5');
});

test('picture-book prompt protects the real story while prioritizing natural rhyme', () => {
  const instructions = storyInstructions();
  for (const requirement of [
    /named companies/i, /important numbers/i,
    /actual financial mechanism/i, /central joke or absurdity/i, /coherent beginning/i,
    /250–400 words total/i, /fun, polished read-aloud cadence/i, /mostly natural rhyming couplets/i,
    /What happened\?/i
  ]) assert.match(instructions, requirement);
  assert.match(instructions, /roughly 250–325 words/i);
  assert.match(instructions, /do not pad to hit a target/i);
  assert.match(instructions, /beginning → development → weird or pivotal event → outcome/i);
  assert.match(instructions, /must not drive the Elementary story/i);
  assert.match(instructions, /Never invent a person or company/i);
  assert.match(instructions, /lemonade stands, allowances, apples/i);
  assert.match(instructions, /one or two short, non-rhyming, plain-English sentences/i);
  assert.match(instructions, /sentence-by-sentence and append rhyming suffixes/i);
  assert.match(instructions, /authored children’s story/i);
  assert.match(instructions, /Never split a proper noun, company name, number, abbreviation/i);
  assert.match(instructions, /choose an unrhymed line over awkward wording/i);
  assert.match(instructions, /Never convert percentage returns into multiples incorrectly/i);
  assert.match(instructions, /Never change buying into selling/i);
  assert.match(instructions, /Do not invent direct quotations unless the source contains that quotation/i);
  assert.match(instructions, /read every story line aloud/i);
  assert.match(instructions, /Do not repeat it inside the picture-book story/i);
});

test('illustration planning requires the story-specific weird event instead of generic finance art', () => {
  const instructions = storyInstructions();
  assert.match(instructions, /specific section’s weird core event or financial mechanism/i);
  assert.match(instructions, /who is doing what/i);
  assert.match(instructions, /never fall back to generic money, banking, trading, or finance imagery/i);
  assert.match(instructions, /Rendered text is allowed only when it helps tell this story/i);
  assert.match(instructions, /real company name, sign, short label, or tiny caption/i);
  assert.match(instructions, /infographic, fake website, dashboard, app screen, or screenshot/i);
});

test('image generation applies the consistent preschool board-book style', async () => {
  let request;
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const client = { images: { generate: async value => {
    request = value;
    return { data: [{ b64_json: png.toString('base64') }] };
  } } };

  await generateImage({
    client,
    model: DEFAULT_IMAGE_MODEL,
    prompt: 'A goat swaps a risk contract with a banker while two price tags change places.'
  });

  assert.match(request.prompt, /goat swaps a risk contract/i);
  for (const attribute of [
    /bright preschool board-book illustration/i, /cheerful, polished/i, /cartoonish rather than lifelike/i,
    /rounded shapes/i, /clean confident outlines/i, /flat vivid colors/i,
    /simplified friendly cartoon people/i, /playful, busy-but-clear scene/i,
    /small story-relevant details/i, /actual unusual event and mechanism/i
  ]) assert.match(request.prompt, attribute);
  assert.match(request.prompt, /Text may appear only when useful to this specific story/i);
  assert.match(request.prompt, /real company name, a sign, a short label, or a small caption/i);
  assert.match(request.prompt, /text-heavy infographic layouts, fake websites, dashboards/i);
  assert.equal(request.prompt.endsWith(ILLUSTRATION_STYLE_PROMPT), true);
  assert.doesNotMatch(request.prompt, /no words|no typography/i);
});

test('validators allow harmless line breaks, playful language, and repeated phrasing', async () => {
  const story = validRhymingStory();
  story.adaptations.elementary.paragraphs[0] = story.adaptations.elementary.paragraphs[0]
    .replace('A real person', 'A real\nperson') + ' The next shows why plans can fail.';
  const section = { heading: 'The deal', sourceText: 'A real person at A real company completed the actual transaction.' };
  await assert.doesNotReject(generateStory({
    client: { responses: { parse: async () => ({ output_parsed: story }) } },
    model: DEFAULT_TEXT_MODEL, section
  }));
});

test('generation defaults to a picture-book narrative while retaining compatibility and a legacy escape hatch', async () => {
  const calls = [];
  const client = { responses: { parse: async request => {
    calls.push(request);
    return { output_parsed: validRhymingStory() };
  } } };
  const section = { heading: 'A real deal', sourceText: 'A real person at A real company made a real deal.' };
  await generateStory({ client, model: DEFAULT_TEXT_MODEL, section });
  await generateStory({ client, model: DEFAULT_TEXT_MODEL, section, priorValidationError: 'missing final What happened?' });
  await generateStory({ client, model: DEFAULT_TEXT_MODEL, section, style: 'legacy' });
  assert.match(calls[0].instructions, /polished, funny rhyming picture-book story/i);
  assert.match(calls[1].instructions, /complete replacement output, not a patch/i);
  assert.match(calls[1].input, /missing final What happened/);
  assert.doesNotMatch(calls[2].instructions, /polished, funny rhyming picture-book story/i);
  assert.match(calls[2].instructions, /Preschool must be simple but factual/i);
  await assert.rejects(generateStory({ client, model: DEFAULT_TEXT_MODEL, section, style: 'unknown' }), /Unknown generation style/);
  assert.match(storyInstructions('rhyming-picture-book'), /polished, funny rhyming picture-book story/i);
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

  const omittedIncidentalPerson = validRhymingStory();
  omittedIncidentalPerson.adaptations.elementary.paragraphs[0] = omittedIncidentalPerson.adaptations.elementary.paragraphs[0]
    .replace('A real person', 'Someone');
  await assert.doesNotReject(generate(omittedIncidentalPerson));
});

test('source entity guard accepts common legal-name aliases without admitting inventions', () => {
  assert.equal(entityAppearsInSource('JPMorgan Chase', 'JPMorgan arranged the financing.'), true);
  assert.equal(entityAppearsInSource('ALT5 Sigma Corp.', 'Shares of ALT5 rose after the announcement.'), true);
  assert.equal(entityAppearsInSource('International Business Machines', 'IBM announced the transaction.'), true);
  assert.equal(entityAppearsInSource('Invented Lemonade LLC', 'JPMorgan and ALT5 arranged the transaction.'), false);
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
