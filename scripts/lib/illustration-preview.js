'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_IMAGE_MODEL, clientFor, generateImage } = require('./openai-generation');

const ILLUSTRATION_HOUSE_STYLE = [
  'Create a warm, sophisticated editorial illustration for a children\'s financial-news picture book.',
  'Use hand-painted gouache and colored-pencil textures, simple rounded shapes, expressive but natural characters, and a restrained palette of teal, coral, mustard, cream, and deep navy.',
  'Compose one clear story moment with a strong focal point, gentle humor, generous breathing room, and details grounded only in the supplied scene.',
  'Keep recognizable people respectful rather than caricatured. Do not add facts, people, brands, flags, charts, interfaces, or objects not supported by the scene.',
  'Square composition. No words, letters, numbers, captions, logos, watermarks, or typography. Do not imitate a named living artist.'
].join(' ');

function selectStories(edition, storyId = '') {
  const stories = Array.isArray(edition.stories) ? edition.stories : [];
  if (!storyId) {
    if (!stories.length) throw new Error(`Edition ${edition.id} has no substantive stories`);
    return stories;
  }
  const story = stories.find(candidate => candidate.id === storyId);
  if (!story) throw new Error(`Story ${storyId} does not exist in edition ${edition.id}`);
  return [story];
}

function illustrationPreviewPrompt(edition, story) {
  const scene = story.illustration && story.illustration.alt;
  if (!scene || !String(scene).trim()) {
    throw new Error(`Story ${story.id} has no canonical illustration scene`);
  }
  return [
    ILLUSTRATION_HOUSE_STYLE,
    `Story context: ${story.adaptations.elementary.title}.`,
    `Scene to illustrate exactly: ${String(scene).trim()}`
  ].join('\n');
}

function safeName(value, fallback = '') {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
}

function artifactName({ editionId, label, runId, runAttempt }) {
  const parts = ['illustration-preview', safeName(editionId, 'edition')];
  if (label && String(label).trim()) parts.push(safeName(label, 'label'));
  parts.push(safeName(runId, 'run'), safeName(runAttempt, '1'));
  return parts.join('-');
}

function loadEdition(root, editionId) {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editionId)) {
    throw new Error(`Invalid edition ID: ${editionId || '(blank)'}`);
  }
  const filename = path.join(root, 'data', `${editionId}.json`);
  if (!fs.existsSync(filename)) throw new Error(`Edition ${editionId} does not exist at data/${editionId}.json`);
  const edition = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (edition.id !== editionId) throw new Error(`Edition file ID ${edition.id} does not match requested ID ${editionId}`);
  return edition;
}

async function runPreview({ root, editionId, storyId = '', label = '', outputDirectory, apiKey,
  model = DEFAULT_IMAGE_MODEL, now = () => new Date(), runId = 'local', runAttempt = '1', client }) {
  if (!apiKey && !client) throw new Error('Required secret or configuration OPENAI_API_KEY is missing');
  const edition = loadEdition(root, editionId);
  const stories = selectStories(edition, String(storyId).trim());
  const name = artifactName({ editionId, label, runId, runAttempt });
  const destination = path.resolve(outputDirectory, name);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(destination, { recursive: false });
  const imageClient = client || clientFor(apiKey);
  const generatedAt = now().toISOString();
  const manifest = {
    schemaVersion: 1, artifactName: name, label: String(label || ''), generatedAt,
    model, editionId, requestedStoryId: String(storyId || ''), stories: []
  };
  for (const story of stories) {
    const finalPrompt = illustrationPreviewPrompt(edition, story);
    const image = await generateImage({ client: imageClient, model, prompt: finalPrompt, promptIsFinal: true });
    const filename = `${story.id}.png`;
    fs.writeFileSync(path.join(destination, filename), image.bytes, { flag: 'wx' });
    manifest.stories.push({ storyId: story.id, storyTitle: story.adaptations.elementary.title,
      sourceSection: story.sourceSection, filename, finalImagePrompt: finalPrompt });
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { artifactName: name, destination, manifest };
}

module.exports = { ILLUSTRATION_HOUSE_STYLE, artifactName, illustrationPreviewPrompt, loadEdition,
  runPreview, safeName, selectStories };
