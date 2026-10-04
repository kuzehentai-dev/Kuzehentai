/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Anime, Studio } from '../types';
import { SmartAnimeCover } from '../utils/imageFallback';

interface GalleryCardProps {
  key?: string;
  anime: Anime;
  studios: Studio[];
  onClick: () => void;
  index?: number;
  isNewEpisodesMode?: boolean;
  episodeNumber?: number;
  episodeCoverImage?: string;
}

function GalleryCard({ anime, studios, onClick, index, isNewEpisodesMode, episodeNumber, episodeCoverImage }: GalleryCardProps) {
  const [epCoverError, setEpCoverError] = useState(false);
  const sIds = (anime.studioIds && anime.studioIds.length > 0)
    ? anime.studioIds
    : (anime.studioId ? [anime.studioId] : []);
  const studioName = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';

  const lastEpisodeNumber = episodeNumber !== undefined
    ? episodeNumber
    : (anime.episodes && anime.episodes.length > 0
        ? anime.episodes[anime.episodes.length - 1]?.number || anime.episodes.length
        : null);

  return (
    <div className="h-full w-full">
      <motion.div
        id={`anime-card-${anime.id}`}
        onClick={onClick}
        initial={{ scale: 0.88, opacity: 0.8 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: false, amount: 0.12 }}
        whileTap={{ scale: 0.96 }}
        whileHover={{ y: -4, scale: 1.03 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        style={{ willChange: "transform, opacity" }}
        className="group relative cursor-pointer aspect-[2/3] w-full bg-[#0d0818] rounded-2xl overflow-hidden border border-[#23153c] hover:border-purple-500/70 hover:shadow-lg hover:shadow-purple-950/40 shadow-md touch-manipulation select-none transition-all duration-300 block"
      >
        {episodeCoverImage && !epCoverError ? (
          <img
            src={episodeCoverImage}
            alt={`${anime.name} - Ep ${lastEpisodeNumber}`}
            loading={index !== undefined && index < 12 ? 'eager' : 'lazy'}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            referrerPolicy="no-referrer"
            onError={() => setEpCoverError(true)}
          />
        ) : (
          <SmartAnimeCover
            anime={anime}
            studioName={studioName}
            alt={anime.name}
            loading={index !== undefined && index < 12 ? 'eager' : 'lazy'}
            priority={index !== undefined && index < 6}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}

        {/* Badges for New Episodes mode */}
        {isNewEpisodesMode && (
          <>
            {lastEpisodeNumber !== null ? (
              <div className="absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-700 via-fuchsia-600 to-purple-600 border border-purple-400/40 text-white font-mono text-[8.5px] font-bold shadow-md tracking-tight flex items-center gap-1 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>EP {lastEpisodeNumber}</span>
              </div>
            ) : (anime.episodes && anime.episodes.length > 0) ? (
              <div className="absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded bg-purple-900/90 border border-purple-500/40 text-white font-mono text-[8.5px] font-bold shadow-sm tracking-tight pointer-events-none">
                <span>{anime.episodes.length} EPS</span>
              </div>
            ) : null}
          </>
        )}

        {/* Subtle title overlay at bottom - matching Más Populares and Recomendaciones */}
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/50 to-transparent p-1.5 sm:p-2 pt-4 pointer-events-none">
          <p className="font-display text-xs sm:text-[13px] text-white font-medium truncate group-hover:text-purple-400 transition-colors leading-tight">
            {anime.name}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default React.memo(GalleryCard);
