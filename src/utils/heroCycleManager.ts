/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anime } from '../types';
import { getAnimeRatingStats } from './ratingManager';

const STORAGE_KEY = 'kh_hero_cycle_v1';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface HeroCycleState {
  // Timestamp when current 24h cycle started
  cycleStartTime: number;
  // Locked 3 popular anime IDs for the current active period
  popularAnimeIds: string[];
  // Views accumulated by each anime during the current 24h cycle
  cycleViews: Record<string, number>;
  // Locked 1 top-rated anime ID
  topRatedAnimeId: string;
  // Best score achieved by the top-rated anime
  topRatedScore: number;
  // Locked 2 anime IDs with newly added episodes
  newEpisodesAnimeIds: string[];
  // Signature of latest episodes to detect when new episodes are added
  episodesSignature: string;
}

function getInitialCycleState(): HeroCycleState {
  return {
    cycleStartTime: Date.now(),
    popularAnimeIds: [],
    cycleViews: {},
    topRatedAnimeId: '',
    topRatedScore: 0,
    newEpisodesAnimeIds: [],
    episodesSignature: '',
  };
}

let inMemoryState: HeroCycleState | null = null;

function loadState(): HeroCycleState {
  if (inMemoryState) return inMemoryState;

  if (typeof window === 'undefined') {
    inMemoryState = getInitialCycleState();
    return inMemoryState;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cycleStartTime === 'number') {
        inMemoryState = {
          cycleStartTime: parsed.cycleStartTime,
          popularAnimeIds: Array.isArray(parsed.popularAnimeIds) ? parsed.popularAnimeIds : [],
          cycleViews: typeof parsed.cycleViews === 'object' && parsed.cycleViews !== null ? parsed.cycleViews : {},
          topRatedAnimeId: typeof parsed.topRatedAnimeId === 'string' ? parsed.topRatedAnimeId : '',
          topRatedScore: typeof parsed.topRatedScore === 'number' ? parsed.topRatedScore : 0,
          newEpisodesAnimeIds: Array.isArray(parsed.newEpisodesAnimeIds) ? parsed.newEpisodesAnimeIds : [],
          episodesSignature: typeof parsed.episodesSignature === 'string' ? parsed.episodesSignature : '',
        };
        return inMemoryState;
      }
    }
  } catch {}

  inMemoryState = getInitialCycleState();
  saveState(inMemoryState);
  return inMemoryState;
}

function saveState(state: HeroCycleState) {
  inMemoryState = state;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }
}

function notifyUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kh_hero_cycle_updated'));
  }
}

/**
 * Record an anime view/play/download in the current 24-hour cycle.
 */
export function recordHeroAnimeView(animeId: string) {
  if (!animeId) return;
  const state = loadState();
  const currentCount = state.cycleViews[animeId] || 0;
  state.cycleViews[animeId] = currentCount + 1;
  saveState(state);
  notifyUpdated();
}

/**
 * Helper to compute the latest episode timestamp or signature for an anime.
 */
function getAnimeLatestEpisodeTime(anime: Anime): number {
  let maxTime = 0;
  (anime.episodes || []).forEach((ep) => {
    if (ep.addedToRecentAt) {
      const t = new Date(ep.addedToRecentAt).getTime();
      if (t > maxTime) maxTime = t;
    } else if (ep.isNew) {
      const t = anime.updatedAt ? new Date(anime.updatedAt).getTime() : (anime.createdAt ? new Date(anime.createdAt).getTime() : 1);
      if (t > maxTime) maxTime = t;
    }
  });

  if (maxTime === 0) {
    maxTime = anime.updatedAt ? new Date(anime.updatedAt).getTime() : (anime.createdAt ? new Date(anime.createdAt).getTime() : 0);
  }
  return maxTime;
}

/**
 * Computes a combined signature of all anime episode counts and latest dates
 * to know if any new episodes were added anywhere in the database.
 */
function computeEpisodesCatalogSignature(animes: Anime[]): string {
  // Sort animes with episodes by their latest episode timestamp descending
  const withEps = animes
    .filter((a) => !a.hidden && (a.episodes || []).length > 0)
    .map((a) => {
      const latestTime = getAnimeLatestEpisodeTime(a);
      const totalEps = (a.episodes || []).length;
      return `${a.id}:${totalEps}:${latestTime}`;
    });
  
  withEps.sort();
  return withEps.slice(0, 15).join('|');
}

/**
 * Resolves the 6 featured animes for the Hero Carousel adhering strictly to:
 * 1. 3 Animes más populares con ciclo de 24 horas y reglas de reemplazo parcial/total o mantenimiento.
 * 2. 1 Anime con mejor calificación con permanencia hasta que otro lo supere.
 * 3. 2 Animes con nuevos episodios que permanecen fijos hasta que se agreguen nuevos episodios al catálogo.
 */
export function computeHeroFeaturedAnimes(animes: Anime[]): Anime[] {
  const visibleAnimes = animes.filter((a) => !a.hidden);
  if (visibleAnimes.length === 0) return [];

  const state = loadState();
  const now = Date.now();
  let stateModified = false;

  // -------------------------------------------------------------
  // REGLA 1: 3 ANIMES MÁS POPULARES (CICLO DE 24 HORAS)
  // -------------------------------------------------------------
  // ¿Han pasado 24 horas desde que inició el ciclo?
  const has24HoursPassed = (now - state.cycleStartTime) >= ONE_DAY_MS;

  // Si aún no hay 3 populares iniciales guardados, elegirlos por popularidad histórica
  if (state.popularAnimeIds.length < 3) {
    const sortedByDownloads = [...visibleAnimes].sort((a, b) => {
      const dlA = a.downloads || 0;
      const dlB = b.downloads || 0;
      if (dlB !== dlA) return dlB - dlA;
      return (b.episodes || []).length - (a.episodes || []).length;
    });
    state.popularAnimeIds = sortedByDownloads.slice(0, 3).map((a) => a.id);
    stateModified = true;
  }

  // Filtrar que los IDs en state.popularAnimeIds aún existan en el catálogo
  state.popularAnimeIds = state.popularAnimeIds.filter((id) =>
    visibleAnimes.some((a) => a.id === id)
  );

  // Si por alguna razón faltan, rellenar
  if (state.popularAnimeIds.length < 3) {
    for (const an of visibleAnimes) {
      if (state.popularAnimeIds.length >= 3) break;
      if (!state.popularAnimeIds.includes(an.id)) {
        state.popularAnimeIds.push(an.id);
      }
    }
    stateModified = true;
  }

  if (has24HoursPassed) {
    // Revisar qué animes fueron vistos durante este ciclo de 24 horas
    const viewedAnimeEntries = Object.entries(state.cycleViews)
      .filter(([id, count]) => count > 0 && visibleAnimes.some((a) => a.id === id))
      .sort((a, b) => {
        // Ordenar por vistas en las 24h
        if (b[1] !== a[1]) return b[1] - a[1];
        // Desempate por descargas globales
        const anA = visibleAnimes.find((x) => x.id === a[0]);
        const anB = visibleAnimes.find((x) => x.id === b[0]);
        return (anB?.downloads || 0) - (anA?.downloads || 0);
      });

    if (viewedAnimeEntries.length === 0) {
      // "Y si en llegado caso pasaron las 24 horas y no hubo más anime populares
      //  se dejen los que estaban antes hasta que hagan nuevos animes populares"
      // Se mantienen state.popularAnimeIds intactos!
      state.cycleViews = {};
      state.cycleStartTime = now;
      stateModified = true;
    } else {
      // Hubo animes con vistas en las 24 horas.
      // Identificar los 3 actuales y su orden de popularidad interna (del más popular al menos popular)
      const current3WithScores = state.popularAnimeIds.map((id) => {
        const an = visibleAnimes.find((x) => x.id === id);
        const viewsInPeriod = state.cycleViews[id] || 0;
        const totalDl = an?.downloads || 0;
        return {
          id,
          score: viewsInPeriod * 1000 + totalDl,
        };
      });
      // Ordenar de mayor a menor popularidad. El último ([2]) es el menos popular de los 3.
      current3WithScores.sort((a, b) => b.score - a.score);

      const viewedAnimeIds = viewedAnimeEntries.map(([id]) => id);

      if (viewedAnimeIds.length === 1) {
        // "y si solo un anime fue visto en esas 24 horas quiten el anime menos popular
        //  de los actuales 3 y agregué. El nuevo."
        const newAnimeId = viewedAnimeIds[0];
        if (state.popularAnimeIds.includes(newAnimeId)) {
          // El anime visto ya era uno de los 3: se mantiene y sube al primer lugar
          const other2 = state.popularAnimeIds.filter((id) => id !== newAnimeId);
          state.popularAnimeIds = [newAnimeId, other2[0], other2[1]].filter(Boolean);
        } else {
          // Es un anime nuevo visto: quitamos el menos popular (el último de current3WithScores) y agregamos el nuevo
          const kept2 = [current3WithScores[0].id, current3WithScores[1].id];
          state.popularAnimeIds = [newAnimeId, kept2[0], kept2[1]];
        }
      } else if (viewedAnimeIds.length === 2) {
        // 2 animes vistos: reemplazan a los 2 menos populares de los 3 anteriores,
        // conservando el más popular de los 3 anteriores (si no está ya entre los vistos)
        const newPopularSet = new Set<string>();
        viewedAnimeIds.forEach((id) => newPopularSet.add(id));
        // Buscar el más popular de los antiguos que no esté ya en la lista
        for (const item of current3WithScores) {
          if (newPopularSet.size >= 3) break;
          newPopularSet.add(item.id);
        }
        state.popularAnimeIds = Array.from(newPopularSet).slice(0, 3);
      } else {
        // 3 o más animes vistos: los nuevos más populares toman su lugar completamente
        state.popularAnimeIds = viewedAnimeIds.slice(0, 3);
      }

      // Reiniciar contadores del nuevo ciclo de 24 horas a cero
      state.cycleViews = {};
      state.cycleStartTime = now;
      stateModified = true;
    }
  }

  // -------------------------------------------------------------
  // REGLA 2: 1 ANIME CON MEJOR CALIFICACIÓN
  // Sin permanencia forzada: se selecciona el anime con mejor calificación
  // en tiempo real del catálogo (excluyendo los 3 más populares).
  // Se mantiene como mejor calificado hasta que llegue otro anime con
  // mejor calificación o sea superado por nuevas calificaciones.
  // -------------------------------------------------------------
  const candidateAnimesForRating = visibleAnimes.filter(
    (a) => !state.popularAnimeIds.includes(a.id)
  );

  candidateAnimesForRating.sort((a, b) => {
    const statsA = getAnimeRatingStats(a.id);
    const statsB = getAnimeRatingStats(b.id);
    const scoreA = (statsA.average > 0 ? statsA.average * 1000 : 0) + (statsA.totalVotes * 100);
    const scoreB = (statsB.average > 0 ? statsB.average * 1000 : 0) + (statsB.totalVotes * 100);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (statsB.average !== statsA.average) return statsB.average - statsA.average;
    const dlA = a.downloads || 0;
    const dlB = b.downloads || 0;
    if (dlB !== dlA) return dlB - dlA;
    return (b.episodes || []).length - (a.episodes || []).length;
  });

  const bestRatedAnime = candidateAnimesForRating[0] || null;
  if (bestRatedAnime) {
    if (state.topRatedAnimeId !== bestRatedAnime.id) {
      state.topRatedAnimeId = bestRatedAnime.id;
      stateModified = true;
    }
  }

  // -------------------------------------------------------------
  // REGLA 3: 2 ANIMES CON NUEVOS EPISODIOS
  // "Y por último los 2 animes con nuevos episodios deje los hasta que
  //  se agreguen nuevos episodios a animes."
  // -------------------------------------------------------------
  const currentCatalogSignature = computeEpisodesCatalogSignature(visibleAnimes);

  // Animes que tienen episodios
  const animesWithEpisodes = visibleAnimes.filter(
    (a) => (a.episodes || []).length > 0 &&
           !state.popularAnimeIds.includes(a.id) &&
           a.id !== state.topRatedAnimeId
  );

  const areSavedNewEpisodesValid =
    state.newEpisodesAnimeIds.length === 2 &&
    state.newEpisodesAnimeIds.every((id) =>
      visibleAnimes.some((a) => a.id === id && (a.episodes || []).length > 0)
    );

  // Si la firma del catálogo cambió (se agregaron nuevos episodios a animes) o no estaban inicializados:
  if (!areSavedNewEpisodesValid || state.episodesSignature !== currentCatalogSignature) {
    // Ordenar animes por episodios más nuevos (priorizar isNew / addedToRecentAt / fecha más reciente)
    const sortedByLatestEpisodes = [...animesWithEpisodes].sort((a, b) => {
      const hasExplicitA = (a.episodes || []).some((ep) => ep.isNew || Boolean(ep.addedToRecentAt));
      const hasExplicitB = (b.episodes || []).some((ep) => ep.isNew || Boolean(ep.addedToRecentAt));
      if (hasExplicitA !== hasExplicitB) return hasExplicitA ? -1 : 1;
      return getAnimeLatestEpisodeTime(b) - getAnimeLatestEpisodeTime(a);
    });

    state.newEpisodesAnimeIds = sortedByLatestEpisodes.slice(0, 2).map((a) => a.id);
    state.episodesSignature = currentCatalogSignature;
    stateModified = true;
  }
  // De lo contrario, se dejan fijos los 2 animes que estaban guardados!

  if (stateModified) {
    saveState(state);
  }

  // -------------------------------------------------------------
  // CONSTRUCCIÓN DEL CARRUSEL (6 ANIMES EXACTOS)
  // -------------------------------------------------------------
  const selectedIds = new Set<string>();
  const result: Anime[] = [];

  // 1. Los 3 animes más populares
  for (const id of state.popularAnimeIds) {
    const an = visibleAnimes.find((a) => a.id === id);
    if (an && !selectedIds.has(an.id)) {
      result.push(an);
      selectedIds.add(an.id);
    }
  }

  // 2. El 1 anime mejor calificado
  let topRatedAnime = visibleAnimes.find((a) => a.id === state.topRatedAnimeId && !selectedIds.has(a.id));
  if (!topRatedAnime) {
    // Fallback al siguiente mejor calificado disponible
    topRatedAnime = visibleAnimes.find((a) => !selectedIds.has(a.id)) || null;
  }
  if (topRatedAnime) {
    result.push(topRatedAnime);
    selectedIds.add(topRatedAnime.id);
  }

  // 3. Los 2 animes con nuevos episodios
  for (const id of state.newEpisodesAnimeIds) {
    const an = visibleAnimes.find((a) => a.id === id);
    if (an && !selectedIds.has(an.id)) {
      result.push(an);
      selectedIds.add(an.id);
    }
  }

  // Si aún faltan para completar 2 de nuevos episodios, buscar disponibles
  if (result.length < 6) {
    const remainingWithEps = visibleAnimes
      .filter((a) => (a.episodes || []).length > 0 && !selectedIds.has(a.id))
      .sort((a, b) => getAnimeLatestEpisodeTime(b) - getAnimeLatestEpisodeTime(a));
    for (const an of remainingWithEps) {
      if (result.length >= 6) break;
      result.push(an);
      selectedIds.add(an.id);
    }
  }

  // Si aún faltan para completar 6 y la base de datos tiene más, completar sin duplicar
  if (result.length < 6 && visibleAnimes.length > result.length) {
    for (const an of visibleAnimes) {
      if (result.length >= 6) break;
      if (!selectedIds.has(an.id)) {
        result.push(an);
        selectedIds.add(an.id);
      }
    }
  }

  return result;
}
