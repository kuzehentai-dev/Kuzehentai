/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface HorizontalSectionRowProps {
  title: string;
  subtitle?: string;
  count?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onViewAll?: () => void;
  viewAllLabel?: string;
  rightAction?: React.ReactNode;
}

export default function HorizontalSectionRow({
  title,
  subtitle,
  icon,
  children,
  onViewAll,
  viewAllLabel = 'Ver más',
  rightAction,
}: HorizontalSectionRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 15);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 15);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [children]);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = Math.max(300, el.clientWidth * 0.75);
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="w-full space-y-2.5 sm:space-y-3 relative group/row">
      {/* Section Header */}
      <div className="flex items-center justify-between px-0.5 sm:px-1 gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {icon && <span className="text-purple-400 shrink-0">{icon}</span>}
          <h2 className="font-display font-bold text-sm sm:text-base md:text-lg text-white tracking-tight leading-snug truncate">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {rightAction}

          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs font-mono font-medium text-purple-400 hover:text-purple-300 transition-colors cursor-pointer flex items-center gap-1 active:scale-95"
            >
              <span>{viewAllLabel}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {subtitle && (
        <p className="text-xs font-sans text-neutral-400 -mt-1 px-0.5 sm:px-1">
          {subtitle}
        </p>
      )}

      {/* Relative container with chevrons */}
      <div className="relative w-full">
        {/* Left Arrow Button */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollByAmount('left')}
            aria-label="Desplazar a la izquierda"
            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/80 hover:bg-[#1f1038] text-white border border-purple-500/40 backdrop-blur-md shadow-xl flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all duration-200 active:scale-90 cursor-pointer -ml-2 sm:-ml-3"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </button>
        )}

        {/* Scrollable Items Container (fluid vertical scrolling without touch-pan-x blocking) */}
        <div
          ref={scrollRef}
          className="flex items-stretch gap-1.5 sm:gap-2.5 overflow-x-auto scrollbar-none pb-2 pt-0.5 px-0.5 overscroll-x-contain no-swipe"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>

        {/* Right Arrow Button */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollByAmount('right')}
            aria-label="Desplazar a la derecha"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-30 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/80 hover:bg-[#1f1038] text-white border border-purple-500/40 backdrop-blur-md shadow-xl flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all duration-200 active:scale-90 cursor-pointer -mr-2 sm:-mr-3"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </button>
        )}
      </div>
    </section>
  );
}
