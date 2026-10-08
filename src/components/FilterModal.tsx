/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Studio, Genre, Anime, normalizeAnimeYear } from '../types';
import { X, RotateCcw, Check, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  studios?: Studio[];
  genres?: Genre[];
  animes?: Anime[];
  selectedStudioId?: string;
  selectedGenreIds?: string[];
  selectedYear?: string;
  selectedStatus?: string;
  selectedRating: string;
  sortBy: string;
  onSelectStudio?: (id: string) => void;
  onSelectGenreIds?: (ids: string[]) => void;
  onSelectYear?: (year: string) => void;
  onSelectStatus?: (status: string) => void;
  onSelectRating: (rating: string) => void;
  onSelectSortBy: (sortBy: string) => void;
  onResetFilters: () => void;
  onOpenStudio?: (studio: Studio) => void;
}

const SORT_OPTIONS = [
  { id: 'recientes', label: 'Más Recientes' },
  { id: 'rating-desc', label: 'Mejor Calificados' },
  { id: 'rating-asc', label: 'Menos Calificados' },
  { id: 'name-asc', label: 'Nombre (A - Z)' },
  { id: 'name-desc', label: 'Nombre (Z - A)' },
  { id: 'year-desc', label: 'Año (Más Reciente)' },
  { id: 'year-asc', label: 'Año (Más Antiguo)' },
];

const RATING_OPTIONS = [
  { id: '5', label: '☆☆☆☆☆' },
  { id: '4', label: '☆☆☆☆' },
  { id: '3', label: '☆☆☆' },
  { id: '2', label: '☆☆' },
  { id: '1', label: '☆' },
  { id: '0', label: 'Sin calificar' },
];

const STATUS_OPTIONS = [
  { id: '', label: 'Todos' },
  { id: 'Emisión', label: 'En emisión' },
  { id: 'Finalizado', label: 'Finalizado' },
];

function FilterModal({
  isOpen,
  onClose,
  studios = [],
  genres = [],
  animes = [],
  selectedStudioId = '',
  selectedGenreIds = [],
  selectedYear = '',
  selectedStatus = '',
  selectedRating,
  sortBy,
  onSelectStudio,
  onSelectGenreIds,
  onSelectYear,
  onSelectStatus,
  onSelectRating,
  onSelectSortBy,
  onResetFilters,
}: FilterModalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cada vez que se abre el modal, se posiciona en el inicio (visible hasta Estado)
  useEffect(() => {
    if (isOpen) {
      const resetScroll = () => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        }
      };
      resetScroll();
      requestAnimationFrame(resetScroll);
      const t1 = setTimeout(resetScroll, 20);
      const t2 = setTimeout(resetScroll, 80);
      const t3 = setTimeout(resetScroll, 220);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isOpen]);

  const availableYears = useMemo(() => {
    const yearsSet = new Set<string>();
    animes.forEach(anime => {
      const y = normalizeAnimeYear(anime.year);
      if (y) yearsSet.add(y);
    });
    return Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
  }, [animes]);

  const extraActiveCount =
    (selectedStatus ? 1 : 0) +
    (selectedGenreIds.length > 0 ? selectedGenreIds.length : 0) +
    (selectedYear ? 1 : 0) +
    (selectedStudioId ? 1 : 0);

  const hasActiveFilters =
    selectedRating !== '' ||
    sortBy !== 'recientes' ||
    extraActiveCount > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm cursor-pointer"
          />

          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            className="relative w-full max-w-[460px] bg-[#110822] border border-[#2e174e] rounded-2xl shadow-2xl flex flex-col overflow-hidden h-[520px] max-h-[86vh] z-10"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#26133f] bg-[#110822] shrink-0">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="h-4 w-4 text-[#ec4899]" />
                <h2 className="font-sans font-bold text-xs sm:text-[13px] text-white uppercase tracking-wider">
                  FILTROS Y ORDENACIÓN
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    onClick={onResetFilters}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-sans text-neutral-400 hover:text-purple-300 border border-[#2e174e] rounded-lg bg-[#180c2c] transition-colors cursor-pointer"
                    title="Restablecer filtros"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Limpiar</span>
                  </button>
                )}

                <button
                  onClick={onClose}
                  className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  aria-label="Cerrar filtros"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content Body - Deslizable con todos los apartados */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-3.5 space-y-5 scrollbar-thin scrollbar-thumb-purple-900/40 overscroll-contain"
            >
              {/* 1. ORDENAR POR */}
              <div>
                <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                  ORDENAR POR
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {SORT_OPTIONS.map(opt => {
                    const isSelected = sortBy === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectSortBy(opt.id)}
                        className={`h-9 px-2.5 rounded-lg border transition-all cursor-pointer font-sans text-xs relative flex items-center justify-center ${
                          isSelected
                            ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                            : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                        }`}
                      >
                        <span className="text-center truncate px-1">{opt.label}</span>
                        {isSelected && (
                          <Check className="absolute right-2.5 h-3.5 w-3.5 text-white shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. CALIFICACIÓN */}
              <div>
                <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                  CALIFICACIÓN
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectRating('')}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                      selectedRating === ''
                        ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                        : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                    }`}
                  >
                    Todas
                  </button>
                  {RATING_OPTIONS.map(opt => {
                    const isSelected = selectedRating === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectRating(isSelected ? '' : opt.id)}
                        className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                          isSelected
                            ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                            : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                        }`}
                      >
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. ESTADOS */}
              <div>
                <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                  ESTADO
                </h3>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map(opt => {
                    const isSelected = selectedStatus === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectStatus?.(opt.id)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                            : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {isSelected && (
                          <Check className="h-3 w-3 text-white shrink-0 stroke-[2.5]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. GÉNEROS */}
              {genres.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest">
                      GÉNEROS
                    </h3>
                    {selectedGenreIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectGenreIds?.([])}
                        className="text-[10px] text-purple-400 hover:text-purple-300 underline cursor-pointer"
                      >
                        Limpiar géneros
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-purple-900/40">
                    <button
                      type="button"
                      onClick={() => onSelectGenreIds?.([])}
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                        selectedGenreIds.length === 0
                          ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                          : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                      }`}
                    >
                      Todos
                    </button>
                    {genres.map(genre => {
                      const isSelected = selectedGenreIds.includes(genre.id);
                      return (
                        <button
                          key={genre.id}
                          type="button"
                          onClick={() => {
                            if (!onSelectGenreIds) return;
                            if (isSelected) {
                              onSelectGenreIds(selectedGenreIds.filter(id => id !== genre.id));
                            } else {
                              onSelectGenreIds([...selectedGenreIds, genre.id]);
                            }
                          }}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans flex items-center gap-1 ${
                            isSelected
                              ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                              : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                          }`}
                        >
                          <span>{genre.name}</span>
                          {isSelected && (
                            <Check className="h-3 w-3 text-white shrink-0 stroke-[2.5]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 5. AÑOS DE LANZAMIENTO */}
              {availableYears.length > 0 && (
                <div>
                  <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                    AÑOS DE LANZAMIENTO
                  </h3>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-purple-900/40">
                    <button
                      type="button"
                      onClick={() => onSelectYear?.('')}
                      className={`px-3 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                        !selectedYear
                          ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                          : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                      }`}
                    >
                      Todos
                    </button>
                    {availableYears.map(year => {
                      const isSelected = selectedYear === year;
                      return (
                        <button
                          key={year}
                          type="button"
                          onClick={() => onSelectYear?.(isSelected ? '' : year)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                            isSelected
                              ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                              : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                          }`}
                        >
                          {year}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 6. ESTUDIOS */}
              {studios.length > 0 && (
                <div>
                  <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                    ESTUDIOS
                  </h3>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-purple-900/40">
                    <button
                      type="button"
                      onClick={() => onSelectStudio?.('')}
                      className={`px-3 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                        !selectedStudioId
                          ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                          : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                      }`}
                    >
                      Todos
                    </button>
                    {studios.map(studio => {
                      const isSelected = selectedStudioId === studio.id;
                      return (
                        <button
                          key={studio.id}
                          type="button"
                          onClick={() => onSelectStudio?.(isSelected ? '' : studio.id)}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium shadow-sm'
                              : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                          }`}
                        >
                          {studio.image && (
                            <img
                              src={studio.image}
                              alt=""
                              className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
                              onError={e => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          )}
                          <span>{studio.name}</span>
                          {isSelected && (
                            <Check className="h-3 w-3 text-white shrink-0 stroke-[2.5]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Bottom Button */}
            <div className="p-3 sm:p-3.5 bg-[#110822] border-t border-[#26133f] shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 sm:py-3 bg-[#a855f7] hover:bg-[#9333ea] text-white font-sans font-bold text-xs sm:text-[13px] tracking-wider uppercase rounded-xl transition-all shadow-lg shadow-purple-950/50 active:scale-[0.98] cursor-pointer text-center"
              >
                APLICAR FILTROS
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default React.memo(FilterModal);
