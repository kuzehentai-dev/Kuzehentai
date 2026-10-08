import React, { useState, useEffect, useRef } from 'react';
import { Anime } from '../types';
import { saveCoverToIDB, getAllCoversFromIDB } from '../lib/idbStorage';

// In-memory lookup map populated permanently from IndexedDB for zero-latency 0ms access
export const globalCoverDataMap = new Map<string, string>();

if (typeof window !== 'undefined') {
  getAllCoversFromIDB().then(covers => {
    Object.entries(covers).forEach(([id, dataUrl]) => {
      globalCoverDataMap.set(id, dataUrl);
      globalLoadedAnimeIds.add(id);
    });
  }).catch(() => {});
}

// Inline SVG generator for front-end fallback (100% fail-proof encoding)
export function getFallbackSvg(title?: string, studioName?: string): string {
  const cleanTitle = (title || 'Anime').replace(/["'<>]/g, '');
  const cleanStudio = (studioName || 'Estudio').replace(/["'<>]/g, '');
  
  const colors = [
    { start: '#120808', end: '#2a0a0a', accent: '#ff3333' },
    { start: '#080c14', end: '#101828', accent: '#4d79ff' },
    { start: '#121212', end: '#222222', accent: '#e0e0e0' },
    { start: '#140f08', end: '#2d1d05', accent: '#ffaa00' },
  ];
  const color = colors[Math.abs(cleanTitle.length) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="100%" height="100%">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color.start}"/>
        <stop offset="100%" stop-color="${color.end}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="15" y="15" width="370" height="570" fill="none" stroke="#2a2a2a" stroke-width="2"/>
    <rect x="25" y="25" width="350" height="550" fill="none" stroke="${color.accent}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="8 4"/>
    
    <line x1="50" y1="120" x2="350" y2="120" stroke="#333" stroke-width="1" />
    <line x1="50" y1="480" x2="350" y2="480" stroke="#333" stroke-width="1" />
    
    <circle cx="200" cy="200" r="60" fill="none" stroke="${color.accent}" stroke-opacity="0.8" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="45" fill="none" stroke="#333" stroke-width="1"/>
    <line x1="200" y1="120" x2="200" y2="280" stroke="${color.accent}" stroke-opacity="0.5" stroke-width="1"/>
    
    <text x="200" y="60" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="10" font-weight="600" fill="#888" letter-spacing="4" text-anchor="middle">H KUZE ARCHIVE</text>
    
    <text x="200" y="380" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-weight="800" font-size="20" fill="#ffffff" letter-spacing="-0.5" text-anchor="middle">${cleanTitle}</text>
    
    <text x="200" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="500" fill="${color.accent}" letter-spacing="2" text-anchor="middle">${cleanStudio.toUpperCase()}</text>
    
    <text x="200" y="540" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="9" fill="#666" letter-spacing="1" text-anchor="middle">SPEC. ARTWORK // FALLBACK</text>
  </svg>`;
  
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Generate dominant placeholder gradient for zero-layout-shift and blur-up
export function getDominantPlaceholderGradient(title?: string, id?: string): string {
  const str = (id || title || 'default');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    'from-[#190a2a] via-[#10061e] to-[#0a0414]',
    'from-[#240a1d] via-[#150512] to-[#0a0208]',
    'from-[#0c1329] via-[#080d1e] to-[#040610]',
    'from-[#1a1208] via-[#100b05] to-[#080502]',
    'from-[#180a18] via-[#0f060f] to-[#070307]',
  ];
  return gradients[Math.abs(hash) % gradients.length];
}

export function persistCoverLocally(animeId?: string, src?: string) {
  if (!animeId || !src) return;
  if (src.startsWith('data:image/')) {
    globalCoverDataMap.set(animeId, src);
    globalLoadedAnimeIds.add(animeId);
    saveCoverToIDB(animeId, src);
    return;
  }
  if (typeof window !== 'undefined' && (src.startsWith('/') || src.startsWith('http'))) {
    fetch(src, { cache: 'force-cache' })
      .then(res => {
        if (!res.ok) return null;
        return res.blob();
      })
      .then(blob => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const resData = reader.result as string;
          if (resData && resData.startsWith('data:image/')) {
            globalCoverDataMap.set(animeId, resData);
            globalLoadedAnimeIds.add(animeId);
            saveCoverToIDB(animeId, resData);
          }
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
  }
}

export function processImageSrc(anime: Partial<Anime>, studioName: string = 'Estudio'): string {
  try {
    // 0. Persistent IndexedDB / Memory Cache (0ms Instant Load, Zero Network Requests)
    if (anime.id && globalCoverDataMap.has(anime.id)) {
      return globalCoverDataMap.get(anime.id)!;
    }
    // 1. Base64 coverData from memory: 0ms INSTANT load with zero network roundtrips!
    if (anime.coverData && anime.coverData.startsWith('data:image/')) {
      if (anime.id) {
        globalCoverDataMap.set(anime.id, anime.coverData);
        saveCoverToIDB(anime.id, anime.coverData);
      }
      return anime.coverData;
    }
    if (anime.image && anime.image.startsWith('data:image/')) {
      if (anime.id) {
        globalCoverDataMap.set(anime.id, anime.image);
        saveCoverToIDB(anime.id, anime.image);
      }
      return anime.image;
    }
    // 2. HTTP cover URL as secondary path
    if (anime.image && (anime.image.startsWith('/covers/') || anime.image.startsWith('/api/covers/') || anime.image.startsWith('http://') || anime.image.startsWith('https://'))) {
      return anime.image.trim();
    }
    if (anime.id) {
      return `/covers/${anime.id}.webp`;
    }
  } catch (e) {
    console.error("Failed processing image src", e);
  }
  return getFallbackSvg(anime.name, studioName);
}

// Persisted cache of loaded anime IDs across navigation and reloads
const loadPersistedCoverIds = (): Set<string> => {
  const set = new Set<string>();
  if (typeof window === 'undefined') return set;
  try {
    const raw = localStorage.getItem('kh_persisted_loaded_covers');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach((id: string) => set.add(id));
      }
    }
  } catch {}
  return set;
};

export const globalImageCache = new Set<string>();
export const globalLoadedAnimeIds = loadPersistedCoverIds();
export const globalPreloadedImages = new Map<string, HTMLImageElement>();

// Debounced persistence of loaded cover IDs to localStorage
let persistTimeout: any = null;
export function markAnimeCoverLoaded(animeId?: string, src?: string) {
  let changed = false;
  if (animeId && !globalLoadedAnimeIds.has(animeId)) {
    globalLoadedAnimeIds.add(animeId);
    changed = true;
  }
  if (src && !globalImageCache.has(src)) {
    globalImageCache.add(src);
  }
  if (animeId && src) {
    persistCoverLocally(animeId, src);
  }

  if (changed && typeof window !== 'undefined') {
    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
      try {
        const ids = Array.from(globalLoadedAnimeIds);
        // Keep the latest 500 loaded IDs
        const toSave = ids.length > 500 ? ids.slice(ids.length - 500) : ids;
        localStorage.setItem('kh_persisted_loaded_covers', JSON.stringify(toSave));
      } catch {}
    }, 400);
  }
}

// Background cache in persistent Cache Storage API if available
export async function cacheInCacheStorage(src: string) {
  if (typeof window === 'undefined' || !window.caches || !src || !src.startsWith('/')) return;
  try {
    const cache = await window.caches.open('kh-anime-covers-v1');
    const match = await cache.match(src);
    if (!match) {
      const res = await fetch(src, { cache: 'force-cache' });
      if (res.ok) {
        await cache.put(src, res);
      }
    }
  } catch {}
}

/**
 * Preloads a single anime cover and pins it in browser memory
 */
export function preloadAnimeCover(
  anime: Partial<Anime>, 
  studiosOrStudioName: { id: string; name: string }[] | string = 'Estudio',
  highPriority: boolean = false
): Promise<string> {
  let studioName = 'Estudio';
  if (typeof studiosOrStudioName === 'string') {
    studioName = studiosOrStudioName;
  } else if (Array.isArray(studiosOrStudioName)) {
    const sIds = (anime.studioIds && anime.studioIds.length > 0)
      ? anime.studioIds
      : (anime.studioId ? [anime.studioId] : []);
    studioName = studiosOrStudioName.find(s => sIds.includes(s.id))?.name || 'Estudio';
  }

  const src = processImageSrc(anime, studioName);
  if (!src) return Promise.resolve('');

  if (globalImageCache.has(src) || src.startsWith('data:') || (anime.id && globalLoadedAnimeIds.has(anime.id))) {
    markAnimeCoverLoaded(anime.id, src);
    return Promise.resolve(src);
  }

  if (globalPreloadedImages.has(src)) {
    return Promise.resolve(src);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    // @ts-ignore
    if (highPriority && 'fetchPriority' in img) img.fetchPriority = 'high';

    img.onload = () => {
      markAnimeCoverLoaded(anime.id, src);
      cacheInCacheStorage(src);
      resolve(src);
    };
    img.onerror = () => {
      if (anime.id && !src.includes(`/covers/${anime.id}.webp`)) {
        const fallbackSrc = `/covers/${anime.id}.webp`;
        const fbImg = new Image();
        fbImg.onload = () => {
          markAnimeCoverLoaded(anime.id, fallbackSrc);
          cacheInCacheStorage(fallbackSrc);
          resolve(fallbackSrc);
        };
        fbImg.onerror = () => resolve(src);
        fbImg.src = fallbackSrc;
        globalPreloadedImages.set(fallbackSrc, fbImg);
        return;
      }
      resolve(src);
    };
    img.src = src;
    globalPreloadedImages.set(src, img);
  });
}

/**
 * Intelligent Hover & Proximity Prefetching:
 * Called on mouseEnter, pointerEnter, or touchStart to preload full images,
 * episodes thumbnails, and metadata in 0ms before the user even clicks!
 */
const prefetchedAnimeIds = new Set<string>();
export function prefetchAnime(
  anime: Partial<Anime>,
  studios: { id: string; name: string }[] = []
) {
  if (!anime || !anime.id || prefetchedAnimeIds.has(anime.id)) return;
  prefetchedAnimeIds.add(anime.id);

  // 1. High priority preload for the anime cover
  preloadAnimeCover(anime, studios, true);

  // 2. Preload episode thumbnails if available
  if (anime.episodes && Array.isArray(anime.episodes)) {
    anime.episodes.forEach(ep => {
      if (ep.coverImage && !globalImageCache.has(ep.coverImage)) {
        const epImg = new Image();
        epImg.decoding = 'async';
        epImg.onload = () => {
          globalImageCache.add(ep.coverImage!);
          cacheInCacheStorage(ep.coverImage!);
        };
        epImg.src = ep.coverImage;
      }
    });
  }
}

/**
 * Preloads a list of animes safely
 */
export function preloadAllAnimes(items: Partial<Anime>[], studios: { id: string; name: string }[] = []) {
  if (!items || items.length === 0) return;
  items.forEach(anime => {
    preloadAnimeCover(anime, studios, false);
  });
}

/**
 * Preloads a specific catalog page (useful when hovering pagination buttons)
 */
export function prefetchCatalogPage(
  items: Partial<Anime>[],
  pageNumber: number,
  itemsPerPage: number = 30,
  studios: { id: string; name: string }[] = []
) {
  const start = (pageNumber - 1) * itemsPerPage;
  const pageItems = items.slice(start, start + itemsPerPage);
  if (pageItems.length > 0) {
    pageItems.forEach(anime => preloadAnimeCover(anime, studios, true));
  }
}

/**
 * Two-stage prioritized loading pipeline:
 * Stage 1: Immediate high-priority load for recent episodes + Catalog Page 1
 * Stage 2: Gentle, non-blocking background preloading for all remaining catalog pages!
 */
let isBackgroundQueueRunning = false;
let pendingCatalogQueue: Partial<Anime>[] = [];
let catalogStudiosRef: { id: string; name: string }[] = [];

export function startPrioritizedAppLoading(
  animes: Partial<Anime>[],
  studios: { id: string; name: string }[] = [],
  episodeThumbnails: string[] = []
) {
  if (!animes || animes.length === 0) return;
  catalogStudiosRef = studios;

  // STAGE 1: Immediate high priority for initial screen (episodes + page 1 of catalog)
  if (episodeThumbnails.length > 0) {
    episodeThumbnails.forEach(thumbUrl => {
      if (thumbUrl && !globalImageCache.has(thumbUrl)) {
        const img = new Image();
        img.decoding = 'async';
        // @ts-ignore
        if ('fetchPriority' in img) img.fetchPriority = 'high';
        img.onload = () => {
          globalImageCache.add(thumbUrl);
          cacheInCacheStorage(thumbUrl);
        };
        img.src = thumbUrl;
        globalPreloadedImages.set(thumbUrl, img);
      }
    });
  }

  // Preload first 30 animes (Page 1) with high priority
  const firstPage = animes.slice(0, 30);
  firstPage.forEach(anime => {
    preloadAnimeCover(anime, studios, true);
  });

  // STAGE 2: Gentle background queue for remaining catalog covers (page 2+)
  pendingCatalogQueue = animes.slice(30);

  if (!isBackgroundQueueRunning && pendingCatalogQueue.length > 0) {
    isBackgroundQueueRunning = true;
    setTimeout(() => {
      processNextBackgroundBatch();
    }, 400);
  }
}

function processNextBackgroundBatch() {
  if (pendingCatalogQueue.length === 0) {
    isBackgroundQueueRunning = false;
    return;
  }

  const scheduleNext = () => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => processNextBackgroundBatch(), { timeout: 500 });
    } else {
      setTimeout(processNextBackgroundBatch, 80);
    }
  };

  // Preload 4 images per gentle background batch
  const batch = pendingCatalogQueue.splice(0, 4);
  Promise.all(
    batch.map(anime => preloadAnimeCover(anime, catalogStudiosRef, false))
  ).finally(() => {
    scheduleNext();
  });
}

interface SmartAnimeCoverProps {
  anime: Partial<Anime>;
  studioName?: string;
  className?: string;
  alt?: string;
  loading?: 'eager' | 'lazy';
  priority?: boolean;
}

export function SmartAnimeCover({ 
  anime, 
  studioName = 'Estudio', 
  className = 'w-full h-full object-cover', 
  alt = '',
  loading = 'eager',
  priority = true
}: SmartAnimeCoverProps) {
  const initialSrc = processImageSrc(anime, studioName);
  const [imageSrc, setImageSrc] = useState<string>(initialSrc);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  
  // Instant resolution if already in memory cache, localStorage loaded IDs, IndexedDB map, or preloaded
  const isInstant = Boolean(
    initialSrc.startsWith('data:') || 
    (anime.id && globalCoverDataMap.has(anime.id)) ||
    globalImageCache.has(initialSrc) || 
    (anime.id && globalLoadedAnimeIds.has(anime.id))
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(isInstant);

  // Dominant color placeholder gradient
  const placeholderGradient = getDominantPlaceholderGradient(anime.name, anime.id);

  useEffect(() => {
    // If image is already complete in browser cache, mark instantly with 0ms delay
    if (imgRef.current && (imgRef.current.complete || imgRef.current.naturalWidth > 0)) {
      markAnimeCoverLoaded(anime.id, imageSrc);
      setIsLoaded(true);
    }
  }, [imageSrc, anime.id]);

  useEffect(() => {
    const src = processImageSrc(anime, studioName);
    if (src !== imageSrc) {
      setImageSrc(src);
      setRetryCount(0);
      setHasFailed(false);
      const instant = src.startsWith('data:') || globalImageCache.has(src) || (anime.id ? globalLoadedAnimeIds.has(anime.id) : false);
      setIsLoaded(Boolean(instant));
    } else if (src.startsWith('data:') || globalImageCache.has(src) || (anime.id && globalLoadedAnimeIds.has(anime.id))) {
      setIsLoaded(true);
    }
  }, [anime.image, anime.coverData, anime.id, studioName, imageSrc]);

  const handleLoad = () => {
    markAnimeCoverLoaded(anime.id, imageSrc);
    setIsLoaded(true);
    setHasFailed(false);
  };

  const handleError = () => {
    if (retryCount === 0 && anime.id) {
      setRetryCount(1);
      const nextSrc = `/covers/${anime.id}.webp`;
      setImageSrc(nextSrc);
      if (globalImageCache.has(nextSrc) || globalLoadedAnimeIds.has(anime.id)) setIsLoaded(true);
      return;
    }
    if (retryCount <= 1 && anime.coverData && anime.coverData.startsWith('data:image/')) {
      setRetryCount(2);
      setImageSrc(anime.coverData);
      setIsLoaded(true);
      return;
    }
    if (retryCount <= 2 && anime.id) {
      setRetryCount(3);
      const nextSrc = `/api/covers/${anime.id}.webp`;
      setImageSrc(nextSrc);
      return;
    }
    const svgFallback = getFallbackSvg(anime.name, studioName);
    setImageSrc(svgFallback);
    setIsLoaded(true);
    setHasFailed(true);
  };

  return (
    <div className={`w-full h-full relative overflow-hidden select-none bg-gradient-to-b ${placeholderGradient}`}>
      {/* Blur-up placeholder with gentle shimmer when not yet loaded */}
      {!isLoaded && !hasFailed && (
        <div className="absolute inset-0 bg-[#12091c]/80 backdrop-blur-xs flex items-center justify-center pointer-events-none">
          <div className="w-full h-full bg-gradient-to-tr from-purple-950/40 via-transparent to-purple-800/20 animate-pulse" />
        </div>
      )}

      <img
        ref={imgRef}
        src={imageSrc}
        alt={alt || anime.name || 'Cover'}
        loading={priority ? 'eager' : loading}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
        className={`${className} transition-opacity duration-300 ease-out ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
