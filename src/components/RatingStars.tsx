/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Star, Lock } from 'lucide-react';
import { getAnimeRatingStats, submitAnimeVote, RatingStats } from '../utils/ratingManager';
import { auth } from '../lib/firebase';

interface RatingStarsProps {
  animeId: string;
  compact?: boolean;
}

export default function RatingStars({ animeId, compact = false }: RatingStarsProps) {
  const [stats, setStats] = useState<RatingStats>(() => getAnimeRatingStats(animeId));
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Sync stats when animeId changes or when a rating update event fires
  useEffect(() => {
    setStats(getAnimeRatingStats(animeId));

    const handleRatingUpdate = (e: Event) => {
      const customEv = e as CustomEvent;
      if (customEv.detail?.animeId === animeId) {
        setStats(getAnimeRatingStats(animeId));
      }
    };

    window.addEventListener('kh_rating_updated', handleRatingUpdate);
    return () => {
      window.removeEventListener('kh_rating_updated', handleRatingUpdate);
    };
  }, [animeId]);

  const handleVote = (rating: number) => {
    if (!auth.currentUser) {
      setAuthError('Debes iniciar sesión para calificar');
      // Trigger global event to open Auth Modal
      window.dispatchEvent(new CustomEvent('kh_open_auth_modal'));
      setTimeout(() => setAuthError(null), 3000);
      return;
    }

    setAuthError(null);
    const { stats: updated, error } = submitAnimeVote(animeId, rating);
    if (error) {
      setAuthError(error);
      setTimeout(() => setAuthError(null), 3000);
    } else {
      setStats(updated);
    }
  };

  return (
    <div className="relative inline-flex items-center shrink-0">
      <div className="flex items-center gap-1.5 bg-[#181124] border border-[#30263f] hover:border-amber-500/40 rounded-xl px-2.5 py-1 transition-colors duration-200 shadow-sm">
        {/* 3 Interactive Stars */}
        <div className="flex items-center gap-0.5">
          {[1, 2, 3].map((star) => {
            const isHovered = hoverRating !== null && star <= hoverRating;
            const isSelected = hoverRating === null && stats.userVote !== null && star <= stats.userVote;
            const isFilledAverage = hoverRating === null && stats.userVote === null && star <= Math.round(stats.average);

            return (
              <button
                key={star}
                type="button"
                onClick={() => handleVote(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(null)}
                title={auth.currentUser ? `Calificar con ${star} estrella${star > 1 ? 's' : ''}` : 'Inicia sesión para calificar'}
                className="p-0.5 cursor-pointer focus:outline-none transition-transform hover:scale-125 active:scale-95 group"
              >
                <Star
                  className={`h-4 w-4 transition-colors duration-150 ${
                    isHovered || isSelected
                      ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                      : isFilledAverage
                      ? 'fill-amber-400/60 text-amber-400/80'
                      : 'text-neutral-600 fill-neutral-800 group-hover:text-amber-400/70'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Score Display */}
        <div 
          className="flex items-center gap-0.5 text-xs font-mono font-bold select-none text-neutral-300 pl-0.5"
        >
          <span className="text-amber-400 font-extrabold">
            {stats.average > 0 ? stats.average.toFixed(1) : '0.0'}
          </span>
          <span className="text-neutral-500 text-[10px]">/3</span>
        </div>
      </div>

      {/* Auth Notification Toast */}
      {authError && (
        <div className="absolute bottom-full left-0 mb-2 z-50 whitespace-nowrap bg-red-950 border border-red-500/50 text-red-200 text-[11px] font-mono px-2.5 py-1 rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-150 flex items-center gap-1">
          <Lock className="h-3 w-3 text-red-400 shrink-0" />
          <span>{authError}</span>
        </div>
      )}
    </div>
  );
}
