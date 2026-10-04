/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Studio, Genre, Anime } from '../types';

export type GalleryDisplayMode = 'episodes' | 'catalog';

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
  displayMode = 'episodes',
  onToggleDisplayMode,
}: GalleryFilterProps) {
  return (
    <div className="w-full py-0.5">
      {/* Recuadro de episodios y catálogo - ligeramente más grueso verticalmente con color violeta */}
      <div className="inline-flex items-center gap-0.5 p-[2.5px] bg-[#090514] border border-[#2b1747] rounded-lg shadow-sm">
        <button
          type="button"
          onClick={() => onToggleDisplayMode && onToggleDisplayMode('episodes')}
          className={`px-2.5 py-1 rounded-[6px] font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
            displayMode === 'episodes'
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Mostrar animes en emisión y nuevos episodios"
        >
          <span>Episodios</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleDisplayMode && onToggleDisplayMode('catalog')}
          className={`px-2.5 py-1 rounded-[6px] font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
            displayMode === 'catalog'
              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
          title="Mostrar todos los animes (Catálogo completo)"
        >
          <span>Catálogo</span>
        </button>
      </div>
    </div>
  );
}

export default React.memo(GalleryFilter);
