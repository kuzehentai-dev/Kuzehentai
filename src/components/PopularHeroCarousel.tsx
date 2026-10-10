import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Plus, Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Anime, Studio, Genre } from '../types';
import { SmartAnimeCover } from '../utils/imageFallback';

interface PopularHeroCarouselProps {
  animes: Anime[];
  studios: Studio[];
  genres: Genre[];
  onSelectAnime: (animeId: string) => void;
  savedAnimeIds?: string[];
  onToggleMyList?: (animeId: string) => void;
  loading?: boolean;
}

export default function PopularHeroCarousel({
  animes,
  studios,
  genres,
  onSelectAnime,
  savedAnimeIds = [],
  onToggleMyList,
  loading = false,
}: PopularHeroCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Swipe / Drag and Tap detection
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number>(0);
  const touchMoved = useRef(false);
  const pointerStartX = useRef<number | null>(null);
  const pointerStartY = useRef<number | null>(null);
  const hasMoved = useRef(false);
  const lastActionTime = useRef<number>(0);

  const total = animes.length;

  // Auto-advance every 5.5 seconds if not paused
  useEffect(() => {
    if (total <= 1 || isPaused) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % total);
    }, 5500);

    return () => clearInterval(interval);
  }, [total, isPaused]);

  // Reset index if out of bounds
  useEffect(() => {
    if (currentIndex >= total && total > 0) {
      setCurrentIndex(0);
    }
  }, [currentIndex, total]);

  const handleNext = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const handlePrev = useCallback(() => {
    if (total <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const currentAnime = useMemo(() => {
    return animes[currentIndex] || animes[0] || null;
  }, [animes, currentIndex]);

  const studioName = useMemo(() => {
    if (!currentAnime) return 'Anime';
    const sIds = (currentAnime.studioIds && currentAnime.studioIds.length > 0)
      ? currentAnime.studioIds
      : (currentAnime.studioId ? [currentAnime.studioId] : []);
    const st = studios.find((s) => sIds.includes(s.id));
    return st ? st.name : 'Estudio';
  }, [currentAnime, studios]);

  // Show at most 3 genres with concise names
  const genreNames = useMemo(() => {
    if (!currentAnime || !currentAnime.genreIds) return [];
    return currentAnime.genreIds
      .map((id) => genres.find((g) => g.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 3);
  }, [currentAnime, genres]);

  const isSaved = currentAnime ? savedAnimeIds.includes(currentAnime.id) : false;

  // Touch Swipe & Single-Tap handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsPaused(true);
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    touchMoved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartX.current;
    const deltaY = currentY - touchStartY.current;

    // Movement greater than 10px is considered swipe/drag, not a tap
    if (Math.hypot(deltaX, deltaY) > 10) {
      touchMoved.current = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current !== null && touchStartY.current !== null) {
      const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
      const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
      const deltaX = endX - touchStartX.current;
      const deltaY = endY - touchStartY.current;
      const distance = Math.hypot(deltaX, deltaY);
      const duration = Date.now() - touchStartTime.current;

      if (touchMoved.current && Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe to navigate carousel
        if (deltaX < -35) {
          handleNext();
        } else if (deltaX > 35) {
          handlePrev();
        }
      } else if (!touchMoved.current && distance <= 12 && duration < 500) {
        // Direct intentional single-tap on mobile
        const target = e.target as HTMLElement | null;
        const isInteractive = target?.closest('button') !== null;
        if (!isInteractive && currentAnime) {
          lastActionTime.current = Date.now();
          onSelectAnime(currentAnime.id);
        }
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchMoved.current = false;
    setIsPaused(false);
  };

  // Mouse Drag & Click handlers for desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    pointerStartX.current = e.clientX;
    pointerStartY.current = e.clientY;
    hasMoved.current = false;
    setIsPaused(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (pointerStartX.current === null || pointerStartY.current === null) return;
    const deltaX = e.clientX - pointerStartX.current;
    const deltaY = e.clientY - pointerStartY.current;
    if (Math.hypot(deltaX, deltaY) > 8) {
      hasMoved.current = true;
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (pointerStartX.current !== null && hasMoved.current) {
      const deltaX = e.clientX - pointerStartX.current;
      if (deltaX < -40) {
        handleNext();
      } else if (deltaX > 40) {
        handlePrev();
      }
    }
    pointerStartX.current = null;
    pointerStartY.current = null;
    setIsPaused(false);
  };

  // Unified single click on card
  const handleCardClick = (e: React.MouseEvent) => {
    // Avoid double triggering if touchEnd handled it
    if (Date.now() - lastActionTime.current < 450) {
      return;
    }
    // If dragging on desktop, do not trigger navigation
    if (hasMoved.current) {
      hasMoved.current = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }
    if (currentAnime) {
      lastActionTime.current = Date.now();
      onSelectAnime(currentAnime.id);
    }
  };

  if (loading) {
    return (
      <div className="w-full relative rounded-t-none rounded-b-2xl sm:rounded-b-3xl overflow-hidden bg-[#0a0515] border-t-0 border-x border-b border-[#2b1747]/60 aspect-[4/5.9] xs:aspect-[3/4.8] sm:aspect-[16/12.8] md:aspect-[16/11.2] lg:aspect-[16/9.8] min-h-[575px] sm:min-h-[645px] md:min-h-[680px] max-h-[820px] animate-pulse no-swipe">
        <div className="absolute inset-0 bg-gradient-to-t from-[#090514] via-[#090514]/30 to-transparent" />
        <div className="absolute bottom-5 left-5 right-5 space-y-2">
          <div className="h-6 w-52 bg-white/10 rounded-lg" />
          <div className="h-3.5 w-24 bg-purple-700/30 rounded-full" />
          <div className="h-3 w-64 bg-white/10 rounded" />
          <div className="flex gap-2 pt-1">
            <div className="h-8 w-28 bg-purple-600/40 rounded-lg" />
            <div className="h-8 w-8 bg-white/10 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!currentAnime || total === 0) {
    return null;
  }

  return (
    <div
      className="relative w-full select-none group no-swipe"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => {
        setIsPaused(false);
        pointerStartX.current = null;
        hasMoved.current = false;
      }}
    >
      {/* Crunchyroll-Style Hero Banner Card */}
      <div
        className="relative w-full rounded-t-none rounded-b-2xl sm:rounded-b-3xl overflow-hidden bg-[#0a0515] border-t-0 border-x border-b border-[#2b1747] shadow-xl shadow-black/70 aspect-[4/5.9] xs:aspect-[3/4.8] sm:aspect-[16/12.8] md:aspect-[16/11.2] lg:aspect-[16/9.8] min-h-[575px] sm:min-h-[645px] md:min-h-[680px] max-h-[820px] flex flex-col justify-end touch-pan-y cursor-pointer no-swipe"
        onClick={handleCardClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Animated Background Poster with Cross-fade - Cover extends all the way to top */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={currentAnime.id}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <SmartAnimeCover
              anime={currentAnime}
              studioName={studioName}
              alt={currentAnime.name}
              priority={true}
              loading="eager"
              className="w-full h-full object-cover object-[center_top] sm:object-[center_12%]"
            />
          </motion.div>
        </AnimatePresence>

        {/* Soft, Transparent Overlays */}
        {/* Bottom smooth gradient for high poster clarity and text readability */}
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#090514] via-[#090514]/75 to-transparent pointer-events-none z-[5]" />
        {/* Subtle left side vignette for wide desktop displays */}
        <div className="hidden sm:block absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#090514]/75 via-[#090514]/30 to-transparent pointer-events-none z-[5]" />

        {/* Hero Content Overlay: Compact info at bottom with Anime Title and 3 Genres */}
        <div className="relative z-10 p-3.5 sm:p-5 md:p-6 flex flex-col justify-end space-y-1.5 sm:space-y-2 max-w-2xl pointer-events-auto">
          {/* Anime Title: In lower section where it was before */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1
              key={`title-${currentAnime.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="text-base sm:text-xl md:text-2xl font-display font-bold text-white tracking-tight leading-snug drop-shadow hover:text-purple-300 transition-colors line-clamp-1"
              title={currentAnime.name}
            >
              {currentAnime.name}
            </motion.h1>
          </AnimatePresence>

          {/* Small Genre Tags (3 genres, small size) - Below title */}
          {genreNames.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {genreNames.map((gName, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-lg bg-[#1a0f30]/85 backdrop-blur-sm border border-purple-400/30 text-[9px] font-mono text-purple-200 uppercase tracking-wider"
                >
                  {gName}
                </span>
              ))}
            </div>
          )}

          {/* Synopsis: short single-line snippet */}
          {currentAnime.description && (
            <p className="text-[11px] sm:text-xs text-neutral-300/90 font-sans leading-relaxed line-clamp-1 max-w-lg drop-shadow">
              {currentAnime.description}
            </p>
          )}

          {/* Action Buttons: Violet styled ("VER AHORA" + "Mi Lista" + Vistas) */}
          <div className="flex items-center gap-2 pt-1">
            {/* Primary Violet "VER AHORA" Button (matches recuadro violeta) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectAnime(currentAnime.id);
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-gradient-to-r from-purple-700 to-purple-600 hover:from-purple-600 hover:to-purple-500 text-white font-mono font-bold text-[10px] sm:text-[11px] tracking-wider uppercase shadow-md border border-purple-400/40 active:scale-95 transition-all duration-200 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-white text-white shrink-0" />
              <span>VER AHORA</span>
            </button>

            {/* Bookmark / Mi Lista Button */}
            {onToggleMyList && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMyList(currentAnime.id);
                }}
                className={`inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border text-[10px] sm:text-[11px] font-mono font-semibold backdrop-blur-md active:scale-95 transition-all duration-200 cursor-pointer ${
                  isSaved
                    ? 'bg-purple-900/50 border-purple-400/60 text-purple-200 shadow-sm'
                    : 'bg-black/60 border-[#2b1747] hover:border-purple-500/40 text-neutral-300 hover:text-white hover:bg-white/5'
                }`}
                title={isSaved ? 'Quitar de Mi Lista' : 'Añadir a Mi Lista'}
                aria-label={isSaved ? 'Quitar de Mi Lista' : 'Añadir a Mi Lista'}
              >
                {isSaved ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-purple-300 stroke-[2.5]" />
                    <span className="hidden sm:inline">GUARDADO</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5 text-neutral-300 stroke-[2.5]" />
                    <span className="hidden sm:inline">MI LISTA</span>
                  </>
                )}
              </button>
            )}

            {/* Views counter */}
            {(currentAnime.downloads || 0) > 0 && (
              <div className="hidden xs:flex items-center gap-1 text-[10px] font-mono text-neutral-400 pl-1">
                <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
                <span>{currentAnime.downloads?.toLocaleString()} vistas</span>
              </div>
            )}
          </div>
        </div>

        {/* Previous / Next Chevron Buttons */}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/60 hover:bg-[#1a0f30] text-white/80 hover:text-purple-300 border border-purple-500/30 flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg active:scale-90 cursor-pointer"
              aria-label="Anterior anime popular"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black/60 hover:bg-[#1a0f30] text-white/80 hover:text-purple-300 border border-purple-500/30 flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg active:scale-90 cursor-pointer"
              aria-label="Siguiente anime popular"
            >
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </>
        )}

        {/* Bottom Pagination Indicators (Violet style) */}
        {total > 1 && (
          <div className="absolute bottom-2.5 right-3.5 sm:bottom-3.5 sm:right-5 z-20 flex items-center gap-1 p-1 rounded-md bg-[#090514]/80 backdrop-blur-md border border-[#2b1747]">
            {animes.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(idx);
                }}
                className={`transition-all duration-200 rounded-sm cursor-pointer ${
                  currentIndex === idx
                    ? 'w-5 h-1.5 bg-gradient-to-r from-purple-700 to-purple-500 shadow-sm border border-purple-400/50'
                    : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/70'
                }`}
                aria-label={`Ir al anime ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
