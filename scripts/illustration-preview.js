#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runPreview } = require('./lib/illustration-preview');

async function main() {
  const result = await runPreview({
    root: path.resolve(__dirname, '..'),
    editionId: process.env.EDITION_ID || '',
    storyId: process.env.STORY_ID || '',
    label: process.env.PREVIEW_LABEL || '',
    outputDirectory: process.env.PREVIEW_OUTPUT_DIRECTORY || path.resolve('.illustration-previews'),
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_IMAGE_MODEL || undefined,
    runId: process.env.GITHUB_RUN_ID || `local-${Date.now()}`,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1'
  });
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `artifact_name=${result.artifactName}\nartifact_path=${result.destination}\n`);
  }
  console.log(`Generated ${result.manifest.stories.length} illustration preview(s) in ${result.destination}`);
}

if (require.main === module) main().catch(error => {
  console.error(`Illustration preview failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { main };
