/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Studio, Genre, Anime, normalizeAnimeYear } from '../types';
import { X, RotateCcw, Check, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  studios: Studio[];
  genres: Genre[];
  animes: Anime[];
  selectedStudioId: string;
  selectedGenreIds: string[];
  selectedYear: string;
  selectedStatus: string;
  selectedRating: string;
  sortBy: string;
  onSelectStudio: (id: string) => void;
  onSelectGenreIds: (ids: string[]) => void;
  onSelectYear: (year: string) => void;
  onSelectStatus: (status: string) => void;
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
  { id: 'Próximamente', label: 'En Emisión' },
  { id: 'Finalizado', label: 'Finalizado' },
];

function FilterModal({
  isOpen,
  onClose,
  studios,
  genres,
  animes = [],
  selectedStudioId,
  selectedGenreIds,
  selectedYear,
  selectedStatus,
  selectedRating,
  sortBy,
  onSelectStudio,
  onSelectGenreIds,
  onSelectYear,
  onSelectStatus,
  onSelectRating,
  onSelectSortBy,
  onResetFilters,
  onOpenStudio,
}: FilterModalProps) {
  // Precalculate studio and genre counts
  const studioCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 0; i < animes.length; i++) {
      const sIds = (animes[i].studioIds && animes[i].studioIds.length > 0)
        ? animes[i].studioIds!
        : (animes[i].studioId ? [animes[i].studioId] : []);
      for (let j = 0; j < sIds.length; j++) {
        const sid = sIds[j];
        if (sid) map[sid] = (map[sid] || 0) + 1;
      }
    }
    return map;
  }, [animes]);

  const genreCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 0; i < animes.length; i++) {
      const gids = animes[i].genreIds;
      if (gids && Array.isArray(gids)) {
        for (let j = 0; j < gids.length; j++) {
          map[gids[j]] = (map[gids[j]] || 0) + 1;
        }
      }
    }
    return map;
  }, [animes]);

  const sortedStudios = useMemo(() => {
    return [...studios].sort((a, b) => {
      const countA = studioCounts[a.id] || 0;
      const countB = studioCounts[b.id] || 0;
      if (countB !== countA) return countB - countA;
      return a.name.localeCompare(b.name);
    });
  }, [studios, studioCounts]);

  const sortedGenres = useMemo(() => {
    return [...genres].sort((a, b) => {
      const countA = genreCounts[a.id] || 0;
      const countB = genreCounts[b.id] || 0;
      if (countB !== countA) return countB - countA;
      return a.name.localeCompare(b.name);
    });
  }, [genres, genreCounts]);

  // Extract unique years from animes
  const availableYears = useMemo(() => {
    const yearSet = new Set<string>();
    animes.forEach(a => {
      const y = normalizeAnimeYear(a.year);
      if (y) {
        yearSet.add(y);
      }
    });
    return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  }, [animes]);

  const handleToggleGenre = (genreId: string) => {
    if (selectedGenreIds.includes(genreId)) {
      onSelectGenreIds(selectedGenreIds.filter(id => id !== genreId));
    } else {
      onSelectGenreIds([...selectedGenreIds, genreId]);
    }
  };

  const hasActiveFilters =
    selectedStudioId !== '' ||
    selectedGenreIds.length > 0 ||
    selectedYear !== '' ||
    selectedStatus !== '' ||
    selectedRating !== '' ||
    sortBy !== 'recientes';

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

          {/* Modal Card - Matches Screenshot Perfectly */}
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[420px] bg-[#110822] border border-[#2e174e] rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[88vh] z-10"
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

            {/* Scrollable Content Body */}
            <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-5 scrollbar-thin scrollbar-thumb-purple-900/40">
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

              {/* 3. GÉNEROS */}
              {genres.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest">
                      GÉNEROS
                    </h3>
                    {selectedGenreIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectGenreIds([])}
                        className="text-[11px] text-purple-300 hover:underline cursor-pointer"
                      >
                        Desmarcar ({selectedGenreIds.length})
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                    {sortedGenres.map(gn => {
                      const count = genreCounts[gn.id] || 0;
                      const isSelected = selectedGenreIds.includes(gn.id);
                      return (
                        <button
                          key={gn.id}
                          type="button"
                          onClick={() => handleToggleGenre(gn.id)}
                          className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium'
                              : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 shrink-0" />}
                          <span>{gn.name}</span>
                          {count > 0 && (
                            <span className="text-[10px] opacity-60 font-mono">({count})</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 5. AÑOS */}
              {availableYears.length > 0 && (
                <div>
                  <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                    AÑOS DE LANZAMIENTO
                  </h3>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                    <button
                      type="button"
                      onClick={() => onSelectYear('')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                        selectedYear === ''
                          ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium'
                          : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                      }`}
                    >
                      Todos los años
                    </button>
                    {availableYears.map(yr => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => onSelectYear(selectedYear === yr ? '' : yr)}
                        className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                          selectedYear === yr
                            ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium'
                            : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                        }`}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. ESTUDIOS */}
              {studios.length > 0 && (
                <div>
                  <h3 className="font-sans text-[11px] font-medium text-neutral-400 uppercase tracking-widest mb-2.5">
                    ESTUDIOS
                  </h3>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                    <button
                      type="button"
                      onClick={() => onSelectStudio('')}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all cursor-pointer font-sans ${
                        selectedStudioId === ''
                          ? 'bg-[#a855f7] border-[#a855f7] text-white font-medium'
                          : 'border-[#281644] text-neutral-300 bg-[#160c29] hover:border-purple-500/40 hover:text-white'
                      }`}
                    >
                      Todos los estudios
                    </button>
                    {sortedStudios.map(st => {
                      const count = studioCounts[st.id] || 0;
                      return (
                        <div key={st.id} className="inline-flex items-center rounded-lg border border-[#281644] bg-[#160c29] overflow-hidden">
                          <button
                            type="button"
                            onClick={() => onSelectStudio(selectedStudioId === st.id ? '' : st.id)}
                            className={`px-2.5 py-1.5 text-xs transition-all cursor-pointer font-sans flex items-center gap-1.5 ${
                              selectedStudioId === st.id
                                ? 'bg-[#a855f7] text-white font-medium'
                                : 'text-neutral-300 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            <span>{st.name}</span>
                            {count > 0 && (
                              <span className="text-[10px] opacity-60 font-mono">({count})</span>
                            )}
                          </button>
                          {onOpenStudio && (
                            <button
                              type="button"
                              onClick={() => onOpenStudio(st)}
                              title={`Abrir apartado del estudio ${st.name}`}
                              className="px-2 py-1.5 text-purple-400 hover:text-white hover:bg-purple-900/50 border-l border-[#281644] text-[10px] cursor-pointer"
                            >
                              Catálogo
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Bottom Button - Exact Match with Screenshot */}
            <div className="p-3.5 sm:p-4 bg-[#110822] border-t border-[#26133f] shrink-0">
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
