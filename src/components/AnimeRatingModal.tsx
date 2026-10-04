/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Star, X, Lock } from 'lucide-react';
import { Anime } from '../types';
import { SmartAnimeCover } from '../utils/imageFallback';
import { getAnimeRatingStats, submitAnimeVote, RatingStats } from '../utils/ratingManager';
import { auth } from '../lib/firebase';

interface AnimeRatingModalProps {
  isOpen: boolean;
  onClose: () => void;
  anime: Anime;
  studioName?: string;
}

export default function AnimeRatingModal({
  isOpen,
  onClose,
  anime,
  studioName = 'Estudio',
}: AnimeRatingModalProps) {
  const [stats, setStats] = useState<RatingStats>(() => getAnimeRatingStats(anime.id));
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Sync stats when animeId changes or rating update event fires
  useEffect(() => {
    setStats(getAnimeRatingStats(anime.id));

    const handleRatingUpdate = (e: Event) => {
      const customEv = e as CustomEvent;
      if (!customEv.detail?.animeId || customEv.detail.animeId === anime.id) {
        setStats(getAnimeRatingStats(anime.id));
      }
    };

    window.addEventListener('kh_rating_updated', handleRatingUpdate);
    return () => {
      window.removeEventListener('kh_rating_updated', handleRatingUpdate);
    };
  }, [anime.id]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleVote = (rating: number) => {
    if (!auth.currentUser) {
      setAuthError('Debes iniciar sesión para calificar');
      window.dispatchEvent(new CustomEvent('kh_open_auth_modal'));
      setTimeout(() => setAuthError(null), 4000);
      return;
    }
    setAuthError(null);
    const { stats: updated, error } = submitAnimeVote(anime.id, rating);
    if (error) {
      setAuthError(error);
      setTimeout(() => setAuthError(null), 4000);
    } else if (updated) {
      setStats(updated);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/85 backdrop-blur-md cursor-pointer"
          />

          {/* Modal Content - Always in the center of the viewport */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-[330px] sm:max-w-[350px] bg-[#0c0817] border border-[#2b1847] rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col items-center text-center my-auto"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3.5 right-3.5 p-1.5 text-neutral-400 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer select-none"
              title="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Anime Cover Photo */}
            <div className="w-28 sm:w-32 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border border-purple-500/25 mb-3 shrink-0">
              <SmartAnimeCover
                anime={anime}
                studioName={studioName}
                alt={anime.name}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Anime Name (Truncated if too long) */}
            <h2 
              className="font-display font-bold text-base sm:text-lg text-white leading-tight w-full max-w-[270px] truncate select-none"
              title={anime.name}
            >
              {anime.name}
            </h2>

            {/* Subtitle */}
            <p className="font-sans text-xs text-neutral-400 mt-1 select-none">
              Añadir una valoración
            </p>

            {/* Login requirement indicator if not logged in */}
            {!auth.currentUser && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('kh_open_auth_modal'))}
                className="mt-2 px-3 py-1 rounded-full bg-purple-950/70 hover:bg-purple-900 border border-purple-500/40 text-[11px] text-purple-200 transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-sm select-none"
              >
                <Lock className="h-3 w-3 text-purple-400" />
                <span>Inicia sesión para calificar</span>
              </button>
            )}

            {authError && (
              <p className="font-sans text-xs text-rose-400 font-semibold mt-1.5 animate-pulse select-none">
                {authError}
              </p>
            )}

            {/* 5 Big Interactive Stars */}
            <div className="flex items-center justify-center gap-2 sm:gap-2.5 my-3.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const isHovered = hoverRating !== null && star <= hoverRating;
                const isSelected = hoverRating === null && stats.userVote !== null && star <= stats.userVote;

                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleVote(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    title={auth.currentUser ? `Calificar con ${star} estrella${star > 1 ? 's' : ''}` : 'Inicia sesión para calificar'}
                    className="p-1 cursor-pointer focus:outline-none transition-transform hover:scale-125 active:scale-95 group"
                  >
                    <Star
                      className={`h-7 w-7 sm:h-8 sm:w-8 transition-colors duration-150 ${
                        isHovered || isSelected
                          ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                          : 'text-neutral-500 fill-transparent group-hover:text-amber-300'
                      }`}
                      strokeWidth={1.5}
                    />
                  </button>
                );
              })}
            </div>

            {/* Average Rating Block */}
            <div className="w-full pt-2 text-left">
              <span className="font-sans text-xs font-medium text-neutral-400 block select-none">
                Valoración media
              </span>
              <div className="flex items-baseline gap-2 mt-1 select-none">
                <span className="font-display font-extrabold text-2xl sm:text-3xl text-white tracking-tight leading-none">
                  {stats.average > 0 ? stats.average.toFixed(1) : '0.0'}
                </span>
                <span className="font-sans text-xs text-neutral-400">
                  de 5 • {stats.totalVotes.toLocaleString()} {stats.totalVotes === 1 ? 'valoración' : 'valoraciones'}
                </span>
              </div>
            </div>

            {/* 5 Rating Breakdown Bars */}
            <div className="w-full space-y-1.5 mt-3 select-none">
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = stats[`v${stars}` as keyof RatingStats] as number || 0;
                const pct = stats.totalVotes > 0 ? Math.round((count / stats.totalVotes) * 100) : 0;

                return (
                  <div key={stars} className="flex items-center gap-2 text-xs">
                    {/* Star label */}
                    <div className="flex items-center gap-1 w-6 text-neutral-300 font-mono text-[11px] shrink-0 justify-end">
                      <Star className="h-3 w-3 fill-neutral-400 text-neutral-400" />
                      <span>{stars}</span>
                    </div>

                    {/* Progress bar track */}
                    <div className="flex-1 h-1.5 sm:h-2 bg-[#1b1429] border border-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-400 via-fuchsia-400 to-[#ff3b75] rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {/* Percentage */}
                    <span className="w-8 text-right font-mono text-[11px] text-neutral-400 shrink-0">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
