import React, { useState, useEffect, useRef } from 'react';
import { Anime } from '../types';

// Inline SVG generator for front-end fallback (100% fail-proof encoding)
export function getFallbackSvg(title?: string, studioName?: string): string {
  const cleanTitle = (title || 'Anime').replace(/["'<>]/g, '');
  const cleanStudio = (studioName || 'Estudio').replace(/["'<>]/g, '');
  
  const colors = [
    { start: '#120808', end: '#2a0a0a', accent: '#ff3333' },
    { start: '#080c14', end: '#101828', accent: '#4d79ff' },
    { start: '#121212', end: '#222222', accent: '#e0e0e0' },
    { start: '#140f08', end: '#2d1d05', accent: '#ffaa00' },
  ];
  const color = colors[Math.abs(cleanTitle.length) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="100%" height="100%">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color.start}"/>
        <stop offset="100%" stop-color="${color.end}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="15" y="15" width="370" height="570" fill="none" stroke="#2a2a2a" stroke-width="2"/>
    <rect x="25" y="25" width="350" height="550" fill="none" stroke="${color.accent}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="8 4"/>
    
    <line x1="50" y1="120" x2="350" y2="120" stroke="#333" stroke-width="1" />
    <line x1="50" y1="480" x2="350" y2="480" stroke="#333" stroke-width="1" />
    
    <circle cx="200" cy="200" r="60" fill="none" stroke="${color.accent}" stroke-opacity="0.8" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="45" fill="none" stroke="#333" stroke-width="1"/>
    <line x1="200" y1="120" x2="200" y2="280" stroke="${color.accent}" stroke-opacity="0.5" stroke-width="1"/>
    
    <text x="200" y="60" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="10" font-weight="600" fill="#888" letter-spacing="4" text-anchor="middle">H KUZE ARCHIVE</text>
    
    <text x="200" y="380" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-weight="800" font-size="20" fill="#ffffff" letter-spacing="-0.5" text-anchor="middle">${cleanTitle}</text>
    
    <text x="200" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="500" fill="${color.accent}" letter-spacing="2" text-anchor="middle">${cleanStudio.toUpperCase()}</text>
    
    <text x="200" y="540" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="9" fill="#666" letter-spacing="1" text-anchor="middle">SPEC. ARTWORK // FALLBACK</text>
  </svg>`;
  
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function processImageSrc(anime: Partial<Anime>, studioName: string = 'Estudio'): string {
  try {
    // 1. Base64 coverData from memory: 0ms INSTANT load with zero network roundtrips!
    if (anime.coverData && anime.coverData.startsWith('data:image/')) {
      return anime.coverData;
    }
    if (anime.image && anime.image.startsWith('data:image/')) {
      return anime.image;
    }
    // 2. HTTP cover URL as secondary path
    if (anime.image && (anime.image.startsWith('/covers/') || anime.image.startsWith('/api/covers/') || anime.image.startsWith('http://') || anime.image.startsWith('https://'))) {
      return anime.image.trim();
    }
    if (anime.id) {
      return `/covers/${anime.id}.webp`;
    }
  } catch (e) {
    console.error("Failed processing image src", e);
  }
  return getFallbackSvg(anime.name, studioName);
}

export const globalImageCache = new Set<string>();

interface SmartAnimeCoverProps {
  anime: Partial<Anime>;
  studioName?: string;
  className?: string;
  alt?: string;
  loading?: 'eager' | 'lazy';
  priority?: boolean;
}

export function SmartAnimeCover({ 
  anime, 
  studioName = 'Estudio', 
  className = 'w-full h-full object-cover', 
  alt = '',
  loading = 'lazy',
  priority = false
}: SmartAnimeCoverProps) {
  const initialSrc = processImageSrc(anime, studioName);
  const [imageSrc, setImageSrc] = useState<string>(initialSrc);
  const [retryCount, setRetryCount] = useState<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  
  const isInstant = initialSrc.startsWith('data:') || globalImageCache.has(initialSrc);
  const [isLoaded, setIsLoaded] = useState<boolean>(isInstant);

  useEffect(() => {
    // Si la imagen ya está en caché del navegador y completó su carga, marcar instantáneo
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      globalImageCache.add(imageSrc);
      setIsLoaded(true);
    }
  }, [imageSrc]);

  useEffect(() => {
    const src = processImageSrc(anime, studioName);
    if (src !== imageSrc) {
      setImageSrc(src);
      setRetryCount(0);
      const instant = src.startsWith('data:') || globalImageCache.has(src);
      setIsLoaded(instant);
    } else if (src.startsWith('data:') || globalImageCache.has(src)) {
      setIsLoaded(true);
    }
  }, [anime.image, anime.coverData, anime.id, studioName, imageSrc]);

  const handleLoad = () => {
    globalImageCache.add(imageSrc);
    setIsLoaded(true);
  };

  const handleError = () => {
    if (retryCount === 0 && anime.id) {
      setRetryCount(1);
      const nextSrc = `/covers/${anime.id}.webp`;
      setImageSrc(nextSrc);
      if (globalImageCache.has(nextSrc)) setIsLoaded(true);
      return;
    }
    if (retryCount <= 1 && anime.coverData && anime.coverData.startsWith('data:image/')) {
      setRetryCount(2);
      setImageSrc(anime.coverData);
      setIsLoaded(true);
      return;
    }
    if (retryCount <= 2 && anime.id) {
      setRetryCount(3);
      const nextSrc = `/api/covers/${anime.id}.webp`;
      setImageSrc(nextSrc);
      return;
    }
    const svgFallback = getFallbackSvg(anime.name, studioName);
    setImageSrc(svgFallback);
    setIsLoaded(true);
  };

  const fallbackBackground = getFallbackSvg(anime.name, studioName);

  return (
    <div 
      className="w-full h-full bg-neutral-900 bg-cover bg-center relative overflow-hidden" 
      style={{ backgroundImage: `url("${fallbackBackground}")` }}
    >
      <img
        ref={imgRef}
        src={imageSrc}
        alt={alt || anime.name || 'Cover'}
        loading={priority ? 'eager' : loading}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
        className={`${className} transition-opacity duration-300 ease-out ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {!isLoaded && (
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse pointer-events-none" />
      )}
    </div>
  );
}
