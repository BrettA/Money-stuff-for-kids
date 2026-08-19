#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertCanonicalEdition } = require('./lib/edition-schema');
const { accessToken, findMessages, getFullMessage } = require('./lib/gmail');
const { assertInventory, clean, extractHtmlSections, sourceDigest, substantive } = require('./lib/money-stuff-source');
const {
  DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, clientFor, generateImage, generateMetadata, generateStory
} = require('./lib/openai-generation');
const { run, stageAndValidate } = require('./lib/package-edition');
const { submitPackage } = require('./lib/submit-package');
const { assertNotSubmitted, loadState, recordGeneration, recordSubmission, writeState } = require('./lib/worker-state');

const root = path.resolve(__dirname, '..');
const REQUIRED = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'OPENAI_API_KEY'];

function env(name, required = true) {
  const value = process.env[name];
  if (required && !value) throw new Error(`Required secret or configuration ${name} is missing`);
  return value || '';
}

function slug(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'story';
}

function uniqueStoryIds(sections) {
  const used = new Map();
  return sections.map(section => {
    const base = slug(section.heading);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function retryRequested(environment = process.env) {
  if (environment.ADMIN_RETRY !== 'true') return false;
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('admin retry is allowed only from workflow_dispatch');
  }
  if (!environment.GMAIL_MESSAGE_ID) throw new Error('admin retry requires an explicit Gmail message ID');
  if (environment.SUBMIT !== 'true') throw new Error('admin retry requires submission');
  if (!environment.ADMIN_RETRY_TOKEN) throw new Error('admin retry authorization is missing');
  return true;
}

function assertMessageEligible(state, messageId, adminRetry) {
  if (!adminRetry) assertNotSubmitted(state, messageId);
}

async function main() {
  for (const name of REQUIRED) env(name);
  const submit = process.env.SUBMIT === 'true';
  const adminRetry = retryRequested();
  if (adminRetry) env('ADMIN_RETRY_TOKEN');
  if (submit) {
    env('PUBLISH_API_TOKEN');
    env('PUBLISH_BRIDGE_URL');
  }
  const stateFile = path.resolve(env('WORKER_STATE_FILE'));
  const state = loadState(stateFile);
  const publishedState = JSON.parse(fs.readFileSync(path.join(root, 'data/publisher-state.json'), 'utf8'));
  const previouslyPublished = new Set((publishedState.processedIssues || []).map(issue => issue.gmailMessageId));
  const token = await accessToken({
    clientId: env('GMAIL_CLIENT_ID'), clientSecret: env('GMAIL_CLIENT_SECRET'), refreshToken: env('GMAIL_REFRESH_TOKEN')
  });
  let messageId = process.env.GMAIL_MESSAGE_ID || '';
  if (messageId) {
    if (previouslyPublished.has(messageId)) throw new Error(`Gmail message ${messageId} is already present in published repository state`);
    assertMessageEligible(state, messageId, adminRetry);
  } else {
    const messages = await findMessages({
      token,
      query: process.env.MONEY_STUFF_GMAIL_QUERY || 'from:(noreply@news.bloomberg.com) subject:(Money Stuff)'
    });
    const candidate = messages.find(message => !previouslyPublished.has(message.id) &&
      !(state.messages[message.id] && state.messages[message.id].submitted));
    if (!candidate) throw new Error('No unprocessed Money Stuff Gmail message was found');
    messageId = candidate.id;
  }
  const message = await getFullMessage({ id: messageId, token });
  if (!message.html) throw new Error('Money Stuff message has no full HTML body for reliable section inventory');
  const sections = assertInventory(extractHtmlSections(message.html));
  const stories = substantive(sections);
  if (!stories.length) throw new Error('Money Stuff message contains no substantive sections');

  const client = clientFor(env('OPENAI_API_KEY'));
  const textModel = process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const imageModel = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const receivedAt = new Date(Number(message.internalDate));
  if (Number.isNaN(receivedAt.getTime())) throw new Error('Gmail message has an invalid internal date');
  message.canonicalDate = receivedAt.toISOString().slice(0, 10);
  message.canonicalTitle = clean(message.subject.replace(/^Money Stuff:\s*/i, ''));
  if (!message.canonicalTitle) throw new Error('Money Stuff message has no usable newsletter title');
  const metadata = (await generateMetadata({ client, model: textModel, message, sections })).value;
  const headings = sections.map(section => section.heading);
  if (JSON.stringify(metadata.sectionHeadings) !== JSON.stringify(headings)) {
    throw new Error('Structured extraction omitted, invented, reordered, or renamed a source section');
  }
  if (metadata.newsletterDate !== message.canonicalDate || clean(metadata.newsletterTitle) !== message.canonicalTitle) {
    throw new Error('Structured metadata changed the canonical Gmail date or title');
  }
  const editionId = `${message.canonicalDate}-${slug(message.canonicalTitle)}`;
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editionId)) throw new Error('Generated edition ID is invalid');
  if (fs.existsSync(path.join(root, 'data', `${editionId}.json`))) {
    throw new Error(`Canonical edition ${editionId} already exists on main`);
  }
  const ids = uniqueStoryIds(stories);
  const generatedStories = [];
  const images = [];
  for (const [index, section] of stories.entries()) {
    const generated = (await generateStory({ client, model: textModel, section })).value;
    const image = await generateImage({ client, model: imageModel, prompt: generated.illustration.prompt });
    const imagePath = `/images/${editionId}/${ids[index]}.png`;
    generatedStories.push({
      id: ids[index],
      sourceSection: section.heading,
      illustration: { src: imagePath, alt: generated.illustration.alt },
      elementaryChecklist: generated.elementaryChecklist,
      adaptations: generated.adaptations
    });
    images.push({ path: imagePath, bytes: image.bytes });
  }

  const date = new Date(`${metadata.newsletterDate}T12:00:00Z`);
  const edition = assertCanonicalEdition({
    schemaVersion: 2,
    id: editionId,
    date: metadata.newsletterDate,
    displayDate: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date),
    title: clean(metadata.newsletterTitle),
    sourceSections: headings,
    stories: generatedStories
  });

  // Run the repository suite before the isolated publisher validation required for submission.
  run('npm', ['test'], { cwd: root });
  const outputDirectory = path.resolve(process.env.WORKER_OUTPUT_DIRECTORY || path.join(root, '.worker-output'));
  const packaged = stageAndValidate({ root, edition, images, outputDirectory });
  const now = new Date().toISOString();
  recordGeneration(state, {
    gmailMessageId: messageId,
    newsletterDate: edition.date,
    newsletterTitle: edition.title,
    editionId,
    sourceSha256: sourceDigest(message.text),
    packageSha256: packaged.sha256,
    updatedAt: now
  });
  if (submit) {
    const accepted = await submitPackage({
      bridgeUrl: env('PUBLISH_BRIDGE_URL'), token: env('PUBLISH_API_TOKEN'), editionId,
      archive: packaged.archive, sha256: packaged.sha256, adminRetry,
      adminRetryToken: adminRetry ? env('ADMIN_RETRY_TOKEN') : ''
    });
    recordSubmission(state, messageId, { packageSha256: accepted.package_sha256, updatedAt: new Date().toISOString() });
  }
  writeState(stateFile, state);
  output('edition_id', editionId);
  output('gmail_message_id', messageId);
  output('package_sha256', packaged.sha256);
  output('submitted', String(submit));
  console.log(`Completed ${submit ? 'submitted' : 'dry-run'} generation for ${editionId} (${stories.length} stories).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Money Stuff worker failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assertMessageEligible, retryRequested };
