/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Anime, Studio, Genre, normalizeAnimeYear } from '../types';
import { ArrowLeft, Download, Plus, Check, Play, Pause, Volume2, VolumeX, X, Film, ExternalLink, Tv, Video, Maximize2, Minimize2, RotateCcw, RotateCw, FastForward, Maximize, Loader2, Sparkles, Eye, EyeOff, Star } from 'lucide-react';
import { getFallbackSvg, processImageSrc, globalImageCache, SmartAnimeCover, preloadAnimeCover } from '../utils/imageFallback';
import GlobalComments from './GlobalComments';
import AnimeRatingModal from './AnimeRatingModal';
import { getAnimeRatingStats, submitAnimeVote, RatingStats } from '../utils/ratingManager';
import { auth } from '../lib/firebase';
import { useAppTheme } from '../lib/theme';

interface AnimeDetailProps {
  anime: Anime;
  studios: Studio[];
  genres: Genre[];
  animes?: Anime[];
  allAnimes?: Anime[];
  initialEpisodeNum?: number;
  onBack: () => void;
  onDownload?: (animeId: string) => void;
  onSelectGenre?: (genreId: string) => void;
  onSelectStudio?: (studioId: string) => void;
  onSelectAnime?: (animeId: string) => void;
  isSaved?: boolean;
  onToggleMyList?: (animeId: string) => void;
  isWatched?: boolean;
  onToggleWatched?: (animeId: string) => void;
  navDirection?: number;
}

// Custom SignIcon matching image
const SignIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 2v20" />
    <path d="M4 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4" />
    <path d="M4 11h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4" />
  </svg>
);

export default function AnimeDetail({ anime, studios, genres, animes, allAnimes, initialEpisodeNum, onBack, onDownload, onSelectGenre, onSelectStudio, onSelectAnime, isSaved, onToggleMyList, isWatched: isWatchedProp, onToggleWatched, navDirection = 1 }: AnimeDetailProps) {
  const [appTheme] = useAppTheme();
  const sIds = (anime.studioIds && anime.studioIds.length > 0)
    ? anime.studioIds
    : (anime.studioId ? [anime.studioId] : []);
  const animeStudios = sIds
    .map(id => studios.find(s => s.id === id))
    .filter((s): s is Studio => Boolean(s));
  const studio = animeStudios[0] || (anime.studioId ? studios.find(s => s.id === anime.studioId) : undefined);
  const animeGenres = (anime.genreIds || [])
    .map(id => genres.find(g => g.id === id))
    .filter((g): g is (typeof genres)[0] => Boolean(g));

  // Fallback animes state if animes prop not passed
  const [fetchedAnimes, setFetchedAnimes] = useState<Anime[]>([]);

  useEffect(() => {
    if ((!animes || animes.length === 0) && (!allAnimes || allAnimes.length === 0)) {
      fetch('/api/animes')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setFetchedAnimes(data);
        })
        .catch(() => {});
    }
  }, [animes, allAnimes]);

  const availableAnimes = useMemo(() => {
    if (animes && animes.length > 0) return animes;
    if (allAnimes && allAnimes.length > 0) return allAnimes;
    return fetchedAnimes;
  }, [animes, allAnimes, fetchedAnimes]);

  // Generate a new random seed every time the user enters/mounts or changes anime.id
  const [visitSeed, setVisitSeed] = useState(() => Math.random());

  useEffect(() => {
    setVisitSeed(Math.random());
  }, [anime.id]);

  // Calculate 3 recommended animes based on affinity (genres, studio, episodes, ratings)
  // Select 3 DIFFERENT animes from candidate pool on each visit, remaining stable during the current view
  const recommendedAnimes = useMemo(() => {
    const list = availableAnimes.filter(a => a.id !== anime.id);
    if (list.length === 0) return [];

    const currentGenreSet = new Set(anime.genreIds || []);
    const currentEpCount = anime.episodes?.length || 1;

    const scored = list.map(item => {
      let score = 0;

      // 1. Coincidencia de Géneros (mayor peso)
      const itemGenres = item.genreIds || [];
      let genreMatches = 0;
      itemGenres.forEach(gId => {
        if (currentGenreSet.has(gId)) genreMatches++;
      });
      score += genreMatches * 20;

      // 2. Coincidencia de Estudio
      const curSIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      const itemSIds = (item.studioIds && item.studioIds.length > 0)
        ? item.studioIds
        : (item.studioId ? [item.studioId] : []);
      if (curSIds.some(id => itemSIds.includes(id))) {
        score += 12;
      }

      // 3. Similitud en número de episodios
      const itemEpCount = item.episodes?.length || 1;
      const epDiff = Math.abs(currentEpCount - itemEpCount);
      if (epDiff === 0) {
        score += 6;
      } else if (epDiff <= 2) {
        score += 4;
      } else if (epDiff <= 5) {
        score += 2;
      }

      // 4. Coincidencia de Reseñas y popularidad
      const ratingStats = getAnimeRatingStats(item.id);
      if (ratingStats && ratingStats.average > 0) {
        score += Math.round(ratingStats.average * 2);
      } else if (item.downloads) {
        score += Math.min(10, Math.floor(item.downloads / 50));
      }

      return {
        anime: item,
        score
      };
    });

    // Ordenar candidatos por puntuación base de afinidad
    scored.sort((a, b) => b.score - a.score);

    // Si existen candidatos con puntuación > 0, usar esos; si no, usar todos los disponibles
    const matchingCandidates = scored.filter(s => s.score > 0).map(s => s.anime);
    const candidatePool = matchingCandidates.length >= 3 
      ? matchingCandidates 
      : scored.map(s => s.anime);

    // Función pseudo-aleatoria determinista según el visitSeed
    const seededRandom = (index: number) => {
      const x = Math.sin(visitSeed * 9999 + index * 777) * 10000;
      return x - Math.floor(x);
    };

    // Mezclar el grupo de candidatos
    const shuffled = [...candidatePool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom(i) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Tomar 3 animes distintos
    return shuffled.slice(0, 3);
  }, [anime.id, availableAnimes, visitSeed]);

  // Eagerly download and warm all content immediately on mounting (so user doesn't have to scroll down to load)
  useEffect(() => {
    // 1. Preload anime poster & backdrop
    preloadAnimeCover(anime, studio?.name);

    // 2. Preload recommended animes
    if (recommendedAnimes.length > 0) {
      recommendedAnimes.forEach(rec => {
        const sIds = (rec.studioIds && rec.studioIds.length > 0) ? rec.studioIds : (rec.studioId ? [rec.studioId] : []);
        const recStudio = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';
        preloadAnimeCover(rec, recStudio);
      });
    }

    // 3. Preload all episode thumbnails
    if (anime.episodes && anime.episodes.length > 0) {
      anime.episodes.forEach(ep => {
        const epCover = ep.thumbnail || ep.coverImage;
        if (epCover && !epCover.startsWith('data:')) {
          const img = new Image();
          img.decoding = 'async';
          img.src = epCover;
        }
      });
    }
  }, [anime.id, anime.episodes, studio?.name, recommendedAnimes, studios]);

  // Video Player Modal State
  const [activeEpisodeNum, setActiveEpisodeNum] = useState<number | null>(initialEpisodeNum || null);
  const [isPlayerOpen, setIsPlayerOpen] = useState<boolean>(Boolean(initialEpisodeNum));

  useEffect(() => {
    if (initialEpisodeNum !== undefined && initialEpisodeNum !== null) {
      setActiveEpisodeNum(initialEpisodeNum);
      setIsPlayerOpen(true);
      if (onDownload) {
        onDownload(anime.id);
      }
    }
  }, [initialEpisodeNum, anime.id, onDownload]);

  // Listener para cerrar con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPlayerOpen) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          setIsPlayerOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerOpen]);

  // Gestos de deslizamiento (Swipe de izquierda a derecha):
  // 1. Si el reproductor de video está abierto: deslizar de izquierda a derecha cierra el reproductor y vuelve a los detalles del anime.
  // 2. Si el reproductor está cerrado: deslizar de izquierda a derecha sale de los detalles y vuelve al apartado de donde vino (estudio o catálogo).
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.closest('input') ||
          target.closest('select') ||
          target.closest('textarea') ||
          target.closest('.no-swipe'))
      ) {
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!startTime) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const duration = Date.now() - startTime;
      startTime = 0;

      // Deslizamiento de izquierda a derecha (swipe right):
      // deltaX > 40, horizontal predominante (Math.abs(deltaX) > Math.abs(deltaY) * 1.1), duración natural menor a 900ms
      if (deltaX > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1 && duration < 900) {
        try {
          if (navigator.vibrate) navigator.vibrate(20);
        } catch {}

        if (isPlayerOpen) {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          setIsPlayerOpen(false);
        } else {
          onBack();
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isPlayerOpen, onBack]);

  // Compute episodes list and active episode with robust fallbacks
  const isEmision = Boolean(
    anime.status && (
      anime.status === 'Próximamente' ||
      anime.status.toLowerCase().includes('emisi')
    )
  );
  const statusLabel = isEmision ? 'Emisión' : 'Finalizado';

  const displayEpisodes = useMemo(() => {
    if (anime.episodes && anime.episodes.length > 0) {
      const parsed = anime.episodes
        .map(ep => {
          const videoLink = String(ep.telegramUrl || ep.url || ep.videoUrl || ep.mp4Url || ep.link || '').trim();
          return {
            ...ep,
            number: Number(ep.number) || 1,
            telegramUrl: videoLink || anime.telegramUrl || '',
            url: videoLink || anime.telegramUrl || '',
            videoUrl: videoLink || anime.telegramUrl || '',
            mp4Url: videoLink || anime.telegramUrl || '',
            link: videoLink || anime.telegramUrl || ''
          };
        })
        .filter(ep => Boolean(ep.telegramUrl));
      if (parsed.length > 0) return parsed;
    }
    return anime.telegramUrl
      ? [{ number: 1, telegramUrl: anime.telegramUrl, url: anime.telegramUrl, videoUrl: anime.telegramUrl, mp4Url: anime.telegramUrl, link: anime.telegramUrl }]
      : [];
  }, [anime.episodes, anime.telegramUrl]);

  const currentEpisode = useMemo(() => {
    if (activeEpisodeNum !== null && activeEpisodeNum !== undefined) {
      const match = displayEpisodes.find(ep => Number(ep.number) === Number(activeEpisodeNum));
      if (match) return match;
    }
    return displayEpisodes[0] || {
      number: activeEpisodeNum || 1,
      telegramUrl: anime.telegramUrl || '',
      url: anime.telegramUrl || '',
      mp4Url: anime.telegramUrl || '',
      link: anime.telegramUrl || ''
    };
  }, [displayEpisodes, activeEpisodeNum, anime.telegramUrl]);

  // Expanded modal state
  const [isPlayerExpanded, setIsPlayerExpanded] = useState<boolean>(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState<boolean>(false);
  const [isVideoPaused, setIsVideoPaused] = useState<boolean>(true);

  // Computed video URL for current episode
  const rawVideoUrl = useMemo(() => {
    if (!currentEpisode) return (anime.telegramUrl || '').trim();
    return (currentEpisode.telegramUrl || currentEpisode.url || currentEpisode.videoUrl || currentEpisode.mp4Url || currentEpisode.link || anime.telegramUrl || '').trim();
  }, [currentEpisode, anime.telegramUrl]);

  const isTelegramUrl = useMemo(() => {
    return rawVideoUrl.toLowerCase().includes('t.me/');
  }, [rawVideoUrl]);

  const directVideoUrl = useMemo(() => {
    if (!rawVideoUrl) return '';
    let url = rawVideoUrl;
    if (url.includes('archive.org')) {
      if (url.includes('archive.org/details/')) {
        url = url.replace('archive.org/details/', 'archive.org/download/');
      } else if (url.includes('archive.org/embed/')) {
        url = url.replace('archive.org/embed/', 'archive.org/download/');
      }
      url = url.replace(/[?&]autoplay=1/g, '');
    }
    // Encode spaces safely so HTML5 video element never fails on unencoded file paths
    if (url.includes(' ')) {
      url = url.replace(/ /g, '%20');
    }
    return url;
  }, [rawVideoUrl]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerWrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const savedTimeRef = useRef<number>(0);

  // Monitor browser fullscreen state change
  useEffect(() => {
    const handleFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    document.addEventListener('webkitfullscreenchange', handleFSChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFSChange);
      document.removeEventListener('webkitfullscreenchange', handleFSChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!playerWrapperRef.current) return;
    if (!document.fullscreenElement) {
      const elem = playerWrapperRef.current as any;
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => {});
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

  // Quick skip helper (+10s / -10s)
  const handleSkip10 = (seconds: number) => {
    if (videoRef.current) {
      try {
        const total = videoRef.current.duration || 0;
        const target = Math.max(0, Math.min(total, videoRef.current.currentTime + seconds));
        savedTimeRef.current = target;
        videoRef.current.currentTime = target;
      } catch (err) {
        console.warn("Skip error:", err);
      }
    }
  };

  // Reset saved time and trigger autoplay on URL or episode change
  useEffect(() => {
    savedTimeRef.current = 0;
    if (isPlayerOpen) {
      const attemptPlay = () => {
        if (videoRef.current) {
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play().catch(() => {});
              }
            });
          }
        }
      };
      attemptPlay();
      const timer = setTimeout(attemptPlay, 200);
      return () => clearTimeout(timer);
    }
  }, [directVideoUrl, currentEpisode?.number, isPlayerOpen]);

  // Lock body scroll when player modal is open so it renders perfectly centered
  useEffect(() => {
    if (isPlayerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isPlayerOpen]);

  // Robust image fallback state matching GalleryCard
  const initialSrc = processImageSrc(anime, studio?.name);
  const [imageSrc, setImageSrc] = useState<string>(initialSrc);
  const [retryCount, setRetryCount] = useState<number>(0);
  const initialInstant = initialSrc.startsWith('data:') || globalImageCache.has(initialSrc);
  const [isLoaded, setIsLoaded] = useState<boolean>(initialInstant);
  const posterImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const src = processImageSrc(anime, studio?.name);
    if (src !== imageSrc) {
      setImageSrc(src);
      setRetryCount(0);
      const instant = src.startsWith('data:') || globalImageCache.has(src);
      setIsLoaded(instant);
    } else if (src.startsWith('data:') || globalImageCache.has(src)) {
      setIsLoaded(true);
    }
  }, [anime.image, anime.coverData, anime.id, studio?.name, imageSrc]);

  // Instantly verify if image is complete in browser cache or when player closes
  useEffect(() => {
    if (posterImgRef.current && posterImgRef.current.complete && posterImgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, [imageSrc, isPlayerOpen]);

  const handleLoad = () => {
    if (imageSrc) globalImageCache.add(imageSrc);
    setIsLoaded(true);
  };

  const handleError = () => {
    if (retryCount === 0) {
      setRetryCount(1);
      if (anime.coverData && anime.coverData.startsWith('data:image/') && imageSrc !== anime.coverData) {
        setImageSrc(anime.coverData);
        setIsLoaded(true);
        return;
      }
      if (anime.id) {
        const nextSrc = `/covers/${anime.id}.webp`;
        setImageSrc(nextSrc);
        if (globalImageCache.has(nextSrc)) setIsLoaded(true);
        return;
      }
    }

    if (retryCount === 1) {
      setRetryCount(2);
      if (anime.id) {
        setImageSrc(`/api/covers/${anime.id}.webp`);
        return;
      }
    }

    // Fallback final: Póster generado en SVG (garantiza que nunca quede roto)
    const svgFallback = getFallbackSvg(anime.name, studio?.name);
    setImageSrc(svgFallback);
    setIsLoaded(true);
  };

  // Watched state
  const [isWatched, setIsWatched] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('kh_watched_list');
      const list: string[] = raw ? JSON.parse(raw) : [];
      return list.includes(anime.id);
    } catch {
      return false;
    }
  });

  const handleToggleWatched = () => {
    setIsWatched(prev => {
      const next = !prev;
      try {
        const raw = localStorage.getItem('kh_watched_list');
        const list: string[] = raw ? JSON.parse(raw) : [];
        const updated = next
          ? Array.from(new Set([...list, anime.id]))
          : list.filter(id => id !== anime.id);
        localStorage.setItem('kh_watched_list', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('kh_watched_updated', { detail: { animeId: anime.id, isWatched: next } }));
      } catch (e) {}
      return next;
    });
  };

  // Rating stats and popover state
  const [ratingStats, setRatingStats] = useState<RatingStats>(() => getAnimeRatingStats(anime.id));
  const [isRatingOpen, setIsRatingOpen] = useState<boolean>(false);
  const ratingPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRatingStats(getAnimeRatingStats(anime.id));
    const handleRatingUpdate = (e: Event) => {
      const customEv = e as CustomEvent;
      if (!customEv.detail?.animeId || customEv.detail.animeId === anime.id) {
        setRatingStats(getAnimeRatingStats(anime.id));
      }
    };
    window.addEventListener('kh_rating_updated', handleRatingUpdate);
    return () => window.removeEventListener('kh_rating_updated', handleRatingUpdate);
  }, [anime.id]);

  useEffect(() => {
    if (!isRatingOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ratingPopRef.current && !ratingPopRef.current.contains(e.target as Node)) {
        setIsRatingOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRatingOpen]);

  const handleVoteRating = (score: number) => {
    if (!auth.currentUser) {
      window.dispatchEvent(new CustomEvent('kh_open_auth_modal'));
      return;
    }
    const { stats, error } = submitAnimeVote(anime.id, score);
    if (!error && stats) {
      setRatingStats(stats);
    }
  };

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden py-6 sm:py-10 px-4 sm:px-6 lg:px-8">
      {/* Immersive Full-Screen Fixed Cover Photo: Solo en tema violeta oscuro (en tema negro no sale la imagen de fondo) */}
      {appTheme !== 'black' && (
        <div className="fixed inset-0 w-full h-full pointer-events-none z-0 overflow-hidden select-none">
          {imageSrc && (
            <img
              src={imageSrc}
              alt={anime.name}
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover object-center transition-opacity duration-700 ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}
          {/* Cinematic gradient & dark overlay to guarantee 100% legibility of text, buttons and cards */}
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#09060f] via-[#09060f]/75 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-[#09060f]/90" />
        </div>
      )}

      {/* Content Container */}
      <div className="relative max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1600px] mx-auto z-10">
        {/* Back Button - Slightly larger for improved ergonomics */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a la galería"
          title="Volver"
          className="group inline-flex items-center justify-center mb-6 sm:mb-8 text-neutral-300 hover:text-white transition-all duration-200 cursor-pointer touch-manipulation active:scale-95 bg-black/60 hover:bg-black/80 backdrop-blur-md w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-white/10 hover:border-brand-red/50 shadow-lg"
        >
          <ArrowLeft className="h-5 w-5 sm:h-5.5 sm:w-5.5 transition-transform duration-200 group-hover:-translate-x-0.5 shrink-0 text-brand-red" />
        </button>

        {/* Content Box */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Column Left: High-end Poster Card Frame */}
          <div className="md:col-span-4 lg:col-span-4 justify-self-center w-full max-w-[280px] sm:max-w-[320px] md:max-w-none">
            <div 
              className="relative rounded-2xl overflow-hidden bg-neutral-900/80 backdrop-blur-md border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.8)] aspect-[2/3] bg-cover bg-center"
              style={{ backgroundImage: `url("${getFallbackSvg(anime.name, studio?.name)}")` }}
            >
              {imageSrc && (
                <img
                  ref={posterImgRef}
                  src={imageSrc}
                  alt={anime.name}
                  loading="eager"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onLoad={handleLoad}
                  onError={handleError}
                  className={`w-full h-full object-cover relative z-10 transition-opacity duration-500 ease-out ${
                    isLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
              {!isLoaded && (
                <div className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse pointer-events-none" />
              )}
              <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
            </div>
          </div>

          {/* Column Right: Elegant Minimal Typographic Block */}
          <div className="md:col-span-8 lg:col-span-8 space-y-6">
            <div>
              {/* Studio Accent */}
              {animeStudios.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {animeStudios.map((st, idx) => (
                    <React.Fragment key={st.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectStudio) {
                            onSelectStudio(st.id);
                          }
                        }}
                        className="font-mono text-[11px] font-semibold text-brand-red uppercase tracking-wider hover:underline hover:text-[#ff3b75] transition-colors cursor-pointer text-left"
                        title={`Ver todas las portadas de ${st.name}`}
                      >
                        {st.name}
                      </button>
                      {idx < animeStudios.length - 1 && (
                        <span className="text-neutral-500 font-mono text-[11px]">/</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              ) : studio ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectStudio) {
                      onSelectStudio(studio.id);
                    }
                  }}
                  className="font-mono text-[11px] font-semibold text-brand-red uppercase tracking-wider block mb-2 hover:underline hover:text-[#ff3b75] transition-colors cursor-pointer text-left"
                  title={`Ver todas las portadas de ${studio.name}`}
                >
                  {studio.name}
                </button>
              ) : (
                <span className="font-mono text-[11px] font-semibold text-brand-red uppercase tracking-wider block mb-2">
                  ESTUDIO INDEPENDIENTE
                </span>
              )}
              
              {/* Anime Title */}
              <h1 className="font-display font-bold text-lg sm:text-xl lg:text-2xl text-white tracking-tight leading-snug">
                {anime.name}
              </h1>
            </div>

            {/* Micro Metadata Metrics & Actions Row - Refined compact proportions */}
            <div className="flex items-center gap-1.5 sm:gap-2 py-1 my-1 max-w-full overflow-x-auto sm:overflow-visible scrollbar-none whitespace-nowrap select-none">
              {/* 1. Year */}
              {anime.year && (
                <div className="flex items-center justify-center shrink-0 pr-0.5">
                  <span className="font-sans text-[11px] sm:text-xs font-extrabold text-white tracking-tight leading-none">
                    {normalizeAnimeYear(anime.year)}
                  </span>
                </div>
              )}

              {/* Status Badge - Después del año, más pequeña, verde en emisión, alineada perfectamente */}
              <div className="shrink-0 flex items-center -translate-y-0.5">
                <span className={`h-5 px-1.5 sm:px-2 rounded-md text-[9px] sm:text-[10px] font-sans font-bold tracking-tight border inline-flex items-center justify-center leading-none shadow-sm ${
                  isEmision 
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10' 
                    : 'bg-neutral-800/70 text-neutral-300 border-neutral-700/50 shadow-sm'
                }`}>
                  {statusLabel}
                </span>
              </div>
              
              {/* Rating Box Button - Horizontal pill matching row height (h-7 sm:h-8) and slightly longer left-to-right */}
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIsRatingOpen(true)}
                  title="Calificar anime"
                  className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-xl bg-[#161226] hover:bg-[#201938] border border-[#2e214d] hover:border-purple-500/60 shadow-sm inline-flex items-center gap-1 cursor-pointer active:scale-95 transition-all duration-200 group shrink-0"
                >
                  <Star 
                    className={`h-3 w-3 sm:h-3.5 sm:w-3.5 transition-colors shrink-0 ${
                      ratingStats.userVote ? 'text-amber-400 fill-amber-400' : 'text-neutral-300 group-hover:text-white'
                    }`} 
                    strokeWidth={1.8} 
                  />
                  <span className="font-mono text-[9.5px] sm:text-[10.5px] font-bold text-white leading-none">
                    {ratingStats.average > 0 ? ratingStats.average.toFixed(1) : '0.0'}
                  </span>
                </button>
              </div>

              {/* 4. Mi Lista Button */}
              {onToggleMyList && (
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleMyList(anime.id)}
                    title={isSaved ? "Quitar de mi lista" : "Agregar a mi lista"}
                    className={`h-7 sm:h-8 px-2 sm:px-2.5 inline-flex items-center gap-1 rounded-xl transition-all duration-200 cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                      isSaved
                        ? 'bg-[#1b152e] text-white border border-[#442e6d] shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                        : 'bg-[#161226] hover:bg-[#201938] text-white border border-[#2e214d] hover:border-purple-500/50'
                    }`}
                  >
                    {isSaved ? (
                      <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-400 stroke-[3] shrink-0" />
                    ) : (
                      <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white stroke-[2.5] shrink-0" />
                    )}
                    <span className="font-sans text-[10px] sm:text-[11px] font-semibold tracking-tight">Mi lista</span>
                  </button>
                </div>
              )}

              {/* 5. Visto Button */}
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (onToggleWatched) {
                      onToggleWatched(anime.id);
                    } else {
                      handleToggleWatched();
                    }
                  }}
                  title={(isWatchedProp !== undefined ? isWatchedProp : isWatched) ? "Marcar como no visto" : "Marcar como visto"}
                  className={`h-7 sm:h-8 px-2 sm:px-2.5 inline-flex items-center gap-1 rounded-xl transition-all duration-200 cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                    (isWatchedProp !== undefined ? isWatchedProp : isWatched)
                      ? 'bg-[#1e1537] text-purple-200 border border-purple-500/60 shadow-[0_0_10px_rgba(168,85,247,0.25)]'
                      : 'bg-[#161226] hover:bg-[#201938] text-white border border-[#2e214d] hover:border-purple-500/50'
                  }`}
                >
                  {(isWatchedProp !== undefined ? isWatchedProp : isWatched) ? (
                    <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-purple-400 stroke-[2] shrink-0" />
                  ) : (
                    <EyeOff className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-neutral-300 stroke-[2] shrink-0" />
                  )}
                  <span className="font-sans text-[10px] sm:text-[11px] font-semibold tracking-tight">Visto</span>
                </button>
              </div>

              {/* 6. Download Button - Ultra-compact pill */}
              <div className="shrink-0">
                <a
                  href={anime.telegramUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Descargar"
                  onClick={() => {
                    if (onDownload) {
                      onDownload(anime.id);
                    }
                  }}
                  className="h-7 sm:h-8 px-1 sm:px-1.5 inline-flex items-center gap-0.5 rounded-xl bg-[#ff3366] hover:bg-[#ff1f57] text-white transition-all duration-200 shadow-md shadow-[#ff3366]/35 active:scale-95 cursor-pointer shrink-0"
                >
                  <Download className="h-2.5 w-2.5 sm:h-3 sm:w-3 stroke-[2.5]" />
                  <span className="font-sans text-[8px] sm:text-[9px] font-semibold tracking-tight">Descarga</span>
                </a>
              </div>
            </div>

            {/* Crunchyroll-style Anime Rating Modal Window */}
            <AnimeRatingModal
              isOpen={isRatingOpen}
              onClose={() => setIsRatingOpen(false)}
              anime={anime}
              studioName={studio?.name}
            />

            {/* Genres List */}
            <div className="flex flex-wrap gap-1.5">
              {animeGenres.map(genre => (
                <button
                  key={genre.id}
                  onClick={() => {
                    if (onSelectGenre) {
                      onSelectGenre(genre.id);
                    }
                  }}
                  className="px-2.5 py-1 bg-black/60 backdrop-blur-md border border-white/15 hover:border-[#ff5588]/80 hover:text-white transition-colors duration-300 rounded-lg text-[10px] font-mono text-neutral-300 cursor-pointer tracking-tight shadow-sm"
                >
                  {genre.name}
                </button>
              ))}
            </div>

            {/* Description/Sinopsis */}
            <div>
              <div className="max-h-[5.5rem] overflow-y-auto bg-black/60 backdrop-blur-md border border-white/15 rounded-xl p-3 text-xs text-neutral-200 font-sans leading-relaxed scrollbar-thin scrollbar-thumb-neutral-700 shadow-inner">
                {anime.description || 'No hay descripción disponible para esta obra en el archivo.'}
              </div>
            </div>

            {/* Sección de Episodios */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center">
                <h3 className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest">
                  {displayEpisodes.length} {displayEpisodes.length === 1 ? 'Episodio' : 'Episodios'}
                </h3>
              </div>

              {displayEpisodes.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                  {displayEpisodes.map((ep) => {
                    const isActive = Number(ep.number) === Number(activeEpisodeNum);
                    const epCover = ep.thumbnail || ep.coverImage || anime.coverData || anime.image;

                    return (
                      <div
                        key={ep.number}
                        onClick={() => {
                          setActiveEpisodeNum(ep.number);
                          setIsPlayerOpen(true);
                          if (onDownload) {
                            onDownload(anime.id);
                          }
                        }}
                        className={`group relative aspect-video w-full rounded-xl overflow-hidden cursor-pointer transition-all duration-200 shadow-md select-none active:scale-[0.98] hover:opacity-95 outline-none ${
                          isActive ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-black' : 'border-0'
                        }`}
                      >
                        {/* Episode Thumbnail */}
                        {epCover ? (
                          <img
                            src={epCover}
                            alt={`Episodio ${ep.number}`}
                            loading="eager"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              e.currentTarget.src = getFallbackSvg(anime.name);
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-[#150a24] flex items-center justify-center">
                            <Film className="h-6 w-6 text-purple-400/40" />
                          </div>
                        )}

                        {/* Subtle dark gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20 pointer-events-none" />

                        {/* Compact, rounded and uniform EP badge */}
                        <div className="absolute top-1.5 left-1.5 h-4.5 min-w-[34px] px-1.5 rounded-full bg-black/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-sm">
                          <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-white tracking-tight uppercase leading-none">
                            EP {ep.number}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-black/20 border border-dark-border/40 rounded-2xl font-mono text-xs text-neutral-500 text-center">
                  Próximamente episodios
                </div>
              )}

                  {/* Sección de Recomendaciones */}
                  {recommendedAnimes.length > 0 && (
                    <div className="space-y-2 pt-2 mt-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest">
                          Recomendaciones
                        </h3>
                      </div>

                      <div className="grid grid-cols-3 gap-0.5 sm:gap-1 w-full pt-1">
                        {recommendedAnimes.map((rec) => {
                          const sIds = (rec.studioIds && rec.studioIds.length > 0)
                            ? rec.studioIds
                            : (rec.studioId ? [rec.studioId] : []);
                          const recStudio = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';

                          return (
                            <button
                              key={rec.id}
                              type="button"
                              onClick={() => {
                                if (onSelectAnime) {
                                  onSelectAnime(rec.id);
                                } else {
                                  window.location.href = `/?anime=${rec.id}`;
                                }
                              }}
                              title={rec.name}
                              className="group relative aspect-[2/3] bg-neutral-900 rounded-xl overflow-hidden border border-[#272236] hover:border-brand-red/70 transition-all duration-300 hover:scale-[1.03] shadow-md hover:shadow-lg hover:shadow-brand-red/10 cursor-pointer block p-0 text-left"
                            >
                              <SmartAnimeCover
                                anime={rec}
                                studioName={recStudio}
                                alt={rec.name}
                                loading="eager"
                                priority={true}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              {/* Subtle title overlay at bottom */}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1.5 sm:p-2 pt-4 pointer-events-none">
                                <p className="font-display text-xs sm:text-[13px] text-white font-medium truncate group-hover:text-brand-red transition-colors leading-tight">
                                  {rec.name}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Capa Flotante del Reproductor Interno de Video (Modal Portal en centro de pantalla) */}
                  {createPortal(
                    <AnimatePresence>
                      {isPlayerOpen && currentEpisode && (
                        <motion.div
                          key="video-player-backdrop"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.28, ease: "easeOut" }}
                          className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md touch-pan-y"
                        >
                          {/* Control de Cierre al tocar el fondo */}
                          <div 
                            className="absolute inset-0 z-0" 
                            onClick={() => setIsPlayerOpen(false)} 
                          />

                          <motion.div
                            key="video-player-card"
                            initial={{ scale: 0.94, opacity: 0, y: 14 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.94, opacity: 0, y: 14 }}
                            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                            className={`relative z-10 w-full ${isPlayerExpanded ? 'max-w-[96vw]' : 'max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[1500px]'} bg-neutral-950 border-0 rounded-2xl p-2.5 sm:p-4 shadow-2xl flex flex-col gap-2.5 max-h-[95vh] overflow-y-auto my-auto transition-all duration-300 touch-pan-y outline-none`}
                          >
                        
                        {/* Encabezado Limpio del Reproductor: Título y Controles del Pantalla Completa */}
                        <div className="flex items-center justify-between pb-2 border-b border-white/10 px-1">
                          <div className="min-w-0 flex items-center gap-2">
                            <h2 className="font-display text-sm sm:text-base font-semibold text-white truncate leading-tight">
                              {anime.name}
                            </h2>
                            <span className="shrink-0 px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-800/60 font-mono text-[10px] font-bold text-purple-300">
                              EP #{currentEpisode?.number || 1}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Botón Pantalla Completa Limpia */}
                            <button
                              type="button"
                              onClick={toggleFullscreen}
                              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                              title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                            >
                              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                            </button>

                            {/* Botón de Cierre */}
                            <button
                              type="button"
                              onClick={() => {
                                if (document.fullscreenElement) {
                                  document.exitFullscreen().catch(() => {});
                                }
                                setIsPlayerOpen(false);
                              }}
                              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                              title="Cerrar reproductor"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        {/* Contenedor del Reproductor con Barras Negras Tipo Cine / Más Cuadrado y Limpio */}
                        <div 
                          ref={playerWrapperRef}
                          className={`relative w-full ${
                            isFullscreen
                              ? 'fixed inset-0 z-[100000] w-screen h-screen rounded-none border-0 p-0 m-0 bg-black'
                              : isPlayerExpanded 
                                ? 'max-h-[85vh] aspect-[4/3] sm:aspect-[16/10] lg:aspect-[16/10] mx-auto rounded-2xl border-0 shadow-2xl' 
                                : 'aspect-[4/3] sm:aspect-[16/10] lg:aspect-[16/10] rounded-2xl border-0 shadow-2xl'
                          } bg-black overflow-hidden flex flex-col items-center justify-center select-none group border-0 outline-none`}
                          onContextMenu={(e) => e.preventDefault()}
                        >
                          {/* Botón Flotante para Salir de Pantalla Completa en overlay */}
                          {isFullscreen && (
                            <div className="absolute top-4 right-4 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-neutral-800">
                              <span className="text-xs text-white font-medium">{anime.name} - Ep {currentEpisode?.number || 1}</span>
                              <button
                                type="button"
                                onClick={toggleFullscreen}
                                className="p-1 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                                title="Salir de pantalla completa"
                              >
                                <Minimize2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}

                          <div className="w-full h-full flex flex-col justify-center items-center bg-black relative overflow-hidden p-0 m-0 border-0 outline-none">
                            {isTelegramUrl ? (
                              <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[#0a0712] text-center space-y-4">
                                <div className="w-16 h-16 rounded-2xl bg-[#0088cc]/20 border border-[#0088cc]/40 flex items-center justify-center text-[#0088cc] shadow-lg shadow-[#0088cc]/10">
                                  <Tv className="h-8 w-8" />
                                </div>
                                <div className="space-y-1.5 max-w-md">
                                  <h3 className="font-display font-bold text-white text-base sm:text-lg">
                                    Episodio #{currentEpisode?.number || 1} en Telegram
                                  </h3>
                                  <p className="text-xs text-neutral-400 font-sans leading-relaxed">
                                    Este episodio está alojado directamente en el canal oficial de Telegram para reproducción en streaming o descarga a máxima calidad.
                                  </p>
                                </div>
                                <a
                                  href={rawVideoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0088cc] to-[#0099e6] hover:from-[#0099e6] hover:to-[#00aaff] text-white font-mono text-xs font-bold uppercase tracking-wider shadow-lg shadow-[#0088cc]/30 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  <span>Abrir en Telegram</span>
                                </a>
                              </div>
                            ) : !rawVideoUrl ? (
                              <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-[#0a0712] text-center space-y-3">
                                <Film className="h-10 w-10 text-neutral-600" />
                                <p className="text-xs text-neutral-400 font-mono">
                                  No hay enlace de video disponible para el Episodio #{currentEpisode?.number || 1}.
                                </p>
                              </div>
                            ) : (
                              <div className="relative w-full h-full flex items-center justify-center bg-black group">
                                <video
                                  ref={videoRef}
                                  key={directVideoUrl + (currentEpisode?.number || 1)}
                                  src={directVideoUrl}
                                  controls
                                  autoPlay
                                  playsInline
                                  preload="auto"
                                  controlsList="nodownload noplaybackrate"
                                  onPlay={() => {
                                    setIsVideoPaused(false);
                                    setVideoPlaybackError(false);
                                  }}
                                  onPause={() => setIsVideoPaused(true)}
                                  onError={() => setVideoPlaybackError(true)}
                                  onContextMenu={(e) => e.preventDefault()}
                                  onLoadedMetadata={() => {
                                    if (videoRef.current) {
                                      videoRef.current.play().catch(() => {});
                                    }
                                  }}
                                  style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
                                  className="w-full aspect-video max-h-full object-contain bg-black select-none pointer-events-auto block m-0 p-0"
                                />

                                {/* Fallback error overlay */}
                                {videoPlaybackError && (
                                  <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-4 text-center space-y-3 z-30">
                                    <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-800/60 flex items-center justify-center text-red-400">
                                      <Film className="h-6 w-6" />
                                    </div>
                                    <p className="text-xs text-neutral-300 font-mono max-w-sm">
                                      No se pudo reproducir automáticamente el video del Episodio #{currentEpisode?.number || 1}.
                                    </p>
                                    <div className="flex items-center gap-2 pt-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVideoPlaybackError(false);
                                          if (videoRef.current) {
                                            videoRef.current.load();
                                            videoRef.current.play().catch(() => {});
                                          }
                                        }}
                                        className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-mono font-bold cursor-pointer transition-all active:scale-95 shadow-md"
                                      >
                                        Reintentar
                                      </button>
                                      <a
                                        href={directVideoUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-mono cursor-pointer transition-all"
                                      >
                                        Abrir enlace directo
                                      </a>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Lista de Episodios en Cuadrícula de 2 Columnas */}
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9.5px] text-neutral-400 uppercase tracking-widest">
                              EPISODIOS ({displayEpisodes.length})
                            </span>
                          </div>

                          {/* Cuadrícula de 2 Columnas */}
                          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 max-h-56 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900/60 scrollbar-track-transparent">
                            {displayEpisodes.map((ep) => {
                              const isActive = ep.number === (currentEpisode?.number || 1);
                              const epCover = ep.thumbnail || ep.coverImage || anime.coverData || anime.image;

                              return (
                                <div
                                  key={ep.number}
                                  onClick={() => setActiveEpisodeNum(ep.number)}
                                  className="group relative aspect-video w-full rounded-xl overflow-hidden cursor-pointer transition-all duration-200 shadow-md select-none active:scale-[0.98] hover:opacity-95 border-0 outline-none"
                                >
                                  {epCover ? (
                                    <img
                                      src={epCover}
                                      alt={`Episodio ${ep.number}`}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                      onError={(e) => {
                                        e.currentTarget.src = getFallbackSvg(anime.name);
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-[#150a24] flex items-center justify-center">
                                      <Film className="h-6 w-6 text-purple-400/40" />
                                    </div>
                                  )}

                                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20 pointer-events-none" />

                                  <div className="absolute top-1.5 left-1.5 h-4.5 min-w-[34px] px-1.5 rounded-full bg-black/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-sm">
                                    <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-white tracking-tight uppercase leading-none">
                                      EP {ep.number}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                          </motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>,
                    document.body
                  )}
                </div>
              </div>

          {/* Global Comments Section for this Anime */}
          <div className="col-span-1 md:col-span-12 mt-8">
            <GlobalComments 
              animeId={anime.id} 
              animeTitle={anime.name} 
              className="bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl" 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
