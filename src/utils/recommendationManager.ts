/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anime } from '../types';
import { getAnimeRatingStats } from './ratingManager';

// In-memory per-user cache that stays active during normal browsing but cleanly resets on page restart/reload
const memoryUserRecommendations = new Map<string, { cycleStartTime: number; animeIds: string[]; listSignature: string }>();

const CYCLE_48H_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Computes 10 recommended animes personalized to the specific user's tastes (genres from myList & watched),
 * strictly excluding animes marked as watched, and isolated per user account.
 * When switching accounts, recommendations immediately adapt to the active user's taste.
 */
export function getRecommendedAnimes(
  animes: Anime[],
  myListIds: string[] = [],
  watchedIds: string[] = [],
  userId?: string | null
): Anime[] {
  const watchedSet = new Set(watchedIds || []);
  const visibleAnimes = animes.filter((a) => !a.hidden && !watchedSet.has(a.id));
  if (visibleAnimes.length === 0) return [];

  const accountKey = userId ? `user_${userId}` : 'guest';
  // Signature representing the user's personal tastes
  const listSignature = `${[...myListIds].sort().join(',')}|${[...watchedIds].sort().join(',')}`;

  const cached = memoryUserRecommendations.get(accountKey);
  const now = Date.now();
  const isCacheValid = cached &&
    cached.listSignature === listSignature &&
    (now - cached.cycleStartTime < CYCLE_48H_MS);

  if (isCacheValid) {
    const validAnimes: Anime[] = [];
    for (const id of cached.animeIds) {
      if (!watchedSet.has(id)) {
        const found = visibleAnimes.find((a) => a.id === id);
        if (found) validAnimes.push(found);
      }
    }
    if (validAnimes.length >= Math.min(10, visibleAnimes.length)) {
      return validAnimes.slice(0, 10);
    }
  }

  // 1. Analyze user favorite genres based on saved and watched animes
  const myListSet = new Set(myListIds);
  const watchedOnlySet = new Set(watchedIds);
  const genreFrequency: Record<string, number> = {};

  animes.forEach((a) => {
    if (myListSet.has(a.id)) {
      (a.genreIds || []).forEach((gid) => {
        // High affinity for items in user's personal list
        genreFrequency[gid] = (genreFrequency[gid] || 0) + 5;
      });
    } else if (watchedOnlySet.has(a.id)) {
      (a.genreIds || []).forEach((gid) => {
        // Moderate affinity for items the user has watched
        genreFrequency[gid] = (genreFrequency[gid] || 0) + 2;
      });
    }
  });

  const hasSpecificTastes = Object.keys(genreFrequency).length > 0;

  // 2. Score every visible anime that is NOT watched
  const scoredAnimes = visibleAnimes.map((a) => {
    let genreScore = 0;
    (a.genreIds || []).forEach((gid) => {
      genreScore += genreFrequency[gid] || 0;
    });

    const ratingStats = getAnimeRatingStats(a.id);
    const ratingScore = (ratingStats.average > 0 ? ratingStats.average * 150 : 0) + (ratingStats.totalVotes * 15);
    const downloadScore = (a.downloads || 0) * 0.4;
    const epScore = (a.episodes || []).length > 0 ? 40 : 0;

    // Heavy boost if genres match the user's specific account taste
    const tasteBonus = hasSpecificTastes ? (genreScore * 180) : 0;

    return {
      anime: a,
      baseScore: tasteBonus + ratingScore + downloadScore + epScore,
    };
  });

  // Account-specific seed so different accounts with same generic taste get varied personalized picks
  let accountSeed = 0;
  const seedString = `${accountKey}-${Math.floor(now / CYCLE_48H_MS)}`;
  for (let i = 0; i < seedString.length; i++) {
    accountSeed = (accountSeed << 5) - accountSeed + seedString.charCodeAt(i);
    accountSeed |= 0;
  }

  const randomizedScored = scoredAnimes.map((item) => {
    let hash = 0;
    const str = `${item.anime.id}-${accountSeed}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const seedVariation = Math.abs(hash % 250);
    return {
      anime: item.anime,
      finalScore: item.baseScore + seedVariation,
    };
  });

  randomizedScored.sort((a, b) => b.finalScore - a.finalScore);

  const pickedAnimes = randomizedScored.slice(0, 10).map((i) => i.anime);
  const pickedIds = pickedAnimes.map((a) => a.id);

  // Cache in memory for the active user session
  memoryUserRecommendations.set(accountKey, {
    cycleStartTime: now,
    animeIds: pickedIds,
    listSignature,
  });

  return pickedAnimes;
}
