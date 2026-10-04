/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Studio {
  id: string;
  name: string;
  image?: string;
  storageLocation?: string;
}

export interface Genre {
  id: string;
  name: string;
  storageLocation?: string;
}

export interface Episode {
  number: number;
  mp4Url: string;
  telegramUrl?: string;
  url?: string;
  videoUrl?: string;
  link?: string;
  title?: string;
  name?: string;
  isNew?: boolean;
  coverImage?: string; // Portada del episodio para Nuevos Episodios (presentación en la página principal)
  thumbnail?: string; // Miniatura del episodio (permanente, se muestra al entrar al anime)
  addedToRecentAt?: string; // Timestamp de adición a la sección de episodios recientes
}

export interface Anime {
  id: string;
  name: string;
  image: string; // Base64 or URL
  coverData?: string; // Permanent base64 WebP image fallback
  studioId?: string;
  studioIds?: string[];
  genreIds: string[];
  status: 'Emisión' | 'Finalizado' | 'Próximamente' | string;
  year?: string;
  description: string;
  telegramUrl: string;
  episodes?: Episode[];
  hidden: boolean;
  downloads?: number;
  createdAt?: string;
  updatedAt?: string;
  storageLocation?: string;
  savedInFirestore?: boolean;
  firestoreError?: string;
}

export interface DatabaseSchema {
  studios: Studio[];
  genres: Genre[];
  animes: Anime[];
  userLists?: Record<string, string[]>;
}

export interface UserListResponse {
  deviceId: string;
  animeIds: string[];
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  message?: string;
}

export function getNormalizedKey(name: string): string {
  if (!name) return '';
  let str = name.trim().toLowerCase();
  // Strip diacritics / accents
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Normalize extra whitespace
  str = str.replace(/\s+/g, ' ');

  // Spanish plural reduction rules
  if (str.endsWith('es') && str.length > 4) {
    const base = str.slice(0, -2);
    if (/[r|l|n|d|z]$/.test(base)) {
      return base;
    }
    return str.slice(0, -1);
  } else if (str.endsWith('s') && str.length > 3 && !str.endsWith('ss')) {
    return str.slice(0, -1);
  }

  return str;
}

export function normalizeAnimeYear(year: string | number | undefined | null): string {
  if (year === undefined || year === null) return '';
  const yStr = String(year).trim();
  if (!yStr) return '';
  // 4 digits: keep as is
  if (/^\d{4}$/.test(yStr)) {
    return yStr;
  }
  // 1 digit: pad to 200X (e.g. 6 -> 2006, 1 -> 2001)
  if (/^\d{1}$/.test(yStr)) {
    return `200${yStr}`;
  }
  // 2 digits: pad to 20XX (e.g. 26 -> 2026, 12 -> 2012)
  if (/^\d{2}$/.test(yStr)) {
    return `20${yStr}`;
  }
  return yStr;
}
