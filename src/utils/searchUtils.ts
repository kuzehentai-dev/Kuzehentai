/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anime } from '../types';

export interface NormalizedAnimeData {
  anime: Anime;
  normTitle: string;
  normTitleNoSpaces: string;
  normStudio: string;
  normGenres: string;
  normYear: string;
  normDesc: string;
  fullTargetNorm: string;
  targetTokens: string[];
  titleTokens: string[];
}

// Calculate Levenshtein edit distance between two strings (fast 1D buffer)
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const v0 = new Int32Array(bLen + 1);
  const v1 = new Int32Array(bLen + 1);

  for (let i = 0; i <= bLen; i++) v0[i] = i;

  for (let i = 0; i < aLen; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bLen; j++) {
      const cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bLen; j++) v0[j] = v1[j];
  }

  return v1[bLen];
}

// Normalize search text: removes accents/diacritics, converts to lowercase, replaces punctuation with spaces, collapses whitespace
export function normalizeSearchText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strips accents (á, é, í, ó, ú, ñ -> n)
    .replace(/[^a-z0-9\s]/g, ' ')    // Replaces special chars with space
    .replace(/\s+/g, ' ')           // Collapses multiple spaces
    .trim();
}

// Checks if a single search word/token matches target text or tokens flexibly
export function isTokenMatch(qToken: string, targetNormalized: string, targetTokens: string[]): boolean {
  if (!qToken || !targetNormalized) return false;

  // 1. Direct substring match in target string
  if (targetNormalized.includes(qToken)) return true;

  // 2. Token-level comparison
  for (let i = 0; i < targetTokens.length; i++) {
    const tToken = targetTokens[i];
    if (tToken.includes(qToken) || qToken.includes(tToken)) return true;

    // 3. Fuzzy edit distance for minor typos (only for tokens > 3 chars)
    const maxAllowedDist = qToken.length <= 3 ? 0 : qToken.length <= 6 ? 1 : 2;
    if (maxAllowedDist > 0 && Math.abs(qToken.length - tToken.length) <= maxAllowedDist) {
      if (levenshteinDistance(qToken, tToken) <= maxAllowedDist) {
        return true;
      }
    }
  }

  return false;
}

// Calculate search relevance score (higher = closer match, placed first)
export function calculateRelevanceScore(
  normQuery: string,
  normQueryNoSpaces: string,
  queryTokens: string[],
  data: NormalizedAnimeData
): number {
  if (!normQuery) return 0;

  const { normTitle, normTitleNoSpaces, normStudio, normGenres, normYear, normDesc, titleTokens } = data;
  let score = 0;

  // 1. Title matching
  if (normTitle === normQuery) {
    score += 10000;
  } else if (normTitle.startsWith(normQuery)) {
    score += 5000 + (100 - Math.min(90, normTitle.length - normQuery.length));
  } else if (normTitle.includes(normQuery)) {
    const pos = normTitle.indexOf(normQuery);
    score += 3000 + (100 - Math.min(90, pos));
  }

  // 2. Space-stripped title match (e.g. "overflow" vs "over flow")
  if (normTitleNoSpaces === normQueryNoSpaces) {
    score += 9000;
  } else if (normTitleNoSpaces.startsWith(normQueryNoSpaces)) {
    score += 4500;
  } else if (normTitleNoSpaces.includes(normQueryNoSpaces)) {
    score += 2500;
  }

  // 3. Token-by-token matching in title
  for (let q = 0; q < queryTokens.length; q++) {
    const qToken = queryTokens[q];
    let maxTScore = 0;
    for (let idx = 0; idx < titleTokens.length; idx++) {
      const tToken = titleTokens[idx];
      if (tToken === qToken) {
        maxTScore = Math.max(maxTScore, 1000 - idx * 20);
      } else if (tToken.startsWith(qToken)) {
        maxTScore = Math.max(maxTScore, 700 - idx * 20);
      } else if (tToken.includes(qToken)) {
        maxTScore = Math.max(maxTScore, 400 - idx * 20);
      } else {
        const maxAllowed = qToken.length <= 3 ? 0 : qToken.length <= 6 ? 1 : 2;
        if (maxAllowed > 0 && Math.abs(qToken.length - tToken.length) <= maxAllowed) {
          const dist = levenshteinDistance(qToken, tToken);
          if (dist <= maxAllowed && dist > 0) {
            maxTScore = Math.max(maxTScore, 300 - dist * 50 - idx * 10);
          }
        }
      }
    }
    score += maxTScore;
  }

  // 4. Studio name match
  if (normStudio) {
    if (normStudio === normQuery) score += 2000;
    else if (normStudio.includes(normQuery)) score += 800;
  }

  // 5. Genre match
  if (normGenres && normGenres.includes(normQuery)) {
    score += 600;
  }

  // 6. Year match
  if (normYear && normYear === normQuery) {
    score += 500;
  }

  // 7. Description match
  if (normDesc && normDesc.includes(normQuery)) {
    score += 200;
  }

  return score;
}

// Smart flexible search matcher for Anime items using pre-normalized data
export function matchesFuzzySearch(
  normQuery: string,
  normQueryNoSpaces: string,
  queryTokens: string[],
  data: NormalizedAnimeData
): boolean {
  if (!normQuery) return true;

  // Direct substring check or space-stripped match
  if (data.fullTargetNorm.includes(normQuery) || (data.normTitleNoSpaces && data.normTitleNoSpaces.includes(normQueryNoSpaces))) {
    return true;
  }

  if (queryTokens.length === 0) return true;

  // Every query token must match somewhere in the target
  for (let q = 0; q < queryTokens.length; q++) {
    if (!isTokenMatch(queryTokens[q], data.fullTargetNorm, data.targetTokens)) {
      return false;
    }
  }

  return true;
}

// Builds the normalized data record for an anime
export function buildNormalizedAnimeData(
  anime: Anime,
  studioMap: Map<string, string>,
  genreMap: Map<string, string>
): NormalizedAnimeData {
  const normTitle = normalizeSearchText(anime.name || '');
  const normTitleNoSpaces = normTitle.replace(/\s+/g, '');

  const sIds = (anime.studioIds && anime.studioIds.length > 0)
    ? anime.studioIds
    : (anime.studioId ? [anime.studioId] : []);
  const studioNames = sIds.map(id => studioMap.get(id) || '').filter(Boolean).join(' ');
  const normStudio = normalizeSearchText(studioNames);

  const genreNames = (anime.genreIds || []).map(id => genreMap.get(id) || '').filter(Boolean).join(' ');
  const normGenres = normalizeSearchText(genreNames);

  const normYear = normalizeSearchText(anime.year ? String(anime.year) : '');
  const normDesc = normalizeSearchText(anime.description || '');

  const fullTargetNorm = `${normTitle} ${normTitleNoSpaces} ${normStudio} ${normGenres} ${normYear} ${normDesc}`.trim();
  const targetTokens = fullTargetNorm.split(/\s+/).filter(Boolean);
  const titleTokens = normTitle.split(/\s+/).filter(Boolean);

  return {
    anime,
    normTitle,
    normTitleNoSpaces,
    normStudio,
    normGenres,
    normYear,
    normDesc,
    fullTargetNorm,
    targetTokens,
    titleTokens,
  };
}
