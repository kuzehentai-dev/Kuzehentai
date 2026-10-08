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

  // Swipe / Drag detection
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const pointerStartX = useRef<number | null>(null);
  const hasMoved = useRef(false);

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

  // Show at most 2 genres with concise names
  const genreNames = useMemo(() => {
    if (!currentAnime || !currentAnime.genreIds) return [];
    return currentAnime.genreIds
      .map((id) => genres.find((g) => g.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 2);
  }, [currentAnime, genres]);

  const isSaved = currentAnime ? savedAnimeIds.includes(currentAnime.id) : false;

  // Touch Swipe handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsPaused(true);
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping.current || touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartX.current;
    const deltaY = currentY - touchStartY.current;

    // If user is mostly scrolling vertically, abort horizontal swipe
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 25) {
      isSwiping.current = false;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isSwiping.current && touchStartX.current !== null) {
      const deltaX = (e.changedTouches[0]?.clientX || 0) - touchStartX.current;
      if (deltaX < -35) {
        handleNext();
      } else if (deltaX > 35) {
        handlePrev();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
    isSwiping.current = false;
    setIsPaused(false);
  };

  // Mouse Drag handlers for desktop swipe
  const handleMouseDown = (e: React.MouseEvent) => {
    pointerStartX.current = e.clientX;
    hasMoved.current = false;
    setIsPaused(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (pointerStartX.current === null) return;
    if (Math.abs(e.clientX - pointerStartX.current) > 10) {
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
    hasMoved.current = false;
    setIsPaused(false);
  };

  const handleCoverClick = () => {
    // If the user just finished dragging, don't trigger navigation
    if (hasMoved.current) return;
    if (currentAnime) {
      onSelectAnime(currentAnime.id);
    }
  };

  if (loading) {
    return (
      <div className="w-full relative rounded-2xl sm:rounded-3xl overflow-hidden bg-[#0a0515] border border-[#2b1747]/60 aspect-[4/5.5] xs:aspect-[3/4.5] sm:aspect-[16/11.8] md:aspect-[16/10.2] lg:aspect-[16/9] min-h-[530px] sm:min-h-[595px] md:min-h-[625px] max-h-[750px] animate-pulse no-swipe">
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
        className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden bg-[#0a0515] border border-[#2b1747] shadow-xl shadow-black/70 aspect-[4/5.5] xs:aspect-[3/4.5] sm:aspect-[16/11.8] md:aspect-[16/10.2] lg:aspect-[16/9] min-h-[530px] sm:min-h-[595px] md:min-h-[625px] max-h-[750px] flex flex-col justify-end touch-pan-y cursor-grab active:cursor-grabbing no-swipe"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Animated Background Poster with Cross-fade */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={currentAnime.id}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 w-full h-full"
            onClick={handleCoverClick}
          >
            <SmartAnimeCover
              anime={currentAnime}
              studioName={studioName}
              alt={currentAnime.name}
              priority={true}
              loading="eager"
              className="w-full h-full object-cover object-[center_20%] sm:object-[center_25%]"
            />
          </motion.div>
        </AnimatePresence>

        {/* Soft, Transparent Overlays - Designed to let the anime cover stay clearly visible */}
        {/* Bottom smooth gradient restricted to bottom 50% for high poster clarity */}
        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#090514] via-[#090514]/65 to-transparent pointer-events-none" />
        {/* Subtle left side vignette for wide desktop displays */}
        <div className="hidden sm:block absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#090514]/75 via-[#090514]/30 to-transparent pointer-events-none" />
        {/* Subtle top shade */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

        {/* Hero Content Overlay: Compact info to showcase cover */}
        <div className="relative z-10 p-3.5 sm:p-5 md:p-6 flex flex-col justify-end space-y-1.5 sm:space-y-2 max-w-2xl">
          {/* Anime Title: 1 line only so it leaves ample room for the cover */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1
              key={`title-${currentAnime.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              onClick={handleCoverClick}
              className="text-base sm:text-xl md:text-2xl font-display font-bold text-white tracking-tight leading-snug drop-shadow cursor-pointer hover:text-purple-300 transition-colors line-clamp-1"
              title={currentAnime.name}
            >
              {currentAnime.name}
            </motion.h1>
          </AnimatePresence>

          {/* Small Genre Tags (maximum 2, small size) - Below title */}
          {genreNames.length > 0 && (
            <div className="flex items-center gap-1.5">
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
              onClick={() => onSelectAnime(currentAnime.id)}
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
