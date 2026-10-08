/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Anime, Studio, normalizeAnimeYear } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Film, 
  Star, 
  MessageSquare, 
  Building2, 
  ChevronLeft, 
  ChevronRight, 
  ArrowUpDown 
} from 'lucide-react';
import { getAnimeRatingStats } from '../utils/ratingManager';
import { getFallbackSvg, preloadAllAnimes, prefetchCatalogPage } from '../utils/imageFallback';
import GalleryCard from './GalleryCard';

interface StudioDetailModalProps {
  key?: React.Key;
  studio: Studio;
  onClose: () => void;
  animes: Anime[];
  studios: Studio[];
  initialPage?: number;
  initialScrollY?: number;
  onSelectAnime: (animeId: string, page: number, scrollY: number) => void;
}

export default function StudioDetailModal({
  studio,
  onClose,
  animes,
  studios,
  initialPage = 1,
  initialScrollY = 0,
  onSelectAnime,
}: StudioDetailModalProps) {
  const [sortBy, setSortBy] = useState<
    'name-asc' | 'name-desc' | 'rating-desc' | 'rating-asc' | 'date-desc' | 'date-asc'
  >('date-desc');
  const [page, setPage] = useState(initialPage);
  const [pageDirection, setPageDirection] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const catalogTopRef = useRef<HTMLDivElement>(null);
  const ITEMS_PER_PAGE = 30;

  // Sync page state whenever initialPage changes
  useEffect(() => {
    setPage(initialPage);
  }, [initialPage, studio.id]);

  // Restore scroll position if provided
  useEffect(() => {
    if (initialScrollY > 0 && containerRef.current) {
      containerRef.current.scrollTop = initialScrollY;
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = initialScrollY;
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [initialScrollY, studio.id]);

  // Filter all animes associated with this studio
  const studioAnimes = useMemo(() => {
    return animes.filter((a) => {
      const sIds = (a.studioIds && a.studioIds.length > 0)
        ? a.studioIds
        : (a.studioId ? [a.studioId] : []);
      return sIds.includes(studio.id) || a.studioId === studio.id;
    });
  }, [studio, animes]);

  // Total votes across all animes of this studio
  const totalVotes = useMemo(() => {
    return studioAnimes.reduce((sum, a) => {
      const stats = getAnimeRatingStats(a.id);
      return sum + (stats?.totalVotes || 0);
    }, 0);
  }, [studioAnimes]);

  // Overall average rating across all animes of this studio (scale of 1 to 5 stars)
  const overallAverage = useMemo(() => {
    if (totalVotes === 0) return 0;
    const totalWeighted = studioAnimes.reduce((sum, a) => {
      const stats = getAnimeRatingStats(a.id);
      return sum + ((stats?.average || 0) * (stats?.totalVotes || 0));
    }, 0);
    return totalWeighted / totalVotes;
  }, [studioAnimes, totalVotes]);

  // Studio cover image: studio.image or first anime cover
  const studioCover = studio.image || studioAnimes[0]?.coverData || studioAnimes[0]?.image;

  // Sort studio animes based on user selection (defaults to newest date)
  const sortedStudioAnimes = useMemo(() => {
    const list = [...studioAnimes];
    return list.sort((a, b) => {
      if (sortBy === 'date-desc') {
        const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
        const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
        if (yearA !== yearB) return yearB - yearA;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.id || '').localeCompare(a.id || '');
      }
      if (sortBy === 'date-asc') {
        const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
        const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
        if (yearA !== yearB) return yearA - yearB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.id || '').localeCompare(b.id || '');
      }
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      }
      if (sortBy === 'name-desc') {
        return b.name.localeCompare(a.name, 'es', { sensitivity: 'base' });
      }
      if (sortBy === 'rating-desc') {
        const ratingA = getAnimeRatingStats(a.id)?.average || 0;
        const ratingB = getAnimeRatingStats(b.id)?.average || 0;
        if (ratingB !== ratingA) return ratingB - ratingA;
        const votesA = getAnimeRatingStats(a.id)?.totalVotes || 0;
        const votesB = getAnimeRatingStats(b.id)?.totalVotes || 0;
        return votesB - votesA;
      }
      if (sortBy === 'rating-asc') {
        const ratingA = getAnimeRatingStats(a.id)?.average || 0;
        const ratingB = getAnimeRatingStats(b.id)?.average || 0;
        if (ratingA !== ratingB) return ratingA - ratingB;
        const votesA = getAnimeRatingStats(a.id)?.totalVotes || 0;
        const votesB = getAnimeRatingStats(b.id)?.totalVotes || 0;
        return votesA - votesB;
      }
      return 0;
    });
  }, [studioAnimes, sortBy]);

  // Pagination calculations (30 items per page)
  const totalPages = Math.ceil(sortedStudioAnimes.length / ITEMS_PER_PAGE);
  const currentStudioAnimes = useMemo(() => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    return sortedStudioAnimes.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedStudioAnimes, page]);

  // Prioritize preloading the current visible page immediately, then remaining on idle
  useEffect(() => {
    if (currentStudioAnimes.length > 0) {
      preloadAllAnimes(currentStudioAnimes, studios);
    }
  }, [currentStudioAnimes, studios]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    setPageDirection(newPage > page ? 1 : -1);
    setPage(newPage);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    } else {
      catalogTopRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    }
  };

  // Gesto de deslizamiento (swipe) para cambiar de página o salir del apartado de estudio
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
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

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const isHorizontal = absX > absY * 0.82;
      const isFastFlick = absX >= 22 && duration < 240;
      const isStandardSwipe = absX >= 30 && duration < 700;

      if (isHorizontal && (isFastFlick || isStandardSwipe)) {
        if (deltaX > 0) {
          try {
            if (navigator.vibrate) navigator.vibrate(12);
          } catch {}
          if (page > 1) {
            handlePageChange(page - 1);
          } else {
            onClose();
          }
        } else if (deltaX < 0) {
          if (page < totalPages) {
            try {
              if (navigator.vibrate) navigator.vibrate(12);
            } catch {}
            handlePageChange(page + 1);
          }
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [page, totalPages, onClose]);

  // Smart Page Numbers generator identical to main page
  const getSmartPageNumbers = (current: number, total: number): number[] => {
    if (total <= 6) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = new Set<number>();
    let minNearby = current - 2;
    let maxNearby = current + 2;

    if (current <= 2) {
      minNearby = 1;
      maxNearby = Math.min(total, 4);
    } else if (current >= total - 1) {
      minNearby = Math.max(1, total - 3);
      maxNearby = total;
    }

    for (let i = Math.max(1, minNearby); i <= Math.min(total, maxNearby); i++) {
      pages.add(i);
    }

    const lowestNearby = Math.min(...Array.from(pages));
    const highestNearby = Math.max(...Array.from(pages));

    if (lowestNearby > 1) {
      let jumpBack = current - 6;
      if (jumpBack < 1 || lowestNearby - jumpBack <= 2) {
        jumpBack = 1;
      }
      pages.add(jumpBack);
    }

    if (highestNearby < total) {
      let jumpForward = current + 6;
      if (jumpForward > total || jumpForward - highestNearby <= 2) {
        jumpForward = total;
      }
      pages.add(jumpForward);
    }

    return Array.from(pages).sort((a, b) => a - b);
  };

  return (
    <div ref={containerRef} className="w-full min-h-screen bg-[#0c0517] overflow-y-auto flex flex-col text-white">
      {/* Botón flotante para volver (idéntico al de entrar a un anime, sin líneas divisorias, sin nombre ni X) */}
      <div className="p-4 sm:p-6 pb-2 max-w-5xl mx-auto w-full flex items-center">
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver"
          title="Volver"
          className="group inline-flex items-center justify-center text-neutral-300 hover:text-white transition-all duration-200 cursor-pointer touch-manipulation active:scale-95 bg-black/60 hover:bg-black/80 backdrop-blur-md w-10 h-10 sm:w-11 sm:h-11 rounded-full border border-white/10 hover:border-brand-red/50 shadow-lg"
        >
          <ArrowLeft className="h-5 w-5 transition-transform duration-200 group-hover:-translate-x-0.5 shrink-0 text-brand-red" />
        </button>
      </div>

      {/* Main Studio View Content: Todo unificado en el mismo espacio sin recuadros ni líneas divisorias */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-6 pt-0 space-y-6">
        {/* Cabecera del Estudio: Portada libre, más grande a la izquierda, información compacta con puntuación / 5 */}
        <div className="flex flex-row items-center sm:items-start gap-4 sm:gap-7 relative z-10 pt-2">
          {/* Portada del estudio libre y con esquinas redondeadas */}
          <div className="w-36 h-36 sm:w-56 sm:h-56 md:w-64 md:h-64 shrink-0 flex items-center justify-center relative select-none">
            {studioCover ? (
              <img
                src={studioCover}
                alt={studio.name}
                className="w-full h-full object-contain rounded-2xl sm:rounded-3xl drop-shadow-[0_10px_25px_rgba(0,0,0,0.6)] transition-transform duration-300 hover:scale-105"
                onError={(e) => {
                  e.currentTarget.src = getFallbackSvg(studio.name);
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-center p-3 rounded-2xl bg-purple-950/20">
                <Building2 className="h-14 w-14 sm:h-20 sm:w-20 text-purple-400 mb-2" />
                <span className="font-mono text-xs uppercase font-bold text-purple-300 truncate max-w-full">
                  {studio.name}
                </span>
              </div>
            )}
          </div>

          {/* Información a la derecha: nombre limpio y métricas en píldoras redondeadas */}
          <div className="flex-1 text-left space-y-2.5 min-w-0">
            <h1 className="text-base sm:text-lg md:text-xl font-display font-semibold text-white tracking-wide truncate">
              {studio.name}
            </h1>

            {/* Puntuación (escala sobre 5 estrellas) y Total de calificaciones en recuadros redondeados */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-0.5">
              {/* Puntuación general (máximo 5 estrellas) */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#180c2e] text-[11px] font-mono shadow-sm">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                <span className="text-[10px] text-purple-300/80">Puntuación:</span>
                <span className="font-bold text-amber-300">
                  {overallAverage > 0 ? overallAverage.toFixed(1) : 'S/C'}
                </span>
                <span className="text-[9px] text-neutral-400">/ 5</span>
              </div>

              {/* Total de calificaciones */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#180c2e] text-[11px] font-mono shadow-sm">
                <MessageSquare className="h-3 w-3 text-pink-400 shrink-0" />
                <span className="text-[10px] text-purple-300/80">Calificaciones:</span>
                <span className="font-bold text-white">
                  {totalVotes.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Studio Anime Catalog Section: Unificado, sin líneas divisorias */}
        <div className="space-y-4 pt-2">
          {/* Toolbar: Botón de organizar y recuadro de cantidad ambos redondeados (rounded-full) y a la misma altura */}
          <div 
            ref={catalogTopRef} 
            className="flex items-center justify-between gap-3 pb-1"
          >
            {/* Lado izquierdo: Selector para organizar animes compacto y con diseño idéntico al contador */}
            <div className="flex items-center">
              <div className="relative inline-flex items-center">
                <div className="h-6 sm:h-7 px-3 inline-flex items-center gap-1.5 rounded-full bg-[#180c2e] hover:bg-[#22103d] text-purple-200 font-mono text-[11px] sm:text-xs font-bold pointer-events-none select-none transition-colors">
                  <ArrowUpDown className="h-3 w-3 text-purple-400 shrink-0" />
                  <span>
                    {sortBy === 'name-asc'
                      ? 'A - Z'
                      : sortBy === 'name-desc'
                      ? 'Z - A'
                      : sortBy === 'rating-desc'
                      ? 'Puntos'
                      : sortBy === 'rating-asc'
                      ? 'Menor'
                      : sortBy === 'date-desc'
                      ? 'Nuevos'
                      : 'Antiguos'}
                  </span>
                  <ChevronRight className="h-3 w-3 rotate-90 text-purple-400 shrink-0" />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any);
                    setPage(1);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label="Organizar animes"
                >
                  <option value="name-asc">Nombre (A a Z)</option>
                  <option value="name-desc">Nombre (Z a A)</option>
                  <option value="rating-desc">Mayor Puntuación</option>
                  <option value="rating-asc">Menor Puntuación</option>
                  <option value="date-desc">Fecha (Más recientes)</option>
                  <option value="date-asc">Fecha (Más antiguos)</option>
                </select>
              </div>
            </div>

            {/* Lado derecho: Recuadro con esquinas redondeadas (rounded-full) solo con el número a la misma altura */}
            <div className="flex items-center">
              <span className="h-6 sm:h-7 px-3 inline-flex items-center justify-center rounded-full bg-[#180c2e] text-purple-200 font-mono text-[11px] sm:text-xs font-bold">
                {sortedStudioAnimes.length}
              </span>
            </div>
          </div>

          {/* Grid of animes: 3 columns con portadas de esquinas redondeadas */}
          {sortedStudioAnimes.length === 0 ? (
            <div className="text-center py-12 p-6 rounded-2xl text-neutral-400 space-y-2">
              <Film className="h-8 w-8 text-neutral-600 mx-auto" />
              <p className="font-mono text-xs">
                No hay animes registrados actualmente para este estudio.
              </p>
            </div>
          ) : (
            <>
              <div className="relative w-full overflow-hidden">
                <div
                  key={page}
                  className="grid grid-cols-3 gap-1.5 sm:gap-2.5 md:gap-3"
                >
                  {currentStudioAnimes.map((item, index) => (
                    <GalleryCard
                      key={item.id}
                      anime={item}
                      studios={studios}
                      onClick={() => {
                        const scrollY = containerRef.current ? containerRef.current.scrollTop : 0;
                        onSelectAnime(item.id, page, scrollY);
                      }}
                      index={index}
                    />
                  ))}
                </div>
              </div>

              {/* Barra para cambiar de página */}
              {totalPages > 1 && (() => {
                const pageNumbers = getSmartPageNumbers(page, totalPages);

                return (
                  <div className="flex items-center justify-center mt-4 pt-3 pb-2 font-mono">
                    <div className="flex items-center gap-2.5 sm:gap-4 overflow-x-auto scrollbar-none py-1 max-w-full justify-center">
                      {/* Previous Page Button */}
                      <button
                        onClick={() => handlePageChange(page - 1)}
                        onMouseEnter={() => page > 1 && prefetchCatalogPage(currentStudioAnimes, page - 1, ITEMS_PER_PAGE, studios)}
                        onTouchStart={() => page > 1 && prefetchCatalogPage(currentStudioAnimes, page - 1, ITEMS_PER_PAGE, studios)}
                        onPointerDown={() => page > 1 && prefetchCatalogPage(currentStudioAnimes, page - 1, ITEMS_PER_PAGE, studios)}
                        disabled={page === 1}
                        aria-label="Página anterior"
                        className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      {/* Page Numbers */}
                      {pageNumbers.map((pNum) => {
                        const isActive = pNum === page;

                        return (
                          <button
                            key={pNum}
                            onClick={() => handlePageChange(pNum)}
                            onMouseEnter={() => prefetchCatalogPage(currentStudioAnimes, pNum, ITEMS_PER_PAGE, studios)}
                            onTouchStart={() => prefetchCatalogPage(currentStudioAnimes, pNum, ITEMS_PER_PAGE, studios)}
                            onPointerDown={() => prefetchCatalogPage(currentStudioAnimes, pNum, ITEMS_PER_PAGE, studios)}
                            className={`px-2.5 sm:px-3.5 py-1.5 shrink-0 font-mono text-xs sm:text-sm tracking-wider transition-all duration-150 cursor-pointer select-none ${
                              isActive
                                ? 'text-[#ff5588] font-extrabold scale-110'
                                : 'text-white font-bold hover:text-[#ff5588] active:scale-95'
                            }`}
                          >
                            {pNum}
                          </button>
                        );
                      })}

                      {/* Next Page Button */}
                      <button
                        onClick={() => handlePageChange(page + 1)}
                        onMouseEnter={() => page < totalPages && prefetchCatalogPage(currentStudioAnimes, page + 1, ITEMS_PER_PAGE, studios)}
                        onTouchStart={() => page < totalPages && prefetchCatalogPage(currentStudioAnimes, page + 1, ITEMS_PER_PAGE, studios)}
                        onPointerDown={() => page < totalPages && prefetchCatalogPage(currentStudioAnimes, page + 1, ITEMS_PER_PAGE, studios)}
                        disabled={page === totalPages}
                        aria-label="Página siguiente"
                        className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
