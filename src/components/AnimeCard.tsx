/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Anime, Studio } from '../types';
import { SmartAnimeCover } from '../utils/imageFallback';

export interface AnimeCardProps {
  anime: Anime;
  studios?: Studio[];
  studioName?: string;
  onClick?: () => void;
  className?: string;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({
  anime,
  studios,
  studioName: passedStudioName,
  onClick,
  className = ''
}) => {
  const sIds = (anime.studioIds && anime.studioIds.length > 0)
    ? anime.studioIds
    : (anime.studioId ? [anime.studioId] : []);
  const computedStudioNames = studios
    ? sIds.map(id => studios.find(s => s.id === id)?.name).filter(Boolean).join(', ')
    : '';
  const studioName = passedStudioName || computedStudioNames || 'Sin estudio';

  return (
    <div
      onClick={onClick}
      className={`group relative bg-[#15121e] border border-[#272236] hover:border-[#ff5588]/60 rounded-xl p-1.5 sm:p-2 flex items-center gap-2 sm:gap-3 cursor-pointer transition-all duration-300 hover:scale-[1.01] shadow-md overflow-hidden ${className}`}
    >
      {/* Poster thumbnail - expanded size without rank badge for better appreciation */}
      <div className="w-10 sm:w-14 aspect-[2/3] shrink-0 bg-neutral-900 rounded-lg overflow-hidden border border-dark-border/60 shadow-sm">
        <SmartAnimeCover
          anime={anime}
          studioName={studioName}
          alt={anime.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>

      {/* Title & Studio info */}
      <div className="min-w-0 flex-1">
        <h4 className="font-display font-medium text-xs sm:text-sm text-white truncate group-hover:text-[#ff5588] transition-colors leading-tight">
          {anime.name}
        </h4>
        <p className="font-mono text-[9px] sm:text-[10px] text-neutral-400 truncate mt-0.5">
          {studioName}
        </p>
      </div>
    </div>
  );
};

export default AnimeCard;
