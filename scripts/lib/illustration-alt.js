'use strict';

// Keep generation and publication on the same definition of placeholder copy.
const PLACEHOLDER_PATTERN = /(?:todo|placeholder|replace[-_ ]?me|example(?:[-_ ]image)?|generic(?:[-_ ]image)?|sample(?:[-_ ]image)?)/i;

function isPlaceholderIllustrationAlt(value) {
  return typeof value !== 'string' || !value.trim() || PLACEHOLDER_PATTERN.test(value);
}

function withoutPlaceholderTerms(value) {
  return String(value || '')
    .replace(/todo/gi, 'planned')
    .replace(/placeholder/gi, 'draft')
    .replace(/replace[-_ ]?me/gi, 'subject')
    .replace(/example(?:[-_ ]image)?/gi, 'depicted scene')
    .replace(/generic(?:[-_ ]image)?/gi, 'story scene')
    .replace(/sample(?:[-_ ]image)?/gi, 'depicted scene')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalIllustrationAlt({ alt, title, prompt }) {
  const supplied = typeof alt === 'string' ? alt.trim() : '';
  if (!isPlaceholderIllustrationAlt(supplied)) return supplied;

  const storyTitle = withoutPlaceholderTerms(title);
  const imageDescription = withoutPlaceholderTerms(prompt);
  const subject = storyTitle || 'this financial story';
  const detail = imageDescription || `a scene about ${subject}`;
  return `Scene for “${subject}”: ${detail}`;
}

module.exports = { PLACEHOLDER_PATTERN, canonicalIllustrationAlt, isPlaceholderIllustrationAlt };
