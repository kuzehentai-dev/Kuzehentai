/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anime } from '../types';
import { getAnimeRatingStats } from './ratingManager';

const STORAGE_KEY = 'kh_recommendations_48h_v1';
const CYCLE_48H_MS = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

interface RecommendationState {
  cycleStartTime: number;
  animeIds: string[];
  seed: number;
}

function loadRecommendationState(): RecommendationState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cycleStartTime === 'number' && Array.isArray(parsed.animeIds)) {
        return parsed;
      }
    }
  } catch {}
  return null;
}

function saveRecommendationState(state: RecommendationState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

/**
 * Computes 10 recommended animes based on user preferences (genres, myList)
 * strictly excluding animes marked as watched, and rotating fresh picks every 48 hours.
 */
export function getRecommendedAnimes(
  animes: Anime[],
  myListIds: string[] = [],
  watchedIds: string[] = []
): Anime[] {
  const watchedSet = new Set(watchedIds || []);
  const visibleAnimes = animes.filter((a) => !a.hidden && !watchedSet.has(a.id));
  if (visibleAnimes.length === 0) return [];

  const now = Date.now();
  let state = loadRecommendationState();

  const isCycleExpired = !state || (now - state.cycleStartTime >= CYCLE_48H_MS);

  // 1. Analyze user favorite genres based on saved and watched animes
  const userFavoriteAnimeIds = new Set([...myListIds, ...watchedIds]);
  const genreFrequency: Record<string, number> = {};

  animes.forEach((a) => {
    if (userFavoriteAnimeIds.has(a.id)) {
      (a.genreIds || []).forEach((gid) => {
        genreFrequency[gid] = (genreFrequency[gid] || 0) + 3;
      });
    }
  });

  // Also include general 24h view activity
  try {
    const rawViews = localStorage.getItem('kh_anime_views_24h');
    if (rawViews) {
      const viewList = JSON.parse(rawViews);
      if (Array.isArray(viewList)) {
        viewList.forEach((v: { animeId: string }) => {
          if (v && v.animeId) {
            const viewedAn = animes.find((a) => a.id === v.animeId);
            if (viewedAn) {
              (viewedAn.genreIds || []).forEach((gid) => {
                genreFrequency[gid] = (genreFrequency[gid] || 0) + 1;
              });
            }
          }
        });
      }
    }
  } catch {}

  // 2. Score every visible anime that is NOT watched
  const scoredAnimes = visibleAnimes.map((a) => {
    let genreScore = 0;
    (a.genreIds || []).forEach((gid) => {
      genreScore += genreFrequency[gid] || 0;
    });

    const ratingStats = getAnimeRatingStats(a.id);
    const ratingScore = (ratingStats.average > 0 ? ratingStats.average * 200 : 0) + (ratingStats.totalVotes * 20);
    const downloadScore = (a.downloads || 0) * 0.5;

    // Small bonus if anime has episodes
    const epScore = (a.episodes || []).length > 0 ? 50 : 0;

    return {
      anime: a,
      baseScore: genreScore * 100 + ratingScore + downloadScore + epScore,
    };
  });

  // If cycle is not expired, verify saved animes (excluding any newly watched)
  if (!isCycleExpired && state && state.animeIds.length > 0) {
    const currentList: Anime[] = [];
    for (const id of state.animeIds) {
      if (watchedSet.has(id)) continue;
      const found = visibleAnimes.find((a) => a.id === id);
      if (found) currentList.push(found);
    }

    if (currentList.length >= Math.min(10, visibleAnimes.length)) {
      return currentList.slice(0, 10);
    }
  }

  // Generate new 48-hour cycle picks
  const newSeed = Math.floor(now / CYCLE_48H_MS);

  // Deterministic pseudo-random variation based on 48h seed
  const randomizedScored = scoredAnimes.map((item) => {
    let hash = 0;
    const str = `${item.anime.id}-${newSeed}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const seedVariation = Math.abs(hash % 300);
    return {
      anime: item.anime,
      finalScore: item.baseScore + seedVariation,
    };
  });

  randomizedScored.sort((a, b) => b.finalScore - a.finalScore);

  const pickedAnimes = randomizedScored.slice(0, 10).map((i) => i.anime);
  const pickedIds = pickedAnimes.map((a) => a.id);

  saveRecommendationState({
    cycleStartTime: now,
    animeIds: pickedIds,
    seed: newSeed,
  });

  return pickedAnimes;
}
