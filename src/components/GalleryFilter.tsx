/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Studio, Genre, Anime } from '../types';

export type GalleryDisplayMode = 'sections' | 'episodes' | 'catalog';

interface GalleryFilterProps {
  studios?: Studio[];
  genres?: Genre[];
  animes?: Anime[];
  selectedStudioId?: string;
  selectedGenreIds?: string[];
  onSelectStudio?: (id: string) => void;
  onToggleGenre?: (id: string) => void;
  onClearGenres?: () => void;
  isStudiosOpen?: boolean;
  onToggleStudiosOpen?: () => void;
  displayMode?: GalleryDisplayMode;
  onToggleDisplayMode?: (mode: GalleryDisplayMode) => void;
}

function GalleryFilter({
  displayMode = 'sections',
  onToggleDisplayMode,
}: GalleryFilterProps) {
  return (
    <div className="w-full py-0.5">
      {/* Selector de modo: Secciones / Episodios / Catálogo - estilo Crunchyroll */}
      <div className="inline-flex items-center gap-1 p-1 bg-[#090514] border border-[#2b1747] rounded-xl shadow-sm">
        <button
          type="button"
          onClick={() => onToggleDisplayMode && onToggleDisplayMode('sections')}
          className={`px-3 py-1 rounded-lg font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
            displayMode === 'sections'
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Ver secciones organizadas (Recomendaciones, Nuevos Episodios, Catálogo)"
        >
          <span>Inicio</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleDisplayMode && onToggleDisplayMode('episodes')}
          className={`px-3 py-1 rounded-lg font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
            displayMode === 'episodes'
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Mostrar todos los episodios en emisión y recientes"
        >
          <span>Episodios</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleDisplayMode && onToggleDisplayMode('catalog')}
          className={`px-3 py-1 rounded-lg font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
            displayMode === 'catalog'
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Mostrar catálogo completo"
        >
          <span>Catálogo</span>
        </button>
      </div>
    </div>
  );
}

export default React.memo(GalleryFilter);
