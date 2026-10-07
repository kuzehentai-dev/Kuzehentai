/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { db, doc, setDoc, deleteDoc, updateDoc, collection, getDocs } from '../lib/firebase';
import { Studio, Genre, Anime, DatabaseSchema, getNormalizedKey, normalizeAnimeYear } from '../types';
import { SmartAnimeCover, getFallbackSvg } from '../utils/imageFallback';
import { 
  Lock, User as UserIcon, LogOut, Plus, Trash2, Edit2, Save, EyeOff, Eye, Upload, Folder,
  Settings, Database, RefreshCw, Layers, Film, Tag, ArrowLeft, Download, Check, AlertCircle, Search, Building2, Sparkles,
  HardDrive, Globe, Image as ImageIcon, Info, X, Link as LinkIcon, Activity, Cpu, Cloud, BarChart3, PieChart, ShieldCheck,
  ChevronLeft, ChevronRight, Users, Star, MessageSquare, Flame
} from 'lucide-react';
import {
  normalizeSearchText,
  calculateRelevanceScore,
  matchesFuzzySearch,
  buildNormalizedAnimeData
} from '../utils/searchUtils';
import AdminEpisodeManager from './AdminEpisodeManager';
import { getAnimeRatingStats } from '../utils/ratingManager';

interface AdminPanelProps {
  studios: Studio[];
  genres: Genre[];
  animes: Anime[];
  onRefresh: () => void;
  onBackToHome: () => void;
  currentUser?: User | null;
}

// No image optimization/compression - keeps images 100% original
const compressImage = (base64Str: string): Promise<string> => {
  return Promise.resolve(base64Str);
};

// Smart URL parser to extract Anime title candidate & episode number from links (e.g. Internet Archive)
export function parseAnimeLinkInfo(rawUrl: string, animesList: Anime[]) {
  if (!rawUrl || !rawUrl.trim()) {
    return { detectedTitle: '', detectedEp: 1, matchedAnime: null };
  }

  let url = rawUrl.trim();
  try {
    url = decodeURIComponent(url);
  } catch (e) {
    // fallback
  }

  url = url.split('?')[0].split('#')[0];

  // Strip protocol & domain if present
  let urlClean = url.replace(/^(?:https?|ftp):\/\/[^\/]+/i, '');
  urlClean = urlClean.replace(/^\/+/, '');

  // Extract path segments and filter out non-anime route noise
  const rawSegments = urlClean.split('/').filter(Boolean);
  const segments = rawSegments.filter(s => {
    const lower = s.toLowerCase();
    return !['load', 'download', 'downloads', 'video', 'stream', 'files', 'storage', 'watch', 'v', 'f', 'embed', 'api', 'upload', 'archive.org', 'details'].includes(lower);
  });

  let textToParse = segments.length > 0 ? segments[segments.length - 1] : urlClean;
  let parentSegment = segments.length > 1 ? segments[segments.length - 2] : '';

  // Clean video extensions & quality tags
  textToParse = textToParse.replace(/\.(mp4|mkv|avi|webm|flv|mov|m4v|3gp|ts)$/i, '');
  textToParse = textToParse.replace(/\b(1080p|720p|480p|x264|x265|aac|bluray|web-dl|hdrip)\b/gi, '');

  if (parentSegment) {
    parentSegment = parentSegment.replace(/\.(mp4|mkv|avi|webm|flv|mov|m4v|3gp|ts)$/i, '');
    parentSegment = parentSegment.replace(/\b(1080p|720p|480p|x264|x265|aac|bluray|web-dl|hdrip)\b/gi, '');
  }

  let epNum = 1;
  let titleCandidate = '';

  // If last segment is JUST a number (e.g. /01.mp4 or /1)
  if (/^\d{1,4}$/.test(textToParse.trim())) {
    epNum = parseInt(textToParse.trim(), 10) || 1;
    titleCandidate = parentSegment.replace(/[._\-]+/g, ' ').trim();
  } else {
    // Try to extract episode number from the text
    const epPatterns = [
      /(?:^|[._\-\s]+)(?:ep|episodio|cap|capitulo|e|c)?\s*0*(\d{1,4})\s*$/i,
      /(?:^|[._\-\s]+)(?:ep|episodio|cap|capitulo|e|c)\s*0*(\d{1,4})\b/i,
      /\b(?:s\d+)?e0*(\d{1,4})\b/i
    ];

    let foundEp = false;
    let cleanedText = textToParse.replace(/[._\-]+/g, ' ').trim();

    for (const pattern of epPatterns) {
      const match = cleanedText.match(pattern);
      if (match) {
        epNum = parseInt(match[1], 10) || 1;
        const cutIdx = match.index;
        if (cutIdx !== undefined && cutIdx > 0) {
          titleCandidate = cleanedText.substring(0, cutIdx).trim();
        } else {
          titleCandidate = cleanedText.replace(pattern, '').trim();
        }
        foundEp = true;
        break;
      }
    }

    if (!foundEp || !titleCandidate) {
      titleCandidate = cleanedText;
    }
  }

  // Format title candidate with Capital Words
  if (titleCandidate) {
    titleCandidate = titleCandidate.replace(/\b\w/g, c => c.toUpperCase());
  }

  const normCandidate = getNormalizedKey(titleCandidate);
  const normFullText = getNormalizedKey(textToParse);

  let bestMatch: Anime | null = null;
  let highestScore = 0;

  for (const anime of animesList) {
    const normAnime = getNormalizedKey(anime.name);
    if (!normAnime) continue;

    // 1. Exact match
    if (normAnime === normCandidate || normAnime === normFullText) {
      bestMatch = anime;
      highestScore = 100;
      break;
    }

    // 2. Substring / Prefix match
    if (normCandidate && normCandidate.length >= 3) {
      if (normAnime.startsWith(normCandidate) || normCandidate.startsWith(normAnime)) {
        const score = 90;
        if (score > highestScore) {
          highestScore = score;
          bestMatch = anime;
        }
      } else if (normAnime.includes(normCandidate) || normCandidate.includes(normAnime)) {
        const minLen = Math.min(normAnime.length, normCandidate.length);
        const maxLen = Math.max(normAnime.length, normCandidate.length);
        const score = (minLen / maxLen) * 85;
        if (score > highestScore && score > 30) {
          highestScore = score;
          bestMatch = anime;
        }
      }
    }

    // 3. Token overlap match
    const candidateTokens = (normCandidate || normFullText).split(/\s+/).filter(t => t.length > 1);
    const animeTokens = normAnime.split(/\s+/).filter(t => t.length > 1);
    if (candidateTokens.length > 0 && animeTokens.length > 0) {
      const candidateSet = new Set(candidateTokens);
      const matchCount = animeTokens.filter(t => candidateSet.has(t)).length;
      const ratio = matchCount / Math.min(animeTokens.length, candidateTokens.length);
      if (ratio >= 0.5) {
        const score = ratio * 80;
        if (score > highestScore && score > 35) {
          highestScore = score;
          bestMatch = anime;
        }
      }
    }
  }

  return {
    detectedTitle: titleCandidate || textToParse,
    detectedEp: epNum,
    matchedAnime: bestMatch
  };
}

export default function AdminPanel({ studios, genres, animes, onRefresh, onBackToHome, currentUser }: AdminPanelProps) {
  // Authentication states
  const [token, setToken] = useState<string>(() => localStorage.getItem('hk_admin_token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Nav states
  const [activeTab, setActiveTab] = useState<'animes' | 'episodes' | 'studios' | 'genres' | 'backup' | 'firebase-stats'>('animes');
  const [tabDirection, setTabDirection] = useState<number>(1);

  const handleTabChange = (newTab: 'animes' | 'episodes' | 'studios' | 'genres' | 'backup' | 'firebase-stats') => {
    const tabs: ('animes' | 'episodes' | 'studios' | 'genres' | 'backup' | 'firebase-stats')[] = [
      'animes', 'episodes', 'studios', 'genres', 'backup', 'firebase-stats'
    ];
    const currentIdx = tabs.indexOf(activeTab);
    const newIdx = tabs.indexOf(newTab);
    setTabDirection(newIdx >= currentIdx ? 1 : -1);
    setActiveTab(newTab);
  };

  // Form states - Studios
  const [editingStudio, setEditingStudio] = useState<Studio | null>(null);
  const [studioName, setStudioName] = useState('');
  const [studioImage, setStudioImage] = useState('');
  const [studioError, setStudioError] = useState('');

  // Form states - Genres
  const [editingGenre, setEditingGenre] = useState<Genre | null>(null);
  const [genreName, setGenreName] = useState('');
  const [genreError, setGenreError] = useState('');

  // Form states - Anime
  const [isAnimeFormOpen, setIsAnimeFormOpen] = useState(false);
  const [editingAnime, setEditingAnime] = useState<Anime | null>(null);
  const [animeName, setAnimeName] = useState('');
  const [animeImage, setAnimeImage] = useState('');
  const [isImageOptimized, setIsImageOptimized] = useState(false);
  const [animeStudioId, setAnimeStudioId] = useState('');
  const [animeStudioSearch, setAnimeStudioSearch] = useState('');
  const [showStudioPicker, setShowStudioPicker] = useState(false);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [animeGenreIds, setAnimeGenreIds] = useState<string[]>([]);
  const [animeGenresInput, setAnimeGenresInput] = useState('');
  const [animeStatus, setAnimeStatus] = useState('Finalizado');

  // Papelera de animes eliminados (guarda exclusivamente los nombres de los animes eliminados)
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashNames, setTrashNames] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('deleted_animes_trash');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isClearingTrash, setIsClearingTrash] = useState(false);

  const fetchTrash = async () => {
    try {
      const res = await fetch('/api/admin/trash', { headers: apiHeaders });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.trash)) {
          setTrashNames(data.trash);
          localStorage.setItem('deleted_animes_trash', JSON.stringify(data.trash));
        }
      }
    } catch (e) {}
  };

  const recordDeletedAnime = (name: string) => {
    if (!name) return;
    setTrashNames(prev => {
      const next = prev.includes(name) ? prev : [name, ...prev];
      localStorage.setItem('deleted_animes_trash', JSON.stringify(next));
      return next;
    });
  };

  const handleEmptyTrash = async () => {
    setIsClearingTrash(true);
    try {
      await fetch('/api/admin/trash', { method: 'DELETE', headers: apiHeaders }).catch(() => null);
      setTrashNames([]);
      localStorage.removeItem('deleted_animes_trash');
      showNotification('Papelera vaciada correctamente', 'success');
    } catch (err: any) {
      showNotification('Error al vaciar papelera', 'error');
    } finally {
      setIsClearingTrash(false);
    }
  };

  useEffect(() => {
    fetchTrash();
  }, []);

  const [lastUsedStudio, setLastUsedStudio] = useState<{ id: string; search: string }>(() => {
    try {
      const saved = localStorage.getItem('kh_admin_last_used_studio');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.search === 'string') {
          return parsed;
        }
      }
    } catch (e) {}
    return { id: '', search: '' };
  });

  const updateLastUsedStudio = (studioSearch: string, studioId: string = '') => {
    const updated = { id: studioId, search: studioSearch };
    setLastUsedStudio(updated);
    try {
      if (studioSearch.trim()) {
        localStorage.setItem('kh_admin_last_used_studio', JSON.stringify(updated));
      } else {
        localStorage.removeItem('kh_admin_last_used_studio');
      }
    } catch (e) {}
  };
  const [animeYear, setAnimeYear] = useState('');
  const [animeDescription, setAnimeDescription] = useState('');
  const [animeTelegramUrl, setAnimeTelegramUrl] = useState('');
  const [singleEpIsNew, setSingleEpIsNew] = useState<boolean>(false);
  const [animeEpisodes, setAnimeEpisodes] = useState<{
    number: number;
    telegramUrl: string;
    isNew?: boolean;
    addedToRecentAt?: string;
    coverImage?: string;
    thumbnail?: string;
    title?: string;
  }[]>([]);
  const episodeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [animeHidden, setAnimeHidden] = useState(false);
  const [animeFormError, setAnimeFormError] = useState('');
  const [imageUploadLoading, setImageUploadLoading] = useState(false);
  const [animeAdminSearch, setAnimeAdminSearch] = useState('');
  const deferredAdminSearch = React.useDeferredValue(animeAdminSearch);
  const [isDeduplicatingAnimes, setIsDeduplicatingAnimes] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);

  // Quick Add Episode by Link states
  const [showQuickAddEpModal, setShowQuickAddEpModal] = useState(false);
  const [quickEpItems, setQuickEpItems] = useState<{ number: number; url: string; coverImage?: string; thumbnail?: string }[]>([
    { number: 1, url: '' }
  ]);
  const quickEpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Gesto de deslizamiento (swipe horizontal) para navegar entre apartados del Panel de Administración
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      // Si el formulario de anime está abierto o algún modal visible, no cambiar pestañas
      if (isAnimeFormOpen || showQuickAddEpModal || showDuplicatesModal) return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.closest('input') ||
          target.closest('select') ||
          target.closest('textarea') ||
          target.closest('.no-swipe') ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!startTime) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const duration = Date.now() - startTime;
      startTime = 0;

      // Deslizamiento horizontal rápido (< 750ms) y predominante
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3 && duration < 750) {
        const tabs: ('animes' | 'episodes' | 'studios' | 'genres' | 'backup' | 'firebase-stats')[] = [
          'animes', 'episodes', 'studios', 'genres', 'backup', 'firebase-stats'
        ];
        const currentIndex = tabs.indexOf(activeTab);
        if (currentIndex === -1) return;

        // Deslizar hacia la izquierda (swipe left) -> Siguiente apartado
        if (deltaX < -45 && currentIndex < tabs.length - 1) {
          try { if (navigator.vibrate) navigator.vibrate(20); } catch {}
          handleTabChange(tabs[currentIndex + 1]);
        }
        // Deslizar hacia la derecha (swipe right) -> Apartado anterior
        else if (deltaX > 45 && currentIndex > 0) {
          try { if (navigator.vibrate) navigator.vibrate(20); } catch {}
          handleTabChange(tabs[currentIndex - 1]);
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [activeTab, isAnimeFormOpen, showQuickAddEpModal, showDuplicatesModal]);
  const [quickEpTargetAnimeId, setQuickEpTargetAnimeId] = useState('');
  const [quickEpDetectedTitle, setQuickEpDetectedTitle] = useState('');
  const [quickEpAutoMatched, setQuickEpAutoMatched] = useState(false);
  const [isSavingQuickEp, setIsSavingQuickEp] = useState(false);

  const nextQuickEpNumber = quickEpItems.length > 0
    ? Math.max(...quickEpItems.map(item => Number(item.number) || 0)) + 1
    : 1;

  const handleAddQuickEpField = () => {
    if (quickEpItems.length >= 12) {
      showNotification('Se ha alcanzado el límite máximo de 12 episodios.', 'error');
      return;
    }
    setQuickEpItems(prev => [...prev, { number: nextQuickEpNumber, url: '' }]);
  };

  const handleRemoveQuickEpField = (index: number) => {
    if (quickEpItems.length > 1) {
      setQuickEpItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleUpdateQuickEpNumber = (index: number, numVal: any) => {
    setQuickEpItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], number: Number(numVal) || 1 };
      return updated;
    });
  };

  const handleQuickItemUrlChange = (index: number, val: string) => {
    let detectedTitle = '';
    let targetAnimeId = '';
    let autoMatched = false;
    let shouldUpdateMeta = false;

    setQuickEpItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], url: val };

      const urlClean = val.trim();
      if (urlClean) {
        const parsed = parseAnimeLinkInfo(urlClean, animes);
        if (parsed.detectedTitle) {
          detectedTitle = parsed.detectedTitle;
          shouldUpdateMeta = true;
        }
        if (parsed.matchedAnime) {
          targetAnimeId = parsed.matchedAnime.id;
          autoMatched = true;
          shouldUpdateMeta = true;
        } else if (!quickEpTargetAnimeId || quickEpTargetAnimeId === 'NEW_ANIME') {
          targetAnimeId = 'NEW_ANIME';
          autoMatched = false;
          shouldUpdateMeta = true;
        }

        if (parsed.detectedEp) {
          const baseEp = parsed.detectedEp;
          updated[index] = { ...updated[index], number: baseEp };
          for (let j = index + 1; j < updated.length; j++) {
            updated[j] = { ...updated[j], number: baseEp + (j - index) };
          }
        }
      }

      // Smart focus/blur logic when paste or URL entry occurs
      if (urlClean.length > 8 || urlClean.startsWith('http') || urlClean.includes('archive.org')) {
        const nextEmptyIdx = updated.findIndex((item, i) => i > index && (!item.url || item.url.trim() === ''));
        
        if (nextEmptyIdx !== -1) {
          // More empty chapter fields remain! Focus next empty field so keyboard stays open for next paste
          setTimeout(() => {
            quickEpInputRefs.current[nextEmptyIdx]?.focus();
          }, 60);
        } else {
          const anyEmptyIdx = updated.findIndex((item, i) => i !== index && (!item.url || item.url.trim() === ''));
          if (anyEmptyIdx !== -1) {
            setTimeout(() => {
              quickEpInputRefs.current[anyEmptyIdx]?.focus();
            }, 60);
          } else {
            // NO MORE EMPTY FIELDS! All chapter inputs in the modal now have a link.
            // Dismiss/lower the keyboard automatically
            setTimeout(() => {
              (document.activeElement as HTMLElement)?.blur();
              if (quickEpInputRefs.current[index]) {
                quickEpInputRefs.current[index]?.blur();
              }
            }, 60);
          }
        }
      }

      return updated;
    });

    if (shouldUpdateMeta) {
      if (detectedTitle) setQuickEpDetectedTitle(detectedTitle);
      if (targetAnimeId) setQuickEpTargetAnimeId(targetAnimeId);
      setQuickEpAutoMatched(autoMatched);
    }
  };

  const handleOpenQuickAddEpModal = (initialAnimeId?: string | unknown) => {
    setQuickEpItems([{ number: 1, url: '' }]);
    const animeIdStr = typeof initialAnimeId === 'string' ? initialAnimeId : '';
    const initialAnime = animeIdStr ? animes.find(a => a.id === animeIdStr) : null;
    setQuickEpDetectedTitle(initialAnime ? initialAnime.name : '');
    setQuickEpTargetAnimeId(animeIdStr || '');
    setQuickEpAutoMatched(!!animeIdStr);
    setShowQuickAddEpModal(true);
  };

  const handleSaveQuickEpisode = async () => {
    const validItems = quickEpItems.filter(item => item.url.trim() !== '');
    if (validItems.length === 0) {
      showNotification('Debes ingresar al menos un enlace válido.', 'error');
      return;
    }

    setIsSavingQuickEp(true);
    try {
      let targetAnime: Anime | null = null;
      let isNewAnime = false;

      if (quickEpTargetAnimeId === 'NEW_ANIME' || !quickEpTargetAnimeId) {
        isNewAnime = true;
      } else {
        targetAnime = animes.find(a => a.id === quickEpTargetAnimeId) || null;
      }

      if (isNewAnime) {
        const animeTitle = quickEpDetectedTitle.trim() || 'Nuevo Anime';
        const defaultStudioId = studios.length > 0 ? studios[0].id : '';

        const episodesPayload = validItems.map((item, idx) => ({
          number: Number(item.number) || 1,
          telegramUrl: item.url.trim(),
          mp4Url: item.url.trim(),
          isNew: true,
          addedToRecentAt: new Date(Date.now() + idx * 1000).toISOString(),
          coverImage: item.coverImage,
          thumbnail: item.thumbnail
        })).sort((a, b) => a.number - b.number);

        const firstUrl = episodesPayload[0]?.telegramUrl || '';

        const payload = {
          name: animeTitle,
          image: '',
          coverData: '',
          studioId: defaultStudioId,
          genreIds: [],
          status: 'Finalizado',
          year: new Date().getFullYear().toString(),
          description: '',
          telegramUrl: firstUrl,
          episodes: episodesPayload,
          hidden: false,
          order: 10,
        };

        const res = await fetch('/api/animes', {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          onRefresh();
          showNotification(`¡Anime "${animeTitle}" con ${validItems.length} episodio(s) creado exitosamente!`, 'success');
          setShowQuickAddEpModal(false);
          setQuickEpItems([{ number: 1, url: '' }]);
        } else {
          const errData = await res.json().catch(() => ({}));
          showNotification(errData.error || 'Error al crear anime.', 'error');
        }
      } else if (targetAnime) {
        const existingEps = targetAnime.episodes ? [...targetAnime.episodes] : [];

        validItems.forEach((item, idx) => {
          const epNum = Number(item.number) || 1;
          const epUrlClean = item.url.trim();
          const existingIndex = existingEps.findIndex(e => e.number === epNum);

          if (existingIndex >= 0) {
            existingEps[existingIndex] = {
              ...existingEps[existingIndex],
              mp4Url: epUrlClean,
              telegramUrl: epUrlClean,
              isNew: true,
              addedToRecentAt: new Date(Date.now() + idx * 1000).toISOString(),
              ...(item.coverImage !== undefined ? { coverImage: item.coverImage } : {}),
              ...(item.thumbnail !== undefined ? { thumbnail: item.thumbnail } : {})
            };
          } else {
            existingEps.push({
              number: epNum,
              mp4Url: epUrlClean,
              telegramUrl: epUrlClean,
              isNew: true,
              addedToRecentAt: new Date(Date.now() + idx * 1000).toISOString(),
              coverImage: item.coverImage,
              thumbnail: item.thumbnail
            });
          }
        });

        existingEps.sort((a, b) => a.number - b.number);

        const payload = {
          ...targetAnime,
          episodes: existingEps
        };

        const res = await fetch(`/api/animes/${targetAnime.id}`, {
          method: 'PUT',
          headers: apiHeaders,
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          onRefresh();
          showNotification(`¡${validItems.length} episodio(s) agregado(s) a "${targetAnime.name}" exitosamente!`, 'success');
          setShowQuickAddEpModal(false);
          setQuickEpItems([{ number: 1, url: '' }]);
        } else {
          const errData = await res.json().catch(() => ({}));
          showNotification(errData.error || 'Error al actualizar anime.', 'error');
        }
      }
    } catch (err) {
      showNotification('Error de red al guardar episodios.', 'error');
    } finally {
      setIsSavingQuickEp(false);
    }
  };

  // Fast memoized admin ordered and filtered animes list
  const studioMapForAdmin = React.useMemo(() => {
    const map = new Map<string, string>();
    studios.forEach(s => map.set(s.id, s.name));
    return map;
  }, [studios]);

  const genreMapForAdmin = React.useMemo(() => {
    const map = new Map<string, string>();
    genres.forEach(g => map.set(g.id, g.name));
    return map;
  }, [genres]);

  const adminOrderedAnimes = React.useMemo(() => {
    return [...animes]
      .map((anime, originalIndex) => ({ anime, originalIndex }))
      .sort((a, b) => {
        if (a.anime.createdAt && b.anime.createdAt) {
          return new Date(b.anime.createdAt).getTime() - new Date(a.anime.createdAt).getTime();
        }
        return b.originalIndex - a.originalIndex;
      });
  }, [animes]);

  const normalizedAdminAnimes = React.useMemo(() => {
    return animes.map(anime => buildNormalizedAnimeData(anime, studioMapForAdmin, genreMapForAdmin));
  }, [animes, studioMapForAdmin, genreMapForAdmin]);

  const adminFilteredAnimes = React.useMemo(() => {
    const rawQuery = deferredAdminSearch.trim();
    if (!rawQuery) return adminOrderedAnimes;

    const normQuery = normalizeSearchText(rawQuery);
    const normQueryNoSpaces = normQuery.replace(/\s+/g, '');
    const queryTokens = normQuery.split(' ').filter(Boolean);

    const matching: { anime: Anime; originalIndex: number; score: number }[] = [];

    for (let i = 0; i < normalizedAdminAnimes.length; i++) {
      const item = normalizedAdminAnimes[i];
      if (matchesFuzzySearch(normQuery, normQueryNoSpaces, queryTokens, item)) {
        const score = calculateRelevanceScore(normQuery, normQueryNoSpaces, queryTokens, item);
        matching.push({
          anime: item.anime,
          originalIndex: i,
          score
        });
      }
    }

    matching.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.originalIndex - a.originalIndex;
    });

    return matching.map(m => ({ anime: m.anime, originalIndex: m.originalIndex }));
  }, [adminOrderedAnimes, deferredAdminSearch, normalizedAdminAnimes]);

  // Admin Anime Table Pagination State (20 per page as requested)
  const [adminAnimePage, setAdminAnimePage] = useState(1);
  const adminItemsPerPage = 20;

  useEffect(() => {
    setAdminAnimePage(1);
  }, [deferredAdminSearch, activeTab, animes.length]);

  const totalAdminAnimePages = Math.ceil(adminFilteredAnimes.length / adminItemsPerPage) || 1;
  const paginatedAdminAnimes = React.useMemo(() => {
    const start = (adminAnimePage - 1) * adminItemsPerPage;
    return adminFilteredAnimes.slice(start, start + adminItemsPerPage);
  }, [adminFilteredAnimes, adminAnimePage]);

  // Precomputed studio & genre counts for O(1) instantaneous render in tabs
  const studioAnimeCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < animes.length; i++) {
      const sIds = (animes[i].studioIds && animes[i].studioIds.length > 0)
        ? animes[i].studioIds!
        : (animes[i].studioId ? [animes[i].studioId] : []);
      for (let j = 0; j < sIds.length; j++) {
        const sId = sIds[j];
        if (sId) map.set(sId, (map.get(sId) || 0) + 1);
      }
    }
    return map;
  }, [animes]);

  const genreAnimeCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < animes.length; i++) {
      const gIds = animes[i].genreIds;
      if (gIds && Array.isArray(gIds)) {
        for (let j = 0; j < gIds.length; j++) {
          map.set(gIds[j], (map.get(gIds[j]) || 0) + 1);
        }
      }
    }
    return map;
  }, [animes]);

  // Real-time calculation of duplicates across all data (only computed when modal is open for max performance)
  const duplicateDiagnostics = React.useMemo(() => {
    if (!showDuplicatesModal) {
      return {
        titleDupes: [],
        telegramDupes: [],
        coverDupes: [],
        episodeLinkDupes: [],
        studioDupes: [],
        genreDupes: [],
        totalDuplicates: 0
      };
    }

    const titles = new Map<string, Anime[]>();
    const telegrams = new Map<string, Anime[]>();
    const covers = new Map<string, Anime[]>();
    const episodeUrls = new Map<string, { anime: Anime; epNumber: number }[]>();
    const studioNames = new Map<string, Studio[]>();
    const genreNames = new Map<string, Genre[]>();

    animes.forEach(a => {
      // Title
      const normTitle = getNormalizedKey(a.name);
      if (normTitle) {
        if (!titles.has(normTitle)) titles.set(normTitle, []);
        titles.get(normTitle)!.push(a);
      }

      // Main Telegram
      const normTg = (a.telegramUrl || '').trim().toLowerCase();
      if (normTg && normTg.length > 5) {
        if (!telegrams.has(normTg)) telegrams.set(normTg, []);
        telegrams.get(normTg)!.push(a);
      }

      // Cover image
      const normImg = (a.image || '').trim();
      if (normImg && normImg.length > 20 && !normImg.startsWith('data:image/svg')) {
        const normImgKey = normImg.length > 200 ? `${normImg.length}-${normImg.slice(0, 100)}-${normImg.slice(-50)}` : normImg;
        if (!covers.has(normImgKey)) covers.set(normImgKey, []);
        covers.get(normImgKey)!.push(a);
      }

      // Episode video URLs
      if (a.episodes && Array.isArray(a.episodes)) {
        a.episodes.forEach(ep => {
          const normEpUrl = (ep.telegramUrl || '').trim().toLowerCase();
          if (normEpUrl && normEpUrl.length > 5) {
            if (!episodeUrls.has(normEpUrl)) episodeUrls.set(normEpUrl, []);
            episodeUrls.get(normEpUrl)!.push({ anime: a, epNumber: ep.number });
          }
        });
      }
    });

    // Studios
    studios.forEach(s => {
      const norm = getNormalizedKey(s.name);
      if (norm) {
        if (!studioNames.has(norm)) studioNames.set(norm, []);
        studioNames.get(norm)!.push(s);
      }
    });

    // Genres
    genres.forEach(g => {
      const norm = getNormalizedKey(g.name);
      if (norm) {
        if (!genreNames.has(norm)) genreNames.set(norm, []);
        genreNames.get(norm)!.push(g);
      }
    });

    const titleDupes = Array.from(titles.values()).filter(g => g.length > 1);
    const telegramDupes = Array.from(telegrams.values()).filter(g => g.length > 1);
    const coverDupes = Array.from(covers.values()).filter(g => g.length > 1);
    const episodeLinkDupes = Array.from(episodeUrls.values()).filter(g => g.length > 1);
    const studioDupes = Array.from(studioNames.values()).filter(g => g.length > 1);
    const genreDupes = Array.from(genreNames.values()).filter(g => g.length > 1);

    const totalDuplicateAnimesCount = new Set([
      ...titleDupes.flatMap(g => g.slice(1).map(x => x.id)),
      ...telegramDupes.flatMap(g => g.slice(1).map(x => x.id)),
      ...coverDupes.flatMap(g => g.slice(1).map(x => x.id)),
      ...episodeLinkDupes.flatMap(g => g.slice(1).map(x => x.anime.id))
    ]).size;

    const totalOtherDuplicates = studioDupes.length + genreDupes.length;

    return {
      titleDupes,
      telegramDupes,
      coverDupes,
      episodeLinkDupes,
      studioDupes,
      genreDupes,
      totalDuplicates: totalDuplicateAnimesCount + totalOtherDuplicates
    };
  }, [animes, studios, genres]);

  // Backup state
  const [backupStatus, setBackupStatus] = useState('');
  const [backupProgress, setBackupProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [importJson, setImportJson] = useState('');
  const [parsedBackupData, setParsedBackupData] = useState<any | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isOptimizingCovers, setIsOptimizingCovers] = useState(false);

  // Custom Confirmation Modal & UI Notifications
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'anime' | 'studio' | 'genre' | 'backup';
    id: string;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const [selectedAnimeDetails, setSelectedAnimeDetails] = useState<Anime | null>(null);

  // Firebase Live Connection Status state - starts in active live verification
  const [firebaseStatus, setFirebaseStatus] = useState<{
    loading: boolean;
    connected: boolean;
    projectId?: string;
    message?: string;
    lastChecked?: Date;
  }>({
    loading: true,
    connected: false,
    projectId: 'khentai'
  });

  // Firebase Quotas & Storage State
  const [quotaStats, setQuotaStats] = useState<{
    loading: boolean;
    data: any | null;
    error: string | null;
    lastUpdated?: Date;
  }>({
    loading: false,
    data: null,
    error: null
  });

  const fetchFirebaseQuotaStats = async () => {
    setQuotaStats(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch('/api/firebase/quota', { headers: apiHeaders });
      if (res.ok) {
        const json = await res.json();
        setQuotaStats({
          loading: false,
          data: json,
          error: null,
          lastUpdated: new Date()
        });
      } else {
        setQuotaStats(prev => ({
          ...prev,
          loading: false,
          error: 'No se pudieron obtener las estadísticas de cuotas de Firebase.'
        }));
      }
    } catch (err: any) {
      setQuotaStats(prev => ({
        ...prev,
        loading: false,
        error: 'Error de conexión al consultar Firebase.'
      }));
    }
  };

  useEffect(() => {
    if (activeTab === 'firebase-stats') {
      if (!quotaStats.data) {
        fetchFirebaseQuotaStats();
      }
    }
  }, [activeTab, token]);

  const checkFirebaseConnection = async () => {
    setFirebaseStatus(prev => ({ ...prev, loading: true }));
    try {
      // 1. Direct Firebase Firestore client check with 6s timeout (tests live network read from Firestore)
      const directCheckPromise = (async () => {
        const snap = await getDocs(collection(db, 'genres'));
        return snap;
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado al conectar con Firestore (timeout)')), 6000)
      );

      try {
        const snap = await Promise.race([directCheckPromise, timeoutPromise]) as any;
        if (snap) {
          setFirebaseStatus({
            loading: false,
            connected: true,
            projectId: 'khentai',
            message: 'Conectado exitosamente en tiempo real a Firebase Firestore (khentai)',
            lastChecked: new Date()
          });
          return;
        }
      } catch (fbErr: any) {
        console.warn('[Direct Firestore Check Warning]:', fbErr?.message || fbErr);
      }

      // 2. Fallback check via Express API if running on a full server
      const res = await fetch('/api/sync/status').catch(() => null);
      if (res && res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const data = await res.json();
          const isConnected = data.status === 'connected' || data.connected === true;
          setFirebaseStatus({
            loading: false,
            connected: isConnected,
            projectId: data.projectId || 'khentai',
            message: isConnected ? 'Conectado exitosamente a Firebase Firestore' : (data.message || 'Sin conexión activa con Firebase'),
            lastChecked: new Date()
          });
          return;
        }
      }

      // 3. If neither worked:
      setFirebaseStatus({
        loading: false,
        connected: false,
        projectId: 'khentai',
        message: 'Sin conexión activa con Firebase Firestore',
        lastChecked: new Date()
      });
    } catch (err: any) {
      setFirebaseStatus({
        loading: false,
        connected: false,
        projectId: 'khentai',
        message: 'Error al verificar Firebase: ' + (err?.message || 'Error de conexión'),
        lastChecked: new Date()
      });
    }
  };

  const getAuthHeaders = () => {
    const currentToken = token || (typeof window !== 'undefined' ? localStorage.getItem('hk_admin_token') : '') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-admin-email': currentUser?.email || 'kuzeofc@gmail.com'
    };
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }
    return headers;
  };

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const studioFileInputRef = useRef<HTMLInputElement>(null);

  const handleStudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const raw = ev.target?.result as string;
        if (raw) {
          setStudioImage(raw);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
    }
  };

  const isAdminEmail = currentUser?.email?.toLowerCase() === 'kuzeofc@gmail.com';

  // Strict route protection: redirect to home immediately if not authorized admin
  useEffect(() => {
    if (!currentUser || currentUser.email?.toLowerCase().trim() !== 'kuzeofc@gmail.com') {
      onBackToHome();
      if (window.location.pathname === '/admin') {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [currentUser, onBackToHome]);

  // Check auth validity on load and ensure page is scrolled to top upon entering
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, []);

  // Check Firebase connection immediately upon entering admin panel and load trash
  useEffect(() => {
    checkFirebaseConnection();
    fetchTrash();
  }, []);

  useEffect(() => {
    if (isAdminEmail && !token) {
      // Auto-authenticate kuzeofc@gmail.com without asking for a password
      fetch('/api/auth/admin-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser?.email })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.token) {
            localStorage.setItem('hk_admin_token', data.token);
            setToken(data.token);
            onRefresh();
          } else {
            const fallbackToken = 'fb_admin_' + (currentUser?.uid || 'kuzeofc');
            localStorage.setItem('hk_admin_token', fallbackToken);
            setToken(fallbackToken);
            onRefresh();
          }
        })
        .catch(() => {
          // Static hosting fallback (e.g. Vercel)
          const fallbackToken = 'fb_admin_' + (currentUser?.uid || 'kuzeofc');
          localStorage.setItem('hk_admin_token', fallbackToken);
          setToken(fallbackToken);
          onRefresh();
        });
    } else if (token) {
      checkFirebaseConnection();
      fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (!data.valid) {
            if (isAdminEmail) {
              const fallbackToken = 'fb_admin_' + (currentUser?.uid || 'kuzeofc');
              localStorage.setItem('hk_admin_token', fallbackToken);
              setToken(fallbackToken);
            } else {
              handleLogout();
            }
          }
        })
        .catch(() => {
          if (isAdminEmail) {
            const fallbackToken = 'fb_admin_' + (currentUser?.uid || 'kuzeofc');
            setToken(fallbackToken);
          } else {
            handleLogout();
          }
        });
    }
  }, [token, currentUser, isAdminEmail]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem('hk_admin_token', data.token);
        setToken(data.token);
        setUsername('');
        setPassword('');
        onRefresh();
      } else {
        setAuthError(data.error || 'Credenciales inválidas');
      }
    } catch (err) {
      setAuthError('Fallo de conexión con el servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
    localStorage.removeItem('hk_admin_token');
    setToken('');
  };

  const apiHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token || (typeof window !== 'undefined' ? localStorage.getItem('hk_admin_token') : '') || ''}`,
    'x-admin-email': currentUser?.email || 'kuzeofc@gmail.com'
  };

  // --- STUDIO ACTIONS ---
  const handleSaveStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudioError('');
    if (!studioName.trim()) return setStudioError('El nombre es requerido');

    try {
      const url = editingStudio ? `/api/studios/${editingStudio.id}` : '/api/studios';
      const method = editingStudio ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: apiHeaders,
        body: JSON.stringify({ name: studioName.trim(), image: studioImage || '' })
      });

      if (res.ok) {
        const savedStudio = await res.json().catch(() => null);
        setStudioName('');
        setStudioImage('');
        setEditingStudio(null);
        onRefresh();
        const loc = savedStudio?.storageLocation || 'Firebase Firestore (khentai)';
        showNotification(
          editingStudio ? `Estudio actualizado con éxito en ${loc}` : `Estudio creado con éxito en ${loc}`,
          'success'
        );
      } else {
        if (res.status === 401) {
          handleLogout();
          return setStudioError('Tu sesión ha expirado. Por favor vuelve a ingresar.');
        }
        const errData = await res.json().catch(() => ({}));
        setStudioError(errData.error || 'Error al guardar estudio');
      }
    } catch (err) {
      // Fallback local save if network error occurs
      const fallbackStudio: Studio = {
        id: editingStudio ? editingStudio.id : 'st-' + Math.random().toString(36).substring(2, 9),
        name: studioName.trim()
      };
      try {
        const localStudios = JSON.parse(localStorage.getItem('hk_user_studios') || '[]');
        const idx = localStudios.findIndex((s: any) => s.id === fallbackStudio.id);
        if (idx >= 0) localStudios[idx] = fallbackStudio; else localStudios.push(fallbackStudio);
        localStorage.setItem('hk_user_studios', JSON.stringify(localStudios));
        setStudioName('');
        setEditingStudio(null);
        onRefresh();
        showNotification('Estudio guardado localmente (sin conexión con servidor)', 'success');
      } catch (e) {
        setStudioError('Error al guardar el estudio localmente.');
      }
    }
  };

  const executeDeleteStudio = async (id: string) => {
    try {
      const res = await fetch(`/api/studios/${id}`, { method: 'DELETE', headers: apiHeaders });
      if (res.ok) {
        try {
          // Remove from local replica
          const localStudios = JSON.parse(localStorage.getItem('hk_user_studios') || '[]');
          const updated = localStudios.filter((s: any) => s.id !== id);
          localStorage.setItem('hk_user_studios', JSON.stringify(updated));

          // Add to deleted list
          const deletedIds = JSON.parse(localStorage.getItem('hk_deleted_studio_ids') || '[]');
          if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            localStorage.setItem('hk_deleted_studio_ids', JSON.stringify(deletedIds));
          }
        } catch (e) {
          console.error(e);
        }

        onRefresh();
        showNotification('Estudio eliminado con éxito', 'success');
      } else {
        const errData = await res.json().catch(() => ({}));
        showNotification(errData.error || 'Error al eliminar estudio. Asegúrate de que no tenga animes asociados.', 'error');
      }
    } catch (err) {
      showNotification('Error de red al eliminar.', 'error');
    }
  };

  const handleDeleteStudio = (id: string) => {
    const studio = studios.find(s => s.id === id);
    setDeleteConfirm({
      type: 'studio',
      id,
      title: 'Eliminar Estudio',
      message: `¿Seguro que deseas eliminar el estudio "${studio?.name || 'este estudio'}"? Se perderá la relación con los animes.`,
      onConfirm: () => executeDeleteStudio(id)
    });
  };

  // --- GENRE ACTIONS ---
  const handleSaveGenre = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenreError('');
    if (!genreName.trim()) return setGenreError('El nombre es requerido');

    try {
      const url = editingGenre ? `/api/genres/${editingGenre.id}` : '/api/genres';
      const method = editingGenre ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: apiHeaders,
        body: JSON.stringify({ name: genreName })
      });

      if (res.ok) {
        const savedGenre = await res.json().catch(() => null);
        setGenreName('');
        setEditingGenre(null);
        onRefresh();
        const loc = savedGenre?.storageLocation || 'Firebase Firestore (khentai)';
        showNotification(
          editingGenre ? `Género actualizado con éxito en ${loc}` : `Género creado con éxito en ${loc}`,
          'success'
        );
      } else {
        if (res.status === 401) {
          handleLogout();
          return setGenreError('Tu sesión ha expirado. Por favor vuelve a ingresar.');
        }
        const errData = await res.json().catch(() => ({}));
        setGenreError(errData.error || 'Error al guardar género');
      }
    } catch (err) {
      // Fallback local save if network error occurs
      const fallbackGenre: Genre = {
        id: editingGenre ? editingGenre.id : 'gn-' + Math.random().toString(36).substring(2, 9),
        name: genreName.trim()
      };
      try {
        const localGenres = JSON.parse(localStorage.getItem('hk_user_genres') || '[]');
        const idx = localGenres.findIndex((g: any) => g.id === fallbackGenre.id);
        if (idx >= 0) localGenres[idx] = fallbackGenre; else localGenres.push(fallbackGenre);
        localStorage.setItem('hk_user_genres', JSON.stringify(localGenres));
        setGenreName('');
        setEditingGenre(null);
        onRefresh();
        showNotification('Género guardado localmente (sin conexión con servidor)', 'success');
      } catch (e) {
        setGenreError('Error al guardar el género localmente.');
      }
    }
  };

  const executeDeleteGenre = async (id: string) => {
    try {
      const res = await fetch(`/api/genres/${id}`, { method: 'DELETE', headers: apiHeaders });
      if (res.ok) {
        try {
          // Remove from local replica
          const localGenres = JSON.parse(localStorage.getItem('hk_user_genres') || '[]');
          const updated = localGenres.filter((g: any) => g.id !== id);
          localStorage.setItem('hk_user_genres', JSON.stringify(updated));

          // Add to deleted list
          const deletedIds = JSON.parse(localStorage.getItem('hk_deleted_genre_ids') || '[]');
          if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            localStorage.setItem('hk_deleted_genre_ids', JSON.stringify(deletedIds));
          }
        } catch (e) {
          console.error(e);
        }

        onRefresh();
        showNotification('Género eliminado con éxito', 'success');
      } else {
        const errData = await res.json().catch(() => ({}));
        showNotification(errData.error || 'Error al eliminar género.', 'error');
      }
    } catch (err) {
      showNotification('Error de red al eliminar.', 'error');
    }
  };

  const handleDeleteGenre = (id: string) => {
    const genre = genres.find(g => g.id === id);
    setDeleteConfirm({
      type: 'genre',
      id,
      title: 'Eliminar Género',
      message: `¿Seguro que deseas eliminar el género "${genre?.name || 'este género'}"?`,
      onConfirm: () => executeDeleteGenre(id)
    });
  };

  // --- ANIME ACTIONS ---
  const openNewAnimeForm = () => {
    setEditingAnime(null);
    setAnimeName('');
    setAnimeImage('');
    
    // Default to the last studio explicitly used by the admin, or empty if none used yet
    let defaultStudioId = lastUsedStudio.id;
    let defaultStudioSearch = lastUsedStudio.search;

    if (!defaultStudioSearch) {
      try {
        const saved = localStorage.getItem('kh_admin_last_used_studio');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed?.search) {
            defaultStudioId = parsed.id || '';
            defaultStudioSearch = parsed.search;
          }
        }
      } catch (e) {}
    }

    setAnimeStudioId(defaultStudioId);
    setAnimeStudioSearch(defaultStudioSearch);
    setAnimeGenreIds([]);
    setAnimeGenresInput('');
    setAnimeStatus('Finalizado');
    setAnimeYear('');
    setAnimeDescription('');
    setAnimeTelegramUrl('');
    setSingleEpIsNew(false);
    setAnimeEpisodes([]);
    setAnimeHidden(false);
    setIsImageOptimized(false);
    setAnimeFormError('');
    setIsAnimeFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEditAnimeForm = (anime: Anime) => {
    setEditingAnime(anime);
    setAnimeName(anime.name);
    setAnimeImage((anime.coverData && anime.coverData.startsWith('data:image/')) ? anime.coverData : anime.image);
    setIsImageOptimized(false);
    
    const sIds = (anime.studioIds && anime.studioIds.length > 0)
      ? anime.studioIds
      : (anime.studioId ? [anime.studioId] : []);
    setAnimeStudioId(anime.studioId || (sIds[0] || ''));
    
    const currentStudioNames = sIds
      .map(id => studios.find(s => s.id === id)?.name || '')
      .filter(Boolean)
      .join(', ');
    setAnimeStudioSearch(currentStudioNames);

    setAnimeGenreIds(anime.genreIds || []);
    
    // Pre-populate input field with existing genre names separated by comma
    const initialGenreNames = (anime.genreIds || [])
      .map(id => {
        const g = genres.find(x => x.id === id);
        return g ? g.name : '';
      })
      .filter(Boolean)
      .join(', ');
    setAnimeGenresInput(initialGenreNames);

    const rawStatus = anime.status || 'Finalizado';
    const cleanStatus = (rawStatus.toLowerCase().includes('emisi') || rawStatus === 'Próximamente') ? 'Emisión' : 'Finalizado';
    setAnimeStatus(cleanStatus);
    setAnimeYear(anime.year || '');
    setAnimeDescription(anime.description || '');
    setAnimeTelegramUrl(anime.telegramUrl || '');
    
    const firstEpIsNew = anime.episodes && anime.episodes.length > 0
      ? Boolean(anime.episodes[0]?.isNew)
      : false;
    setSingleEpIsNew(firstEpIsNew);

    if (anime.episodes && anime.episodes.length > 0) {
      setAnimeEpisodes(anime.episodes.map(ep => ({
        number: Number(ep.number) || 1,
        telegramUrl: String(ep.telegramUrl || ep.url || ep.videoUrl || ep.mp4Url || ep.link || '').trim(),
        isNew: Boolean(ep.isNew),
        addedToRecentAt: ep.addedToRecentAt,
        coverImage: ep.coverImage,
        thumbnail: ep.thumbnail,
        title: ep.title
      })));
    } else {
      setAnimeEpisodes([]);
    }

    setAnimeHidden(anime.hidden);
    setAnimeFormError('');
    setIsAnimeFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleEpisodeNew = (index: number) => {
    setAnimeEpisodes(prev => {
      const updated = [...prev];
      const nextIsNew = !updated[index].isNew;
      updated[index] = { 
        ...updated[index], 
        isNew: nextIsNew,
        addedToRecentAt: nextIsNew 
          ? new Date().toISOString()
          : undefined
      };
      return updated;
    });
  };

  const handleEpisodeCoverUpload = (index: number, file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        // Sin optimización: se conserva la imagen original sin comprimir ni redimensionar
        setAnimeEpisodes(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], coverImage: result };
          return updated;
        });
        showNotification(`Portada lista para el Episodio ${animeEpisodes[index]?.number || (index + 1)}`, 'success');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleEpisodeThumbnailUpload = (index: number, file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        // Sin optimización: se conserva la imagen original sin comprimir ni redimensionar
        setAnimeEpisodes(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], thumbnail: result };
          return updated;
        });
        showNotification(`Miniatura lista para el Episodio ${animeEpisodes[index]?.number || (index + 1)}`, 'success');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddEpisode = () => {
    if (animeEpisodes.length >= 12) {
      showNotification('Se ha alcanzado el límite máximo de 12 episodios por anime.', 'error');
      return;
    }
    const nextNum = animeEpisodes.length > 0
      ? Math.max(...animeEpisodes.map(ep => Number(ep.number) || 0)) + 1
      : 1;
    setAnimeEpisodes(prev => [...prev, { number: nextNum, telegramUrl: '', isNew: false }]);
  };

  const handleAddMultipleEpisodes = (count: number) => {
    if (animeEpisodes.length >= 12) {
      showNotification('Se ha alcanzado el límite máximo de 12 episodios por anime.', 'error');
      return;
    }
    const availableSlots = 12 - animeEpisodes.length;
    const toAdd = Math.min(count, availableSlots);
    if (toAdd <= 0) return;

    setAnimeEpisodes(prev => {
      const nextNum = prev.length > 0
        ? Math.max(...prev.map(ep => Number(ep.number) || 0)) + 1
        : 1;
      const newEps = [];
      for (let i = 0; i < toAdd; i++) {
        newEps.push({ number: nextNum + i, telegramUrl: '', isNew: false });
      }
      return [...prev, ...newEps];
    });

    showNotification(`Se agregaron ${toAdd} campo(s) de episodio.`, 'success');
  };

  const handleUpdateEpisodeNumber = (index: number, numVal: any) => {
    setAnimeEpisodes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], number: Number(numVal) || 1 };
      return updated;
    });
  };

  const handleEpisodeUrlChange = (index: number, value: string) => {
    const urlVal = value.trim();
    setAnimeEpisodes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], telegramUrl: value };

      // If a link/URL is pasted or entered
      if (urlVal.length > 8 || urlVal.startsWith('http') || urlVal.includes('archive.org')) {
        // Look for subsequent empty chapter fields after index
        const nextEmptyIdx = updated.findIndex((ep, i) => i > index && (!ep.telegramUrl || ep.telegramUrl.trim() === ''));
        
        if (nextEmptyIdx !== -1) {
          // There are still empty chapter fields AFTER this index!
          // Focus the next empty input field so the user can paste immediately without losing keyboard
          setTimeout(() => {
            episodeInputRefs.current[nextEmptyIdx]?.focus();
          }, 60);
        } else {
          // Check if there are ANY other empty chapter fields anywhere in the list
          const anyEmptyIdx = updated.findIndex((ep, i) => i !== index && (!ep.telegramUrl || ep.telegramUrl.trim() === ''));
          if (anyEmptyIdx !== -1) {
            setTimeout(() => {
              episodeInputRefs.current[anyEmptyIdx]?.focus();
            }, 60);
          } else {
            // NO MORE empty chapter fields remaining! All chapter inputs now have links.
            // Dismiss/lower the keyboard automatically
            setTimeout(() => {
              (document.activeElement as HTMLElement)?.blur();
              if (episodeInputRefs.current[index]) {
                episodeInputRefs.current[index]?.blur();
              }
            }, 60);
          }
        }
      }

      return updated;
    });
  };

  const handleRemoveEpisode = (index: number) => {
    setAnimeEpisodes(prev => prev.filter((_, i) => i !== index));
  };

  const handleToggleGenreInput = (genreName: string) => {
    const current = animeGenresInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    const targetKey = getNormalizedKey(genreName);
    const index = current.findIndex(s => getNormalizedKey(s) === targetKey);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(genreName);
    }
    setAnimeGenresInput(current.join(', '));
  };

  const handleToggleStudioInput = (sName: string) => {
    const current = animeStudioSearch
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    const targetKey = getNormalizedKey(sName);
    const index = current.findIndex(s => getNormalizedKey(s) === targetKey);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(sName);
    }
    const newStudioSearch = current.join(', ');
    setAnimeStudioSearch(newStudioSearch);
    if (newStudioSearch.trim()) {
      updateLastUsedStudio(newStudioSearch);
    }
  };

  const handleDeduplicate = async () => {
    setIsDeduplicating(true);
    try {
      const res = await fetch('/api/admin/deduplicate', {
        method: 'POST',
        headers: apiHeaders
      });
      if (res.ok) {
        const data = await res.json();
        onRefresh();
        showNotification(`Unificación completada: ${data.studiosMerged || 0} estudios y ${data.genresMerged || 0} géneros unificados.`, 'success');
      } else {
        showNotification('Error al unificar la base de datos.', 'error');
      }
    } catch (err) {
      showNotification('Error de conexión al unificar.', 'error');
    } finally {
      setIsDeduplicating(false);
    }
  };

  const handleGenreCheckboxChange = (genreId: string) => {
    if (animeGenreIds.includes(genreId)) {
      setAnimeGenreIds(animeGenreIds.filter(id => id !== genreId));
    } else {
      setAnimeGenreIds([...animeGenreIds, genreId]);
    }
  };

  const processImageFile = async (file: File) => {
    setImageUploadLoading(true);
    setAnimeFormError('');

    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|heic|svg)$/i.test(file.name);
    if (!isImage) {
      setAnimeFormError('El archivo seleccionado no es una imagen válida (.jpg, .png, .webp)');
      setImageUploadLoading(false);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const rawBase64 = event.target?.result as string;
        if (rawBase64) {
          // Sin optimización: se conserva la imagen 100% original
          setAnimeImage(rawBase64);
          setIsImageOptimized(false);
        }
        setImageUploadLoading(false);
      };
      reader.onerror = () => {
        setAnimeFormError('Error al leer el archivo de imagen.');
        setImageUploadLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setAnimeFormError('Error de carga de imagen.');
      setImageUploadLoading(false);
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processImageFile(file);
    }
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processImageFile(file);
    }
  };

  const handleSaveAnime = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnimeFormError('');

    const trimmedName = animeName.trim();
    if (!trimmedName) return setAnimeFormError('El nombre es requerido');
    
    const trimmedStudioSearch = animeStudioSearch.trim();
    if (!trimmedStudioSearch) return setAnimeFormError('Al menos un estudio de animación es requerido');
    
    if (!animeTelegramUrl.trim()) return setAnimeFormError('El enlace de Telegram es requerido');

    // Parse and dynamically create/find multiple studios!
    const targetStudioIds: string[] = [];
    const typedStudios = animeStudioSearch
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);

    if (typedStudios.length === 0) {
      return setAnimeFormError('Al menos un estudio de animación es requerido');
    }

    for (const sName of typedStudios) {
      const reqStudioKey = getNormalizedKey(sName);
      const existingStudio = studios.find(
        s => getNormalizedKey(s.name) === reqStudioKey
      );

      if (existingStudio) {
        if (!targetStudioIds.includes(existingStudio.id)) {
          targetStudioIds.push(existingStudio.id);
        }
      } else {
        // Dynamic on-the-fly studio creation!
        try {
          const res = await fetch('/api/studios', {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ name: sName, order: 10 })
          });
          if (res.ok) {
            const newStudio = await res.json();
            if (!targetStudioIds.includes(newStudio.id)) {
              targetStudioIds.push(newStudio.id);
            }
            // Refresh parent studios state so the local cache is perfectly up-to-date
            onRefresh();
          } else {
            const errData = await res.json().catch(() => ({}));
            return setAnimeFormError(errData.error || `Error al crear el nuevo estudio automático: ${sName}`);
          }
        } catch (err) {
          return setAnimeFormError(`Error de red al crear el estudio automático: ${sName}`);
        }
      }
    }

    const primaryStudioId = targetStudioIds[0] || '';

    // Parse and dynamically create/find genres!
    const targetGenreIds: string[] = [];
    const typedGenres = animeGenresInput
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);

    for (const gName of typedGenres) {
      const reqGenreKey = getNormalizedKey(gName);
      const existingG = genres.find(
        g => getNormalizedKey(g.name) === reqGenreKey
      );
      if (existingG) {
        if (!targetGenreIds.includes(existingG.id)) {
          targetGenreIds.push(existingG.id);
        }
      } else {
        // Create the genre on-the-fly!
        try {
          const res = await fetch('/api/genres', {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ name: gName, order: 10 })
          });
          if (res.ok) {
            const newGenre = await res.json();
            if (!targetGenreIds.includes(newGenre.id)) {
              targetGenreIds.push(newGenre.id);
            }
            // Refresh parent genres state so the local cache is perfectly up-to-date
            onRefresh();
          } else {
            const errData = await res.json().catch(() => ({}));
            return setAnimeFormError(errData.error || `Error al crear el género automático: ${gName}`);
          }
        } catch (err) {
          return setAnimeFormError(`Error de red al crear el género automático: ${gName}`);
        }
      }
    }

    let cleanEpisodes = animeEpisodes
      .map((ep, idx) => {
        const link = String(ep.telegramUrl || '').trim();
        const epNum = Number(ep.number) || 1;
        const origEp = editingAnime?.episodes?.find((e: any) => Number(e.number) === epNum);
        const isNew = Boolean(ep.isNew);
        const wasCurrentlyInRecents = Boolean(origEp?.isNew && origEp?.addedToRecentAt);
        const preservedTimestamp = wasCurrentlyInRecents ? (ep.addedToRecentAt || origEp?.addedToRecentAt) : undefined;
        const preservedCover = ep.coverImage !== undefined ? ep.coverImage : origEp?.coverImage;
        const preservedThumbnail = ep.thumbnail !== undefined ? ep.thumbnail : origEp?.thumbnail;
        return {
          number: epNum,
          telegramUrl: link,
          url: link,
          videoUrl: link,
          mp4Url: link,
          link: link,
          isNew,
          addedToRecentAt: isNew ? (preservedTimestamp || new Date(Date.now() + idx).toISOString()) : undefined,
          coverImage: preservedCover,
          thumbnail: preservedThumbnail,
          title: ep.title || origEp?.title
        };
      })
      .filter(ep => ep.telegramUrl !== '')
      .slice(0, 12);

    const primaryTelegramUrl = animeTelegramUrl.trim();

    if (!primaryTelegramUrl) {
      return setAnimeFormError('El enlace de Telegram es requerido.');
    }

    if (cleanEpisodes.length === 0 && singleEpIsNew && primaryTelegramUrl) {
      cleanEpisodes = [{
        number: 1,
        telegramUrl: primaryTelegramUrl,
        url: primaryTelegramUrl,
        videoUrl: primaryTelegramUrl,
        mp4Url: primaryTelegramUrl,
        link: primaryTelegramUrl,
        isNew: true,
        addedToRecentAt: editingAnime?.episodes?.[0]?.addedToRecentAt || new Date().toISOString(),
        coverImage: editingAnime?.episodes?.[0]?.coverImage
      }];
    }

    const finalCover = animeImage;

    const payload = {
      name: trimmedName,
      image: finalCover,
      coverData: finalCover.startsWith('data:image/') ? finalCover : (editingAnime?.coverData || ''),
      studioId: primaryStudioId,
      studioIds: targetStudioIds,
      genreIds: targetGenreIds,
      status: animeStatus || 'Finalizado',
      year: normalizeAnimeYear(animeYear),
      description: animeDescription,
      telegramUrl: primaryTelegramUrl,
      episodes: cleanEpisodes,
      hidden: animeHidden,
    };

    try {
      const url = editingAnime ? `/api/animes/${editingAnime.id}` : '/api/animes';
      const method = editingAnime ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: apiHeaders,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const savedAnime = await res.json().catch(() => null);
        updateLastUsedStudio(trimmedStudioSearch, primaryStudioId);
        setIsAnimeFormOpen(false);
        setEditingAnime(null);
        onRefresh();
        
        if (savedAnime?.savedInFirestore === false) {
          showNotification(
            `⚠️ Guardado en servidor local. Error en Firebase: ${savedAnime.firestoreError || 'Sin conexión activa'}`,
            'error'
          );
        } else {
          showNotification(
            editingAnime ? `✅ ¡Anime y Portada actualizados correctamente en Firebase Firestore!` : `✅ ¡Anime y Portada creados correctamente en Firebase Firestore!`,
            'success'
          );
        }
      } else {
        if (res.status === 401) {
          handleLogout();
          return setAnimeFormError('Tu sesión ha expirado. Por favor vuelve a ingresar.');
        }
        // Direct Firebase Firestore Fallback (e.g. Vercel deployment where Express /api/ does not exist)
        try {
          const targetId = editingAnime ? editingAnime.id : (payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('anime-' + Date.now()));
          const fsData = {
            ...payload,
            id: targetId,
            createdAt: editingAnime?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            storageLocation: 'Firebase Firestore (khentai)',
            savedInFirestore: true
          };
          await setDoc(doc(db, 'animes', targetId), fsData, { merge: true });
          updateLastUsedStudio(trimmedStudioSearch, primaryStudioId);
          setIsAnimeFormOpen(false);
          setEditingAnime(null);
          onRefresh();
          showNotification(
            editingAnime ? `✅ ¡Anime actualizado directamente en Firebase Firestore!` : `✅ ¡Anime creado directamente en Firebase Firestore!`,
            'success'
          );
          return;
        } catch (fbErr: any) {
          const errData = await res.json().catch(() => ({}));
          setAnimeFormError(errData.error || fbErr?.message || 'Error al guardar anime');
        }
      }
    } catch (err: any) {
      // Direct Firebase Firestore Fallback on Network Error / static hosting
      try {
        const targetId = editingAnime ? editingAnime.id : (payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('anime-' + Date.now()));
        const fsData = {
          ...payload,
          id: targetId,
          createdAt: editingAnime?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          storageLocation: 'Firebase Firestore (khentai)',
          savedInFirestore: true
        };
        await setDoc(doc(db, 'animes', targetId), fsData, { merge: true });
        updateLastUsedStudio(trimmedStudioSearch, primaryStudioId);
        setIsAnimeFormOpen(false);
        setEditingAnime(null);
        onRefresh();
        showNotification(
          editingAnime ? `✅ ¡Anime actualizado directamente en Firebase Firestore!` : `✅ ¡Anime creado directamente en Firebase Firestore!`,
          'success'
        );
      } catch (fbErr: any) {
        setAnimeFormError('Error al guardar anime: ' + (fbErr.message || 'Error de red'));
      }
    }
  };

  const executeDeleteAnime = async (id: string) => {
    const targetAnime = animes.find(a => a.id === id);
    if (targetAnime?.name) {
      recordDeletedAnime(targetAnime.name);
    }
    try {
      const res = await fetch(`/api/animes/${id}`, { method: 'DELETE', headers: apiHeaders }).catch(() => null);
      if (res && res.ok) {
        onRefresh();
        showNotification('Anime eliminado y movido a la papelera', 'success');
        return;
      }
      // Direct Firestore fallback for Vercel/Static hosting
      await deleteDoc(doc(db, 'animes', id));
      onRefresh();
      showNotification('Anime eliminado y movido a la papelera', 'success');
    } catch (err: any) {
      try {
        await deleteDoc(doc(db, 'animes', id));
        onRefresh();
        showNotification('Anime eliminado y movido a la papelera', 'success');
      } catch (fbErr: any) {
        showNotification('Error al eliminar: ' + (fbErr?.message || 'Error de red'), 'error');
      }
    }
  };

  const handleDeleteAnime = (id: string) => {
    const anime = animes.find(a => a.id === id);
    setDeleteConfirm({
      type: 'anime',
      id,
      title: 'Eliminar Anime',
      message: `¿Seguro que deseas eliminar el anime "${anime?.name || 'este anime'}" de forma permanente? Esta acción no se puede deshacer.`,
      onConfirm: () => executeDeleteAnime(id)
    });
  };

  const handleToggleAnimeHidden = async (anime: Anime) => {
    try {
      const res = await fetch(`/api/animes/${anime.id}`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({ hidden: !anime.hidden })
      });
      if (res.ok) {
        const savedAnime = await res.json().catch(() => null);
        if (savedAnime) {
          try {
            const localAnimes = JSON.parse(localStorage.getItem('hk_user_animes') || '[]');
            const idx = localAnimes.findIndex((a: any) => a.id === savedAnime.id);
            if (idx >= 0) {
              localAnimes[idx] = savedAnime;
            } else {
              localAnimes.push(savedAnime);
            }
            localStorage.setItem('hk_user_animes', JSON.stringify(localAnimes));
          } catch (e) {
            console.error(e);
          }
        }
        onRefresh();
        showNotification(`Anime ${!anime.hidden ? 'ocultado' : 'visible'} correctamente`, 'success');
      }
    } catch (err) {
      showNotification('Error de conexión.', 'error');
    }
  };

  const handleDeduplicateAnimes = async () => {
    setIsDeduplicatingAnimes(true);
    try {
      const res = await fetch('/api/admin/deduplicate-animes', {
        method: 'POST',
        headers: apiHeaders,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onRefresh();
        showNotification(
          `Unificación completada: ${data.animesMerged} animes unificados (${data.titlesUnified} por título, ${data.telegramLinksUnified || 0} por enlace principal, ${data.episodeLinksUnified || 0} por enlace de episodios, ${data.coversUnified || 0} por imagen, ${data.studiosMerged || 0} estudios y ${data.genresMerged || 0} géneros).`,
          'success'
        );
        setShowDuplicatesModal(false);
      } else {
        showNotification(data.error || 'Error al unificar duplicados', 'error');
      }
    } catch (err) {
      showNotification('Error de red al unificar duplicados.', 'error');
    } finally {
      setIsDeduplicatingAnimes(false);
    }
  };

  // --- BACKUP ACTIONS ---
  const handleExportBackup = async () => {
    setIsExporting(true);
    setBackupStatus('Generando archivo de copia de seguridad con todos los datos y portadas...');
    try {
      const res = await fetch('/api/backup/export', { headers: apiHeaders });
      if (res.ok) {
        const schema = await res.json();
        const jsonStr = JSON.stringify(schema, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const downloadUrl = URL.createObjectURL(blob);
        const dlAnchor = document.createElement('a');
        dlAnchor.href = downloadUrl;
        dlAnchor.download = `kuzehentai_backup_completo_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

        const animeCount = schema.animes?.length || schema.stats?.totalAnimes || 0;
        const epCount = schema.stats?.totalEpisodes || 0;
        const statusMsg = `Copia de seguridad descargada con éxito (${animeCount} animes, ${epCount > 0 ? epCount + ' episodios, ' : ''}portadas integradas, estudios y géneros).`;
        setBackupStatus(statusMsg);
        showNotification('Copia de seguridad completa descargada', 'success');
      } else {
        setBackupStatus('Error al generar la copia de seguridad.');
        showNotification('Error al exportar base de datos.', 'error');
      }
    } catch (err) {
      setBackupStatus('Fallo de conexión al descargar el respaldo.');
      showNotification('Error de red al exportar.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleResetPopularityOnly = async () => {
    setDeleteConfirm({
      type: 'backup',
      id: 'reset-popularity',
      title: 'REINICIAR MÁS POPULARES A CERO',
      message: '¿Estás seguro de que deseas reiniciar a cero el contador de vistas y popularidad de la sección "Más Populares"? Las calificaciones de estrellas y comentarios permanecerán intactos.',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/reset-popularity', {
            method: 'POST',
            headers: apiHeaders
          });
          if (res.ok) {
            onRefresh();
            showNotification('Contador de Más Populares reiniciado a cero.', 'success');
          } else {
            showNotification('Error al reiniciar popularidad.', 'error');
          }
        } catch (err) {
          showNotification('Error de red al reiniciar popularidad.', 'error');
        } finally {
          setDeleteConfirm(null);
        }
      }
    });
  };

  const handleResetRatingsOnly = async () => {
    setDeleteConfirm({
      type: 'backup',
      id: 'reset-ratings',
      title: 'REINICIAR CALIFICACIONES A CERO',
      message: '¿Estás seguro de que deseas reiniciar a cero todas las calificaciones de estrellas de todos los animes? El contador de más populares y los comentarios permanecerán intactos.',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/reset-ratings', {
            method: 'POST',
            headers: apiHeaders
          });
          if (res.ok) {
            try {
              window.dispatchEvent(new CustomEvent('kh_clear_ratings_cache'));
            } catch (e) {}
            onRefresh();
            showNotification('Calificaciones de estrellas reiniciadas a cero.', 'success');
          } else {
            showNotification('Error al reiniciar calificaciones.', 'error');
          }
        } catch (err) {
          showNotification('Error de red al reiniciar calificaciones.', 'error');
        } finally {
          setDeleteConfirm(null);
        }
      }
    });
  };

  const handleResetCommentsOnly = async () => {
    setDeleteConfirm({
      type: 'backup',
      id: 'reset-comments',
      title: 'ELIMINAR TODOS LOS COMENTARIOS',
      message: '¿Estás seguro de que deseas eliminar permanentemente todos los comentarios de la comunidad? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/reset-comments', {
            method: 'POST',
            headers: apiHeaders
          });
          if (res.ok) {
            onRefresh();
            showNotification('Todos los comentarios han sido eliminados correctamente.', 'success');
          } else {
            showNotification('Error al eliminar comentarios.', 'error');
          }
        } catch (err) {
          showNotification('Error de red al eliminar comentarios.', 'error');
        } finally {
          setDeleteConfirm(null);
        }
      }
    });
  };

  const handleResetPopularityAndRatings = async () => {
    setDeleteConfirm({
      type: 'backup',
      id: 'reset-stats',
      title: 'REINICIAR POPULARIDAD Y CALIFICACIONES A CERO',
      message: '¿Estás seguro de que deseas reiniciar a cero los contadores de más populares y todas las calificaciones de estrellas de los animes? Tus animes, enlaces y episodios permanecerán intactos.',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/reset-stats', {
            method: 'POST',
            headers: apiHeaders
          });
          if (res.ok) {
            try {
              window.dispatchEvent(new CustomEvent('kh_clear_ratings_cache'));
            } catch (e) {}
            onRefresh();
            showNotification('Popularidad y calificaciones de estrellas reiniciadas a cero.', 'success');
          } else {
            showNotification('Error al reiniciar estadísticas.', 'error');
          }
        } catch (err) {
          showNotification('Error de red al reiniciar estadísticas.', 'error');
        } finally {
          setDeleteConfirm(null);
        }
      }
    });
  };

  const handleCleanEpisodes = async () => {
    try {
      showNotification('Sincronizando y estandarizando episodios en Firebase con únicamente { number, mp4Url }...', 'success');
      const res = await fetch('/api/admin/clean-episodes', {
        method: 'POST',
        headers: apiHeaders
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onRefresh();
        showNotification(
          `Estandarización completada: ${data.migratedAnimesCount} animes y ${data.migratedEpisodesCount} episodios guardados únicamente con "number" y "mp4Url" en Firebase.`,
          'success'
        );
      } else {
        showNotification(data.error || 'Error al estandarizar episodios.', 'error');
      }
    } catch (err) {
      showNotification('Error de conexión al estandarizar episodios.', 'error');
    }
  };

  const handleOptimizeCovers = async () => {
    setIsOptimizingCovers(true);
    showNotification('Iniciando optimización de portadas (> 200 KB)...', 'success');
    try {
      const res = await fetch('/api/admin/optimize-covers', {
        method: 'POST',
        headers: apiHeaders
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onRefresh();
        showNotification(data.message || 'Optimización de portadas completada con éxito.', 'success');
      } else {
        showNotification(data.error || 'Error al optimizar portadas.', 'error');
      }
    } catch (err) {
      showNotification('Error de conexión al optimizar portadas.', 'error');
    } finally {
      setIsOptimizingCovers(false);
    }
  };

  const executeImportBackup = async () => {
    setIsImporting(true);
    setBackupStatus('Preparando importación...');
    setBackupProgress(null);
    try {
      let payload = parsedBackupData;
      if (!payload && importJson.trim()) {
        try {
          payload = JSON.parse(importJson);
        } catch (e) {
          setBackupStatus('El texto ingresado no es un JSON válido.');
          showNotification('JSON inválido en el campo de texto.', 'error');
          setIsImporting(false);
          setBackupProgress(null);
          return;
        }
      }

      if (!payload) {
        setBackupStatus('No se encontró información para importar.');
        showNotification('No hay datos para importar.', 'error');
        setIsImporting(false);
        setBackupProgress(null);
        return;
      }

      // Unwrap nested wrapper objects if present
      let schema: any = payload;
      if (schema.data && typeof schema.data === 'object') schema = schema.data;
      else if (schema.backup && typeof schema.backup === 'object') schema = schema.backup;
      else if (schema.db && typeof schema.db === 'object') schema = schema.db;

      if (Array.isArray(schema)) {
        schema = { animes: schema };
      } else if (typeof schema === 'object' && !schema.animes && !schema.studios && !schema.genres) {
        const values = Object.values(schema);
        if (values.length > 0 && typeof values[0] === 'object' && ((values[0] as any)?.name || (values[0] as any)?.title)) {
          schema = { animes: values };
        }
      }

      let rawAnimes: any[] = [];
      if (Array.isArray(schema.animes)) {
        rawAnimes = schema.animes;
      } else if (schema.animes && typeof schema.animes === 'object') {
        rawAnimes = Object.values(schema.animes);
      }

      const studios = schema.studios || [];
      const genres = schema.genres || [];
      const userLists = schema.userLists || undefined;

      // If no animes, just import studios/genres directly
      if (rawAnimes.length === 0) {
        setBackupStatus('Importando estudios y géneros...');
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(schema)
        });

        if (res.ok) {
          const data = await res.json();
          setBackupStatus(data.message || 'Importación completada con éxito.');
          setImportJson('');
          setParsedBackupData(null);
          setBackupProgress(null);
          onRefresh();
          showNotification('Base de datos restaurada correctamente', 'success');
        } else {
          const errData = await res.json().catch(() => ({}));
          const errorMsg = errData.error || `Error ${res.status}: Falló la importación del respaldo.`;
          setBackupStatus(errorMsg);
          showNotification(errorMsg, 'error');
        }
        return;
      }

      // Chunked import: sends batches of 8 animes to avoid Cloud Run / proxy 32MB payload limit (Error 413)
      setBackupStatus(`Iniciando importación (${rawAnimes.length} animes detectados)...`);
      setBackupProgress({ current: 0, total: rawAnimes.length, percent: 0 });

      // Step 1: Initialize session on backend
      const initRes = await fetch('/api/backup/import-init', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          studios,
          genres,
          userLists,
          totalAnimes: rawAnimes.length
        })
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${initRes.status}: Falló al inicializar importación.`);
      }

      const initData = await initRes.json();
      const sessionId = initData.sessionId;

      // Step 2: Upload animes in small batches of 8
      const BATCH_SIZE = 8;
      const totalAnimes = rawAnimes.length;
      const totalChunks = Math.ceil(totalAnimes / BATCH_SIZE);

      for (let i = 0; i < totalAnimes; i += BATCH_SIZE) {
        const batch = rawAnimes.slice(i, i + BATCH_SIZE);
        const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;
        const currentProcessed = i;
        const percent = Math.min(98, Math.round((currentProcessed / totalAnimes) * 100));

        setBackupProgress({ current: currentProcessed, total: totalAnimes, percent });
        setBackupStatus(`Restaurando lote ${chunkIndex} de ${totalChunks} (${currentProcessed} / ${totalAnimes} animes - ${percent}%)...`);

        const chunkRes = await fetch('/api/backup/import-chunk', {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify({
            sessionId,
            animes: batch
          })
        });

        if (!chunkRes.ok) {
          const errData = await chunkRes.json().catch(() => ({}));
          throw new Error(errData.error || `Error ${chunkRes.status} al procesar lote ${chunkIndex}/${totalChunks}.`);
        }
      }

      // Step 3: Finalize session and save all data
      setBackupProgress({ current: totalAnimes, total: totalAnimes, percent: 99 });
      setBackupStatus('Finalizando guardado y sincronizando base de datos...');

      const finishRes = await fetch('/api/backup/import-finish', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ sessionId })
      });

      if (!finishRes.ok) {
        const errData = await finishRes.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${finishRes.status} al finalizar importación.`);
      }

      const finishData = await finishRes.json();
      setBackupProgress(null);
      setBackupStatus(finishData.message || `¡Base de datos importada exitosamente! ${totalAnimes} animes restaurados.`);
      setImportJson('');
      setParsedBackupData(null);
      onRefresh();
      showNotification('¡Base de datos restaurada correctamente sin errores!', 'success');
    } catch (err: any) {
      const msg = err?.message || 'Error de red o procesamiento al restaurar.';
      setBackupStatus(`Error al restaurar: ${msg}`);
      setBackupProgress(null);
      showNotification(msg, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) throw new Error('El archivo está vacío');
        const parsed = JSON.parse(content);
        setParsedBackupData(parsed);

        let count = 0;
        if (Array.isArray(parsed)) count = parsed.length;
        else if (Array.isArray(parsed.animes)) count = parsed.animes.length;
        else if (parsed.animes && typeof parsed.animes === 'object') count = Object.keys(parsed.animes).length;
        else if (parsed.data?.animes && Array.isArray(parsed.data.animes)) count = parsed.data.animes.length;

        // If large file, avoid pasting tens of megabytes into textarea to prevent browser tab freezing
        if (content.length > 30000) {
          setImportJson(`/* Respaldo cargado: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB - ${count > 0 ? count + ' animes detectados' : 'Estructura lista'}) */`);
        } else {
          setImportJson(content);
        }

        setBackupStatus(`Archivo "${file.name}" cargado (${count > 0 ? count + ' animes detectados' : 'Estructura válida'}). Haz clic en "Aplicar e Importar Respaldo".`);
        showNotification(`Archivo "${file.name}" cargado correctamente.`, 'success');
      } catch (err: any) {
        setParsedBackupData(null);
        setBackupStatus(`El archivo seleccionado no contiene un JSON válido: ${err?.message || ''}`);
        showNotification('El archivo no contiene un formato JSON válido.', 'error');
      }
    };
    reader.onerror = () => {
      setBackupStatus('Error al leer el archivo desde el dispositivo.');
      showNotification('Error al leer el archivo seleccionado.', 'error');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportBackup = async () => {
    if (!parsedBackupData && !importJson.trim()) {
      return setBackupStatus('Selecciona un archivo JSON o pega el código de respaldo.');
    }
    setDeleteConfirm({
      type: 'backup',
      id: 'import',
      title: 'Confirmar Importación',
      message: '¡Atención! Esta acción actualizará los datos de la base de datos (Animes, Estudios y Géneros) y los sincronizará a Firestore. ¿Deseas proceder?',
      onConfirm: () => executeImportBackup()
    });
  };


  // --- LOGIN SCREEN / AUTO AUTH ---
  if (!token) {
    if (isAdminEmail) {
      return (
        <div className="relative min-h-screen flex items-center justify-center bg-[#030303] text-white px-4">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-brand-red/30 border-t-brand-red rounded-full animate-spin mx-auto" />
            <p className="font-mono text-sm text-neutral-300">Iniciando Panel de Control de Administrador...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="relative min-h-screen flex items-center justify-center bg-[#030303] text-white px-4">
        <div className="relative w-full max-w-md z-10 bg-dark-card border border-dark-border rounded-xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-14 h-14 bg-brand-red/10 border border-brand-red/30 rounded-full flex items-center justify-center mx-auto text-brand-red">
            <Lock className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display font-bold text-lg uppercase tracking-wider text-white">
              Acceso Reservado
            </h2>
            <p className="font-sans text-xs text-neutral-400 leading-relaxed">
              El panel de administración está reservado únicamente para la cuenta de administrador (<span className="text-purple-300 font-mono">kuzeofc@gmail.com</span>).
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToHome}
            className="w-full py-2.5 bg-brand-red hover:bg-[#ff3b75] text-white rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Volver al Catálogo
          </button>
        </div>
      </div>
    );
  }

  // --- ADMIN DECK SCREEN ---
  return (
    <div className="min-h-screen bg-dark-bg text-white font-sans flex flex-col">
      {/* Admin Top Header */}
      <header className="border-b border-dark-border bg-dark-card py-3 px-4 sm:px-6 lg:px-8 space-y-3">
        {/* Top Row: Navigation, Firebase Real-Time Status */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Circular back button + Compact Firebase Live Status Badge with visible project */}
          <div className="flex items-center gap-2 flex-nowrap shrink-0">
            <button
              onClick={onBackToHome}
              title="Volver al Catálogo"
              className="w-9 h-9 rounded-full bg-[#0a0a0a] border border-dark-border hover:border-brand-red flex items-center justify-center text-neutral-300 hover:text-white transition-all shadow-md cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            {/* Compact Real-time Firebase Status Indicator right next to back button */}
            <div 
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-all duration-300 shrink-0 select-none ${
                firebaseStatus.loading
                  ? 'bg-neutral-900 border-neutral-700 text-neutral-400'
                  : firebaseStatus.connected
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300 shadow-sm'
                  : 'bg-rose-950/70 border-rose-500/50 text-rose-300 shadow-sm'
              }`}
              title={firebaseStatus.message || (firebaseStatus.connected ? `Conectado a Firebase Firestore (${firebaseStatus.projectId || 'khentai'})` : 'Sin conexión con Firebase')}
            >
              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                firebaseStatus.loading 
                  ? 'bg-neutral-400 animate-pulse' 
                  : firebaseStatus.connected 
                  ? 'bg-emerald-400' 
                  : 'bg-rose-500'
              }`} />
              
              <span className="text-neutral-400 text-[10px] uppercase font-bold tracking-wider shrink-0">
                Firebase:
              </span>
              
              <span className="font-semibold text-white text-[11px] truncate max-w-[120px] sm:max-w-none">
                {firebaseStatus.loading 
                  ? '...' 
                  : firebaseStatus.connected 
                  ? (firebaseStatus.projectId || 'khentai') 
                  : 'Off'}
              </span>

              <button
                type="button"
                onClick={checkFirebaseConnection}
                disabled={firebaseStatus.loading}
                className="p-0.5 hover:bg-white/10 rounded-full transition-colors text-current opacity-70 hover:opacity-100 cursor-pointer shrink-0 ml-0.5"
                title="Comprobar conexión con Firebase"
              >
                <RefreshCw className={`h-3 w-3 ${firebaseStatus.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation Bubbles - Each in its own distinct individual bubble */}
        <div className="w-full flex items-center gap-2 overflow-x-auto scrollbar-none py-1 touch-pan-x">
          <button
            onClick={() => handleTabChange('animes')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'animes'
                ? 'bg-brand-red border-brand-red text-white font-bold shadow-lg shadow-brand-red/30'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Animes</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'animes' ? 'bg-white/20 text-white' : 'bg-white/5 text-neutral-400'
            }`}>{animes.length}</span>
          </button>

          <button
            onClick={() => handleTabChange('episodes')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'episodes'
                ? 'bg-purple-600 border-purple-500 text-white font-bold shadow-lg shadow-purple-600/30'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Episodios</span>
          </button>

          <button
            onClick={() => handleTabChange('studios')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'studios'
                ? 'bg-brand-red border-brand-red text-white font-bold shadow-lg shadow-brand-red/30'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Estudios</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'studios' ? 'bg-white/20 text-white' : 'bg-white/5 text-neutral-400'
            }`}>{studios.length}</span>
          </button>

          <button
            onClick={() => handleTabChange('genres')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'genres'
                ? 'bg-brand-red border-brand-red text-white font-bold shadow-lg shadow-brand-red/30'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Géneros</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'genres' ? 'bg-white/20 text-white' : 'bg-white/5 text-neutral-400'
            }`}>{genres.length}</span>
          </button>

          <button
            onClick={() => setShowDuplicatesModal(true)}
            className="px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border border-dark-border bg-[#0e0e12] text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d] relative cursor-pointer"
            title="Detectar e inspeccionar elementos o enlaces duplicados"
          >
            <Search className="h-3.5 w-3.5 text-brand-red" />
            <span>Duplicados</span>
            {duplicateDiagnostics.totalDuplicates > 0 && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-bold animate-pulse">
                {duplicateDiagnostics.totalDuplicates}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('backup')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'backup'
                ? 'bg-neutral-200 border-neutral-200 text-black font-bold shadow-md'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Backup</span>
          </button>

          <button
            onClick={() => handleTabChange('firebase-stats')}
            className={`px-4 py-2 rounded-full font-mono text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all duration-200 border cursor-pointer ${
              activeTab === 'firebase-stats'
                ? 'bg-amber-500 border-amber-500 text-black font-bold shadow-md shadow-amber-500/20'
                : 'bg-[#0e0e12] border-dark-border text-neutral-400 hover:text-white hover:border-neutral-600 hover:bg-[#16161d]'
            }`}
            title="Consumo de Espacio, Cuentas Registradas y Desglose de Datos"
          >
            <Cloud className={`h-3.5 w-3.5 ${activeTab === 'firebase-stats' ? 'text-black' : 'text-amber-400'}`} />
            <span>Espacio</span>
          </button>
        </div>
      </header>

      {/* Main Admin Content Grid */}
      <main className="flex-grow p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full overflow-hidden">
        <AnimatePresence mode="wait" custom={tabDirection}>
          <motion.div
            key={activeTab}
            custom={tabDirection}
            initial={(dir: number) => ({ opacity: 0, x: dir >= 0 ? 50 : -50 })}
            animate={{ opacity: 1, x: 0 }}
            exit={(dir: number) => ({ opacity: 0, x: dir >= 0 ? -50 : 50 })}
            transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
          >
        {/* --- ANIMES TAB --- */}
        {activeTab === 'animes' && (
          <div className="space-y-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-brand-red" />
                  <h2 className="font-display font-bold text-sm uppercase tracking-wider text-white">
                    Catálogo de Animes
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      fetchTrash();
                      setShowTrashModal(true);
                    }}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-all cursor-pointer relative"
                    title="Papelera de animes eliminados"
                  >
                    <Trash2 className="h-4 w-4" />
                    {trashNames.length > 0 && (
                      <span className="absolute -top-1 -right-1 px-1 min-w-[15px] h-[15px] rounded-full bg-red-600 text-[8.5px] font-mono font-bold text-white flex items-center justify-center shadow-xs leading-none">
                        {trashNames.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {!isAnimeFormOpen && (
                <div className="w-full">
                  <button
                    type="button"
                    onClick={openNewAnimeForm}
                    className="w-full py-2.5 sm:py-3 bg-brand-red hover:bg-brand-red-hover text-white rounded-xl font-display font-semibold text-xs sm:text-sm tracking-wider uppercase flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-md shadow-brand-red/20 active:scale-[0.99]"
                    title="Agregar un nuevo Hentai al catálogo"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Agregar Hentai</span>
                  </button>
                </div>
              )}
            </div>

            {/* Anime Creation/Editing Form */}
            {isAnimeFormOpen && (
              <form onSubmit={handleSaveAnime} className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-dark-border pb-4">
                  <h3 className="font-display font-bold text-sm tracking-widest text-brand-red uppercase">
                    {editingAnime ? 'EDITAR ANIME' : 'NUEVO ANIME'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsAnimeFormOpen(false)}
                    className="font-mono text-[9px] text-neutral-500 hover:text-white uppercase tracking-widest transition-colors duration-300"
                  >
                    Cancelar
                  </button>
                </div>

                {animeFormError && (
                  <div className="p-3 bg-brand-red/10 border border-brand-red/30 rounded text-xs text-brand-red font-mono">
                    {animeFormError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  {/* Left block: Portada & Upload */}
                  <div className="md:col-span-4 space-y-4">
                    <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                      Portada del Anime
                    </span>
                    <div 
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleImageDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`aspect-[2/3] w-full rounded border cursor-pointer group bg-black/40 flex flex-col items-center justify-center p-4 overflow-hidden relative transition-all duration-300 ${
                        isDragging ? 'border-brand-red bg-brand-red/5' : 'border-dark-border hover:border-brand-red/30'
                      }`}
                    >
                      {animeImage ? (
                        <>
                          <img src={animeImage} alt="Vista previa" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          {animeImage.startsWith('data:image/') && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-xs border border-purple-500/40 text-[8.5px] font-mono text-purple-300 z-10 font-bold tracking-tight flex items-center gap-1">
                              <span>~{Math.round(animeImage.length * 0.75 / 1024)} KB</span>
                              <span className="opacity-75">· {animeImage.includes('webp') ? 'WebP' : animeImage.includes('png') ? 'PNG' : 'JPG'}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-2">
                            <Upload className="h-6 w-6 text-white animate-bounce" />
                            <span className="font-mono text-[9px] text-white uppercase tracking-wider">Subir otra imagen</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation(); // Avoid triggering file input click
                              setAnimeImage('');
                              setIsImageOptimized(false);
                            }}
                            className="absolute bottom-2 right-2 p-1 px-2 bg-black/80 hover:bg-brand-red text-white text-[9px] font-mono rounded z-10"
                          >
                            Eliminar
                          </button>
                        </>
                      ) : (
                        <div className="text-center space-y-2 pointer-events-none">
                          <Upload className="h-8 w-8 text-neutral-700 mx-auto transition-transform duration-300 group-hover:-translate-y-1 group-hover:text-neutral-500" />
                          <p className="font-sans text-[11px] text-neutral-500 group-hover:text-neutral-400 transition-colors duration-300">
                            Arrastra una imagen aquí o haz clic para subir
                          </p>
                          <span className="font-mono text-[8px] text-neutral-600 block uppercase">PNG, JPG o WEBP</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleImageFileChange}
                        className="hidden"
                      />

                      <button
                        type="button"
                        disabled={imageUploadLoading}
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-2 bg-dark-border hover:bg-neutral-800 disabled:opacity-50 text-neutral-300 hover:text-white rounded font-mono text-[10px] uppercase tracking-wider transition-colors duration-300 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {imageUploadLoading ? 'Cargando imagen...' : 'Subir archivo de imagen'}
                      </button>
                    </div>
                  </div>

                  {/* Right block: Information fields */}
                  <div className="md:col-span-8 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Name */}
                      <div className="space-y-1">
                        <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                          Nombre del Anime *
                        </label>
                        <input
                          type="text"
                          required
                          value={animeName}
                          onChange={(e) => setAnimeName(e.target.value)}
                          placeholder="p.ej. Jujutsu Kaisen"
                          className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                        />
                      </div>

                      {/* Studio Autocomplete & Interactive Selector */}
                      <div className="space-y-1.5 relative">
                        <div className="flex justify-between items-center">
                          <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                            Estudio(s) *
                          </label>
                          <div className="flex items-center gap-2">
                            {animeStudioSearch && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAnimeStudioSearch('');
                                  setAnimeStudioId('');
                                  updateLastUsedStudio('');
                                }}
                                className="font-mono text-[8.5px] uppercase tracking-wider text-neutral-500 hover:text-red-400 transition-colors cursor-pointer"
                                title="Borrar estudio seleccionado"
                              >
                                Limpiar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowStudioPicker(!showStudioPicker)}
                              className="font-mono text-[8.5px] uppercase tracking-wider text-brand-red hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Building2 className="h-3 w-3" />
                              {showStudioPicker ? 'Ocultar Lista' : `Ver Estudios (${studios.length})`}
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          required
                          list="studios-datalist"
                          value={animeStudioSearch}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAnimeStudioSearch(val);
                            if (val.trim()) {
                              updateLastUsedStudio(val);
                            }
                          }}
                          placeholder="Escribe o selecciona abajo (ej. MAPPA, Bones)"
                          className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2.5 text-sm text-white placeholder-neutral-700 outline-none transition-colors duration-300"
                        />
                        <datalist id="studios-datalist">
                          {studios.map(s => (
                            <option key={s.id} value={s.name} />
                          ))}
                        </datalist>

                        {/* Interactive Studio Chips / Quick Picker */}
                        <div className="pt-1">
                          <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest block mb-1">
                            Estudios Disponibles:
                          </span>
                          {studios.length === 0 ? (
                            <p className="font-mono text-[8px] text-neutral-600 uppercase">Aún no hay estudios creados.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto bg-black/20 p-2 rounded border border-dark-border/40">
                              {studios.map(studio => {
                                const isSelected = animeStudioSearch
                                  .split(',')
                                  .map(s => getNormalizedKey(s.trim()))
                                  .includes(getNormalizedKey(studio.name));
                                return (
                                  <button
                                    type="button"
                                    key={studio.id}
                                    onClick={() => handleToggleStudioInput(studio.name)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-sans font-medium transition-all duration-300 flex items-center gap-1 cursor-pointer ${
                                      isSelected
                                        ? 'bg-brand-red text-white border border-transparent shadow-[0_2px_8px_rgba(255,51,51,0.2)] font-semibold'
                                        : 'bg-[#0f0f0f] text-neutral-400 hover:text-white border border-dark-border hover:border-neutral-700'
                                    }`}
                                  >
                                    {isSelected ? '✓' : '+'} {studio.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                    {/* Enlace de Telegram */}
                    <div className="space-y-1">
                      <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                        Enlace de Telegram *
                      </label>
                      <input
                        type="text"
                        required
                        value={animeTelegramUrl}
                        onChange={(e) => setAnimeTelegramUrl(e.target.value)}
                        placeholder="https://t.me/tu_canal_o_post"
                        className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                      />
                    </div>

                    {/* Sinopsis */}
                    <div className="space-y-1">
                      <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                        Sinopsis
                      </label>
                      <textarea
                        rows={4}
                        value={animeDescription}
                        onChange={(e) => setAnimeDescription(e.target.value)}
                        placeholder="Sinopsis detallada de la obra..."
                        className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                      />
                    </div>

                    {/* Year */}
                    <div className="space-y-1">
                      <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                        Año
                      </label>
                      <input
                        type="text"
                        value={animeYear}
                        onChange={(e) => setAnimeYear(e.target.value)}
                        onBlur={() => setAnimeYear(prev => normalizeAnimeYear(prev))}
                        placeholder="p.ej. 2026"
                        className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                      />
                    </div>

                    {/* Estado */}
                    <div className="space-y-1">
                      <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                        Estado
                      </label>
                      <select
                        value={animeStatus}
                        onChange={(e) => setAnimeStatus(e.target.value)}
                        className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white outline-none transition-colors duration-300"
                      >
                        <option value="Finalizado">Finalizado</option>
                        <option value="Emisión">Emisión</option>
                      </select>
                    </div>
                  </div>

                  {/* Genres Selection */}
                    <div className="space-y-2">
                      <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                        Géneros *
                      </label>
                      
                      <input
                        type="text"
                        required
                        value={animeGenresInput}
                        onChange={(e) => setAnimeGenresInput(e.target.value)}
                        placeholder="ej. Acción, Aventura, Fantasía"
                        className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2.5 text-sm text-white placeholder-neutral-700 outline-none transition-colors duration-300"
                      />

                      {/* Interactive suggestion pills */}
                      <div className="space-y-1.5 pt-1">
                        <span className="font-mono text-[8px] text-neutral-500 uppercase tracking-widest block">
                          Géneros Existentes:
                        </span>
                        {genres.length === 0 ? (
                          <p className="font-mono text-[8px] text-neutral-600 uppercase">Aún no hay géneros guardados. ¡Empieza a escribir arriba para crear los primeros!</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto bg-black/20 p-2 rounded border border-dark-border/40">
                            {genres.map(g => {
                              const gKey = getNormalizedKey(g.name);
                              const isSelected = animeGenresInput
                                .split(',')
                                .map(s => getNormalizedKey(s))
                                .includes(gKey);
                              
                              return (
                                <button
                                  type="button"
                                  key={g.id}
                                  onClick={() => handleToggleGenreInput(g.name)}
                                  className={`px-2.5 py-1 rounded text-[10px] font-sans font-medium transition-all duration-300 flex items-center gap-1 cursor-pointer ${
                                    isSelected 
                                      ? 'bg-brand-red text-white border border-transparent shadow-[0_2px_8px_rgba(255,51,51,0.2)]' 
                                      : 'bg-[#0f0f0f] text-neutral-400 hover:text-white border border-dark-border hover:border-neutral-700'
                                  }`}
                                >
                                  {isSelected ? '✓' : '+'} {g.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Apartado para agregar episodios (Al final, después de géneros) */}
                    {animeEpisodes.length === 0 ? (
                      <div className="pt-1 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleAddEpisode}
                          className="px-3.5 py-2 bg-brand-red hover:bg-brand-red-hover border border-brand-red/60 text-white rounded-lg font-mono text-xs font-semibold tracking-wider transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          ➕ Agregar Episodio
                        </button>

                        <div className="flex items-center gap-2 bg-[#0a0a0a] border border-dark-border/80 px-2.5 py-1.5 rounded-lg">
                          <span className="font-mono text-[10px] text-neutral-400 uppercase tracking-wider">
                            ¿Mostrar en Episodios?
                          </span>
                          <button
                            type="button"
                            onClick={() => setSingleEpIsNew(prev => !prev)}
                            className={`h-[26px] px-2.5 rounded-md flex items-center gap-1.5 font-mono text-[10px] font-bold transition-all cursor-pointer select-none border ${
                              singleEpIsNew
                                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-600/30'
                                : 'bg-transparent text-neutral-500 border-neutral-800 hover:text-neutral-300'
                            }`}
                            title={singleEpIsNew ? "Marcado para mostrarse en la sección Episodios" : "Oculto en la sección Episodios"}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${singleEpIsNew ? 'bg-white animate-pulse' : 'bg-neutral-600'}`} />
                            <span>{singleEpIsNew ? 'Mostrar' : 'Oculto'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5 p-2 sm:p-2.5 bg-[#080808] border border-dark-border/80 rounded-lg">
                        <div className="flex items-center justify-between pb-1">
                          <label className="font-mono text-[9.5px] text-neutral-300 uppercase tracking-widest font-bold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-red inline-block"></span>
                            Episodios Agregados ({animeEpisodes.length}/12)
                          </label>

                          <button
                            type="button"
                            onClick={handleAddEpisode}
                            disabled={animeEpisodes.length >= 12}
                            className="px-2.5 py-1 bg-brand-red hover:bg-brand-red-hover disabled:opacity-40 border border-brand-red/50 text-white rounded font-mono text-[10px] font-semibold uppercase tracking-wider transition-all duration-200 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed shadow-sm"
                          >
                            ➕ Agregar
                          </button>
                        </div>

                        {/* Cabecera general limpia para no repetir labels en cada fila y ganar espacio */}
                        <div className="flex items-center gap-1.5 sm:gap-2 px-1 text-[9px] font-mono text-neutral-400 uppercase tracking-wider select-none">
                          <span className="w-11 sm:w-13 text-center">Nº</span>
                          <span className="flex-1">Enlace de video (.mp4)</span>
                          <span className="w-8 text-center" title="Miniatura">Min</span>
                          <span className="w-16 sm:w-20 text-center">Episodios</span>
                          <span className="w-7"></span>
                        </div>

                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                          {animeEpisodes.map((ep, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 sm:gap-2 bg-[#020202] border border-dark-border/60 p-1.5 rounded-md transition-colors hover:border-dark-border">
                              {/* Nº de Episodio super compacto sin labels repetitivas */}
                              <div className="w-11 sm:w-13 shrink-0">
                                <input
                                  type="number"
                                  min="1"
                                  max="999"
                                  required
                                  value={ep.number}
                                  onChange={(e) => handleUpdateEpisodeNumber(idx, e.target.value)}
                                  className="w-full h-8 bg-[#0a0a0a] border border-dark-border focus:border-emerald-500 rounded px-1 text-center text-xs text-white font-mono font-bold outline-none"
                                  title="Número de episodio"
                                  placeholder="1"
                                />
                              </div>

                              {/* Input de enlace (.mp4): TODO EL ANCHO RESTANTE (flex-1) */}
                              <div className="flex-1 min-w-0">
                                <input
                                  ref={(el) => { episodeInputRefs.current[idx] = el; }}
                                  type="url"
                                  required
                                  value={ep.telegramUrl}
                                  onChange={(e) => handleEpisodeUrlChange(idx, e.target.value)}
                                  onPaste={(e) => {
                                    const pasted = e.clipboardData.getData('text');
                                    if (pasted) {
                                      handleEpisodeUrlChange(idx, pasted);
                                    }
                                  }}
                                  placeholder="https://archive.org/.../video.mp4"
                                  className="w-full h-8 bg-[#0a0a0a] border border-dark-border focus:border-emerald-500 rounded px-2 text-xs text-white placeholder-neutral-700 outline-none truncate font-mono"
                                />
                              </div>

                              {/* Botón Portada al lado del enlace: '+' si no hay, '✓' si está lista */}
                              <label
                                className={`h-8 px-2 shrink-0 flex items-center justify-center gap-1 rounded cursor-pointer transition-all border group select-none text-[10px] font-mono ${
                                  ep.coverImage
                                    ? 'bg-purple-950/50 border-purple-500/70 text-purple-300 hover:bg-purple-900/50 shadow-sm'
                                    : 'bg-[#0a0a0a] border-dark-border hover:border-purple-500/60 text-neutral-400 hover:text-white'
                                }`}
                                title={ep.coverImage ? 'Portada lista (clic para cambiar, clic derecho para quitar)' : 'Agregar portada (sección inicio)'}
                                onContextMenu={(e) => {
                                  if (ep.coverImage) {
                                    e.preventDefault();
                                    setAnimeEpisodes(prev => {
                                      const updated = [...prev];
                                      updated[idx] = { ...updated[idx], coverImage: undefined };
                                      return updated;
                                    });
                                    showNotification(`Portada removida del Episodio ${ep.number}`, 'success');
                                  }
                                }}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleEpisodeCoverUpload(idx, file);
                                      e.target.value = '';
                                    }
                                  }}
                                />
                                {ep.coverImage ? (
                                  <Check className="h-3.5 w-3.5 text-purple-400 stroke-[2.5]" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5 text-neutral-400 group-hover:text-purple-300 transition-colors" />
                                )}
                                <span className="hidden sm:inline">Portada</span>
                              </label>

                              {/* Botón Miniatura al lado del enlace: '+' si no hay, '✓' si está lista */}
                              <label
                                className={`h-8 px-2 shrink-0 flex items-center justify-center gap-1 rounded cursor-pointer transition-all border group select-none text-[10px] font-mono ${
                                  ep.thumbnail
                                    ? 'bg-emerald-950/50 border-emerald-500/70 text-emerald-300 hover:bg-emerald-900/50 shadow-sm'
                                    : 'bg-[#0a0a0a] border-dark-border hover:border-emerald-500/60 text-neutral-400 hover:text-white'
                                }`}
                                title={ep.thumbnail ? 'Miniatura lista (clic para cambiar, clic derecho para quitar)' : 'Agregar miniatura (reproductor e interna)'}
                                onContextMenu={(e) => {
                                  if (ep.thumbnail) {
                                    e.preventDefault();
                                    setAnimeEpisodes(prev => {
                                      const updated = [...prev];
                                      updated[idx] = { ...updated[idx], thumbnail: undefined };
                                      return updated;
                                    });
                                    showNotification(`Miniatura removida del Episodio ${ep.number}`, 'success');
                                  }
                                }}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleEpisodeThumbnailUpload(idx, file);
                                      e.target.value = '';
                                    }
                                  }}
                                />
                                {ep.thumbnail ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[2.5]" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5 text-neutral-400 group-hover:text-emerald-300 transition-colors" />
                                )}
                                <span className="hidden sm:inline">Miniatura</span>
                              </label>

                              {/* Interruptor pequeño: Verde cuando se muestra, sin color/neutral cuando no */}
                              <button
                                type="button"
                                onClick={() => handleToggleEpisodeNew(idx)}
                                className={`h-8 px-2 sm:px-2.5 rounded shrink-0 flex items-center justify-center gap-1 font-mono text-[10px] font-bold transition-all cursor-pointer select-none border ${
                                  ep.isNew
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-600/30'
                                    : 'bg-transparent text-neutral-500 border-neutral-800 hover:text-neutral-300 hover:border-neutral-700'
                                }`}
                                title={ep.isNew ? "Mostrándose en la sección Episodios (Clic para ocultar)" : "Oculto en la sección Episodios (Clic para mostrar)"}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${ep.isNew ? 'bg-white animate-pulse' : 'bg-neutral-600'}`} />
                                <span className="hidden sm:inline">{ep.isNew ? 'Mostrar' : 'Oculto'}</span>
                                <span className="sm:hidden">{ep.isNew ? 'ON' : 'OFF'}</span>
                              </button>

                              {/* Botón eliminar episodio: DE ÚLTIMO */}
                              <button
                                type="button"
                                onClick={() => handleRemoveEpisode(idx)}
                                className="h-8 w-7 shrink-0 flex items-center justify-center text-neutral-500 hover:text-brand-red hover:bg-brand-red/10 rounded transition-colors cursor-pointer"
                                title="Eliminar este episodio"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hide toggle */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="chk_hidden"
                        checked={animeHidden}
                        onChange={(e) => setAnimeHidden(e.target.checked)}
                        className="rounded border-dark-border bg-black text-brand-red focus:ring-brand-red"
                      />
                      <label htmlFor="chk_hidden" className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest cursor-pointer select-none">
                        Ocultar temporalmente (borrador)
                      </label>
                    </div>

                    {/* Submit and Cancel buttons */}
                    <div className="pt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dark-border/40">
                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={imageUploadLoading}
                          className="px-6 py-2 bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-display font-medium text-xs tracking-widest uppercase transition-all duration-300 flex items-center gap-1.5"
                        >
                          <Save className="h-4 w-4" />
                          {imageUploadLoading ? 'Guardando...' : (editingAnime ? 'Actualizar Anime' : 'Guardar Anime')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAnimeFormOpen(false)}
                          className="px-6 py-2 bg-[#111] hover:bg-neutral-800 text-neutral-400 hover:text-white rounded font-mono text-xs uppercase tracking-wider transition-colors duration-300"
                        >
                          Cancelar
                        </button>
                      </div>

                      {editingAnime && (
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteAnime(editingAnime.id);
                            setIsAnimeFormOpen(false);
                          }}
                          className="px-4 py-2 border border-brand-red/30 hover:border-brand-red bg-brand-red/5 hover:bg-brand-red/10 text-brand-red hover:text-white rounded font-mono text-xs uppercase tracking-wider transition-all duration-300 flex items-center gap-1.5"
                          title="Eliminar este anime permanentemente"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar Anime
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Search Bar for Admin Animes List - Clean rounded input without outer bubble */}
            {animes.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1 py-0.5">
                <div className="relative flex-1 max-w-lg">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
                  <input
                    type="text"
                    value={animeAdminSearch}
                    onChange={(e) => setAnimeAdminSearch(e.target.value)}
                    placeholder="Buscar portada por nombre, estudio, género, año..."
                    className="w-full bg-[#08080a] border border-dark-border/80 focus:border-brand-red/60 rounded-full py-2.5 sm:py-3 pl-11 pr-10 text-xs sm:text-sm text-white placeholder-neutral-500 outline-none transition-all duration-300 shadow-inner"
                  />
                  {animeAdminSearch && (
                    <button
                      onClick={() => setAnimeAdminSearch('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs font-mono cursor-pointer"
                      title="Limpiar búsqueda"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="font-mono text-[11px] text-neutral-400 uppercase tracking-widest text-right pr-2">
                  <span className="text-white font-bold">
                    {adminFilteredAnimes.length}
                  </span>{' '}
                  de {animes.length}
                </div>
              </div>
            )}

            {/* Anime List Grid Table */}
            <div id="admin-animes-table-container" className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
              {animes.length === 0 ? (
                <div className="p-8 text-center text-neutral-500 font-mono text-xs">
                  No hay animes registrados en el archivo. ¡Crea el primero!
                </div>
              ) : (() => {
                // Latest added anime ID (last element in the original list)
                const latestAnimeId = animes.length > 0 ? animes[animes.length - 1].id : null;
                const filteredAnimes = adminFilteredAnimes;

                if (filteredAnimes.length === 0) {
                  return (
                    <div className="p-8 text-center space-y-2">
                      <p className="text-neutral-400 font-mono text-xs">
                        No se encontraron portadas que coincidan con "<span className="text-white">{animeAdminSearch}</span>"
                      </p>
                      <button
                        onClick={() => setAnimeAdminSearch('')}
                        className="text-brand-red hover:underline font-mono text-[10px] uppercase tracking-wider"
                      >
                        Limpiar búsqueda
                      </button>
                    </div>
                  );
                }

                return (
                  <>
                    {/* Anime List - Exact layout and colors matching Screenshot 1 */}
                    <div className="divide-y divide-[#1b0d30] border border-[#1b0d30] rounded-xl overflow-hidden bg-[#0a0414]">
                      {paginatedAdminAnimes.map(({ anime }) => {
                        const sIds = (anime.studioIds && anime.studioIds.length > 0)
                          ? anime.studioIds
                          : (anime.studioId ? [anime.studioId] : []);
                        const sNames = sIds.map(id => studioMapForAdmin.get(id)).filter(Boolean);
                        const sName = sNames.length > 0 ? sNames.join(', ') : 'Sin estudio';
                        const isEmision = anime.status === 'Próximamente' || anime.status?.toLowerCase().includes('emisión') || anime.status?.toLowerCase().includes('emision');

                        // Check if there was an issue saving to Firebase
                        const hasFirebaseError = 
                          anime.savedInFirestore === false ||
                          Boolean(anime.firestoreError) ||
                          (Boolean(anime.storageLocation) && !anime.storageLocation!.toLowerCase().includes('firebase'));
                        const savedLocationName = anime.storageLocation || 'Almacenamiento Local (/database.json)';

                        return (
                          <div 
                            key={anime.id} 
                            className="p-2.5 sm:p-3 hover:bg-[#120722] transition-colors flex items-center justify-between gap-2.5 sm:gap-3 bg-[#0a0414]"
                          >
                            {/* 1. Left Thumbnail: Touching photo opens edit mode */}
                            <button
                              type="button"
                              onClick={() => openEditAnimeForm(anime)}
                              className="relative shrink-0 w-11 h-15 sm:w-12 sm:h-16 rounded-md overflow-hidden border border-[#2b174d] hover:border-purple-500 shadow-md group cursor-pointer active:scale-95 transition-all text-left"
                              title="Tocar foto para editar anime"
                            >
                              <SmartAnimeCover anime={anime} studioName={sName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-purple-900/40 flex items-center justify-center transition-colors">
                                <Edit2 className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                              </div>
                            </button>

                            {/* 2. Center: Anime Info or Fallback Storage Warning if Firebase failed */}
                            {hasFirebaseError ? (
                              <div className="flex-1 min-w-0 pr-1 flex flex-col justify-center">
                                <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-xs">
                                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                                  <div className="min-w-0">
                                    <span className="font-bold block text-[11px] uppercase tracking-wider text-amber-300">
                                      No guardado en Firebase
                                    </span>
                                    <span className="text-[10px] text-amber-200/90 truncate block">
                                      Guardado en: {savedLocationName}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1 min-w-0 pr-1">
                                {/* Title */}
                                <h4 className="font-semibold text-white text-xs sm:text-sm truncate leading-tight">
                                  {anime.name}
                                </h4>

                                {/* Year */}
                                {anime.year && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] sm:text-xs text-neutral-400 font-mono">
                                      ({anime.year})
                                    </span>
                                  </div>
                                )}

                                {/* Studio Name in Violet */}
                                <div className="font-mono text-xs font-bold text-[#c084fc] uppercase tracking-wider mt-0.5 truncate">
                                  {sName}
                                </div>

                                {/* Telegram URL */}
                                {anime.telegramUrl && (
                                  <div className="text-[10px] sm:text-[11px] font-mono text-purple-300/40 truncate mt-0.5">
                                    {anime.telegramUrl}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 3. Right: Action Buttons in single horizontal row */}
                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                              {/* Info Button (i) */}
                              <button
                                type="button"
                                onClick={() => setSelectedAnimeDetails(anime)}
                                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#180d2c] hover:bg-[#251342] border border-[#2e1550] text-purple-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                                title="Ver información"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>

                              {/* + EP Button */}
                              <button
                                type="button"
                                onClick={() => handleOpenQuickAddEpModal(anime.id)}
                                className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg bg-[#4c1d95] hover:bg-[#581c87] border border-purple-500/50 text-white font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors active:scale-95 shadow-sm"
                                title="Agregar episodio"
                              >
                                <span>+ EP</span>
                              </button>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => handleDeleteAnime(anime.id)}
                                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#180d2c] hover:bg-red-950/60 border border-[#2e1550] hover:border-red-500/50 text-purple-300 hover:text-red-400 flex items-center justify-center cursor-pointer transition-colors active:scale-95"
                                title="Eliminar anime"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                  {totalAdminAnimePages > 1 && (() => {
                    const getSmartAdminPages = (current: number, total: number) => {
                      if (total <= 5) {
                        return Array.from({ length: total }, (_, i) => i + 1);
                      }
                      const pages = new Set<number>();
                      let minNearby = current - 2;
                      let maxNearby = current + 2;
                      if (current <= 2) {
                        minNearby = 1;
                        maxNearby = Math.min(total, 4);
                      } else if (current >= total - 1) {
                        minNearby = Math.max(1, total - 3);
                        maxNearby = total;
                      }
                      for (let i = Math.max(1, minNearby); i <= Math.min(total, maxNearby); i++) {
                        pages.add(i);
                      }
                      const lowestNearby = Math.min(...Array.from(pages));
                      const highestNearby = Math.max(...Array.from(pages));
                      if (lowestNearby > 1) {
                        let jumpBack = current - 6;
                        if (jumpBack < 1 || lowestNearby - jumpBack <= 2) {
                          jumpBack = 1;
                        }
                        pages.add(jumpBack);
                      }
                      if (highestNearby < total) {
                        let jumpForward = current + 6;
                        if (jumpForward > total || jumpForward - highestNearby <= 2) {
                          jumpForward = total;
                        }
                        pages.add(jumpForward);
                      }
                      return Array.from(pages).sort((a, b) => a - b);
                    };

                    const handleAdminPageChange = (newPage: number) => {
                      if (newPage < 1 || newPage > totalAdminAnimePages || newPage === adminAnimePage) return;
                      setAdminAnimePage(newPage);
                      const container = document.getElementById('admin-animes-table-container');
                      if (container) {
                        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    };

                    const pageNumbers = getSmartAdminPages(adminAnimePage, totalAdminAnimePages);

                    return (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-dark-border/80 bg-black/40 font-mono text-xs text-neutral-400">
                        <div className="text-[11px] text-neutral-400">
                          Mostrando <span className="text-white font-semibold">{(adminAnimePage - 1) * adminItemsPerPage + 1}</span> - <span className="text-white font-semibold">{Math.min(adminAnimePage * adminItemsPerPage, adminFilteredAnimes.length)}</span> de <span className="text-white font-semibold">{adminFilteredAnimes.length}</span>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none py-1 max-w-full justify-center">
                          {/* Previous Page */}
                          <button
                            type="button"
                            onClick={() => handleAdminPageChange(adminAnimePage - 1)}
                            disabled={adminAnimePage === 1}
                            aria-label="Página anterior"
                            className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>

                          {/* Page Numbers */}
                          {pageNumbers.map((pNum) => {
                            const isActive = pNum === adminAnimePage;
                            return (
                              <button
                                key={pNum}
                                type="button"
                                onClick={() => handleAdminPageChange(pNum)}
                                className={`px-2.5 sm:px-3 py-1 shrink-0 font-mono text-xs sm:text-sm tracking-wider transition-all duration-150 cursor-pointer select-none rounded ${
                                  isActive
                                    ? 'text-[#ff5588] font-extrabold scale-110'
                                    : 'text-white font-bold hover:text-[#ff5588] active:scale-95'
                                }`}
                              >
                                {pNum}
                              </button>
                            );
                          })}

                          {/* Next Page */}
                          <button
                            type="button"
                            onClick={() => handleAdminPageChange(adminAnimePage + 1)}
                            disabled={adminAnimePage >= totalAdminAnimePages}
                            aria-label="Página siguiente"
                            className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              );
              })()}
            </div>
          </div>
        )}

        {/* --- EPISODES TAB (Gestión avanzada de episodios y portadas) --- */}
        {activeTab === 'episodes' && (
          <AdminEpisodeManager
            animes={animes}
            studios={studios}
            onRefresh={onRefresh}
            showNotification={showNotification}
          />
        )}

        {/* --- STUDIOS TAB --- */}
        {activeTab === 'studios' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left Studio Creator Form */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 h-fit space-y-4">
              <h2 className="font-display font-semibold text-base tracking-widest text-brand-red uppercase">
                {editingStudio ? 'EDITAR ESTUDIO' : 'CREAR ESTUDIO'}
              </h2>
              
              <form onSubmit={handleSaveStudio} className="space-y-4">
                {studioError && (
                  <div className="p-2 bg-brand-red/10 border border-brand-red/30 rounded text-xs text-brand-red font-mono">
                    {studioError}
                  </div>
                )}

                {/* Portada del Estudio */}
                <div className="space-y-1">
                  <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                    Portada / Logo del Estudio
                  </label>
                  <div
                    onClick={() => studioFileInputRef.current?.click()}
                    className="aspect-video w-full rounded border border-dark-border hover:border-brand-red/40 bg-black/40 cursor-pointer group flex flex-col items-center justify-center p-2 overflow-hidden relative transition-all"
                  >
                    {studioImage ? (
                      <>
                        <img src={studioImage} alt="Portada del Estudio" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                          <Upload className="h-5 w-5 text-white" />
                          <span className="font-mono text-[9px] text-white uppercase">Cambiar portada</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStudioImage('');
                          }}
                          className="absolute bottom-1.5 right-1.5 px-2 py-0.5 bg-black/80 hover:bg-brand-red text-white text-[9px] font-mono rounded z-10"
                        >
                          Eliminar
                        </button>
                      </>
                    ) : (
                      <div className="text-center space-y-1">
                        <Upload className="h-6 w-6 text-neutral-600 mx-auto group-hover:text-neutral-400 transition-colors" />
                        <p className="font-sans text-[10px] text-neutral-400">Toca para subir portada del estudio</p>
                        <span className="font-mono text-[8px] text-neutral-600 block uppercase">PNG, JPG o WEBP</span>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    ref={studioFileInputRef}
                    onChange={handleStudioFileChange}
                    className="hidden"
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                    Nombre del Estudio *
                  </label>
                  <input
                    type="text"
                    required
                    value={studioName}
                    onChange={(e) => setStudioName(e.target.value)}
                    placeholder="p.ej. MAPPA, Bones, T-Rex"
                    className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-grow py-2 bg-brand-red hover:bg-brand-red-hover text-white rounded font-display font-medium text-xs tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {editingStudio ? 'Actualizar' : 'Crear'}
                  </button>
                  {editingStudio && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStudio(null);
                        setStudioName('');
                        setStudioImage('');
                      }}
                      className="px-3 py-2 bg-neutral-800 text-neutral-400 hover:text-white rounded text-xs transition-colors duration-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Right Studios Table List */}
            <div className="md:col-span-2 bg-dark-card border border-dark-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="font-display font-semibold text-base tracking-wide">Estudios Existentes ({studios.length})</h2>
                <button
                  onClick={handleDeduplicate}
                  disabled={isDeduplicating}
                  className="px-3 py-1.5 bg-brand-red/10 border border-brand-red/30 hover:border-brand-red text-brand-red hover:text-white rounded text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Unifica automáticamente estudios repetidos o con variaciones de nombre"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isDeduplicating ? 'Unificando...' : 'Unificar Duplicados'}
                </button>
              </div>
              
              {studios.length === 0 ? (
                <p className="font-mono text-xs text-neutral-500">No hay estudios creados.</p>
              ) : (
                <div className="space-y-2">
                  {studios.map(studio => {
                    const count = studioAnimeCounts.get(studio.id) || 0;
                    const studioCover = studio.image || animes.find(a => (a.studioIds?.includes(studio.id) || a.studioId === studio.id))?.coverData || animes.find(a => (a.studioIds?.includes(studio.id) || a.studioId === studio.id))?.image;

                    return (
                      <div
                        key={studio.id}
                        className="flex items-center justify-between p-3 bg-black/40 border border-dark-border/60 hover:border-dark-border rounded-lg transition-all duration-300 gap-3"
                      >
                        {/* Foto de la portada a la izquierda y la información a la derecha */}
                        <div className="flex items-center gap-3.5 min-w-0">
                          {/* Portada a la izquierda */}
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-black/60 border border-purple-500/30 overflow-hidden shrink-0 flex items-center justify-center relative shadow-sm">
                            {studioCover ? (
                              <img
                                src={studioCover}
                                alt={studio.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center bg-purple-950/30">
                                <Building2 className="h-5 w-5 text-purple-400" />
                                <span className="text-[7.5px] font-mono text-purple-300 font-bold truncate max-w-full">{studio.name.slice(0, 4)}</span>
                              </div>
                            )}
                          </div>

                          {/* Información a la derecha */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display text-sm font-semibold text-white truncate">{studio.name}</span>
                              <span className="px-2 py-0.5 bg-brand-red/10 border border-brand-red/20 text-brand-red text-[10px] font-mono rounded-full shrink-0">
                                {count} {count === 1 ? 'portada' : 'portadas'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="font-mono text-[9px] text-neutral-500">ID: {studio.id}</span>
                              <span className="text-neutral-700 text-[9px]">•</span>
                              <span className="font-mono text-[9px] text-emerald-400 flex items-center gap-1">
                                <Globe className="h-2.5 w-2.5" />
                                {studio.storageLocation || 'Firebase Firestore (khentai)'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => {
                              setEditingStudio(studio);
                              setStudioName(studio.name);
                              setStudioImage(studio.image || '');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded transition-colors duration-200 cursor-pointer"
                            title="Editar Estudio"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteStudio(studio.id)}
                            className="p-1.5 rounded border border-brand-red/20 hover:border-brand-red/60 bg-brand-red/5 text-brand-red hover:bg-brand-red hover:text-white transition-all duration-200 cursor-pointer"
                            title="Eliminar Estudio"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}


        {/* --- GENRES TAB --- */}
        {activeTab === 'genres' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left Genre Creator Form */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 h-fit space-y-4">
              <h2 className="font-display font-semibold text-base tracking-widest text-brand-red uppercase">
                {editingGenre ? 'EDITAR GÉNERO' : 'CREAR GÉNERO'}
              </h2>
              
              <form onSubmit={handleSaveGenre} className="space-y-4">
                {genreError && (
                  <div className="p-2 bg-brand-red/10 border border-brand-red/30 rounded text-xs text-brand-red font-mono">
                    {genreError}
                  </div>
                )}
                
                <div className="space-y-1">
                  <label className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest block">
                    Nombre del Género *
                  </label>
                  <input
                    type="text"
                    required
                    value={genreName}
                    onChange={(e) => setGenreName(e.target.value)}
                    placeholder="p.ej. Acción, Seinen"
                    className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-2 text-sm text-white placeholder-neutral-800 outline-none transition-colors duration-300"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-grow py-2 bg-brand-red hover:bg-brand-red-hover text-white rounded font-display font-medium text-xs tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {editingGenre ? 'Actualizar' : 'Crear'}
                  </button>
                  {editingGenre && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGenre(null);
                        setGenreName('');
                      }}
                      className="px-3 py-2 bg-neutral-800 text-neutral-400 hover:text-white rounded text-xs transition-colors duration-300"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Right Genres Table List */}
            <div className="md:col-span-2 bg-dark-card border border-dark-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="font-display font-semibold text-base tracking-wide">Géneros Existentes ({genres.length})</h2>
                <button
                  onClick={handleDeduplicate}
                  disabled={isDeduplicating}
                  className="px-3 py-1.5 bg-brand-red/10 border border-brand-red/30 hover:border-brand-red text-brand-red hover:text-white rounded text-xs font-mono transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Unifica automáticamente géneros repetidos o plurales (ej: Escolar y Escolares)"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isDeduplicating ? 'Unificando...' : 'Unificar Duplicados'}
                </button>
              </div>
              
              {genres.length === 0 ? (
                <p className="font-mono text-xs text-neutral-500">No hay géneros creados.</p>
              ) : (
                <div className="space-y-2">
                  {genres.map(genre => {
                    const count = genreAnimeCounts.get(genre.id) || 0;
                    return (
                      <div
                        key={genre.id}
                        className="flex items-center justify-between p-3 bg-black/40 border border-dark-border/60 hover:border-dark-border rounded transition-all duration-300"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-semibold text-white">{genre.name}</span>
                            <span className="px-2 py-0.5 bg-[#ff5588]/10 border border-[#ff5588]/20 text-[#ff5588] text-[10px] font-mono rounded-full">
                              {count} {count === 1 ? 'portada' : 'portadas'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[9px] text-neutral-500">ID: {genre.id}</span>
                            <span className="text-neutral-700 text-[9px]">•</span>
                            <span className="font-mono text-[9px] text-emerald-400 flex items-center gap-1">
                              <Globe className="h-2.5 w-2.5" />
                              {genre.storageLocation || 'Firebase Firestore (khentai)'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                setEditingGenre(genre);
                                setGenreName(genre.name);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="p-1 text-neutral-400 hover:text-white transition-colors duration-200"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteGenre(genre.id)}
                              className="p-1.5 rounded border border-brand-red/20 hover:border-brand-red/60 bg-brand-red/5 text-brand-red hover:bg-brand-red hover:text-white transition-all duration-200"
                              title="Eliminar Género"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}


        {/* --- BACKUP / DATABASE IMPORT-EXPORT & RESET METRICS --- */}
        {activeTab === 'backup' && (
          <div className="space-y-6 max-w-2xl">
            {/* 1. REINICIO DE MÉTRICAS Y COMUNIDAD (PRIMERO) */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-display font-bold text-base tracking-widest text-[#ff5588] uppercase flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  REINICIO DE MÉTRICAS Y COMUNIDAD
                </h2>
                <span className="px-2.5 py-1 bg-[#ff5588]/10 border border-[#ff5588]/30 text-[#ff5588] text-[10px] font-mono rounded tracking-wider uppercase font-semibold">
                  Confirmación Obligatoria
                </span>
              </div>
              <p className="font-sans text-neutral-400 text-sm leading-relaxed">
                Herramientas de mantenimiento para reiniciar estadísticas o moderar contenido. Al hacer clic en cualquier opción se mostrará una ventana de advertencia donde deberás confirmar para proceder:
              </p>

              <div className="space-y-4 pt-1">
                {/* 1. Reiniciar más populares */}
                <div className="p-4 bg-black/40 border border-dark-border/80 hover:border-[#ff5588]/40 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-200">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-[#ff5588]" />
                      <h4 className="font-display font-bold text-xs text-white uppercase tracking-wider">
                        Reiniciar más populares
                      </h4>
                    </div>
                    <p className="font-sans text-neutral-400 text-xs leading-relaxed">
                      Reinicia a cero el contador de vistas y popularidad de los animes en la sección "Más Populares". Las calificaciones y comentarios permanecerán intactos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPopularityOnly}
                    className="px-4 py-2.5 bg-[#ff5588]/10 border border-[#ff5588]/40 hover:bg-[#ff5588] hover:text-white text-[#ff5588] rounded font-display font-semibold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer shrink-0 w-full sm:w-auto"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    Reiniciar Más Populares
                  </button>
                </div>

                {/* 2. Reiniciar calificaciones */}
                <div className="p-4 bg-black/40 border border-dark-border/80 hover:border-amber-500/40 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-200">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-400" />
                      <h4 className="font-display font-bold text-xs text-white uppercase tracking-wider">
                        Reiniciar calificaciones
                      </h4>
                    </div>
                    <p className="font-sans text-neutral-400 text-xs leading-relaxed">
                      Reinicia a cero todas las calificaciones de estrellas y promedios en todos los animes. Las vistas, portadas y episodios quedan intactos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetRatingsOnly}
                    className="px-4 py-2.5 bg-amber-500/10 border border-amber-500/40 hover:bg-amber-500 hover:text-black text-amber-400 rounded font-display font-semibold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer shrink-0 w-full sm:w-auto"
                  >
                    <Star className="h-3.5 w-3.5" />
                    Reiniciar Calificaciones
                  </button>
                </div>

                {/* 3. Reiniciar comentarios */}
                <div className="p-4 bg-black/40 border border-dark-border/80 hover:border-red-500/40 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-200">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-red-400" />
                      <h4 className="font-display font-bold text-xs text-white uppercase tracking-wider">
                        Reiniciar comentarios
                      </h4>
                    </div>
                    <p className="font-sans text-neutral-400 text-xs leading-relaxed">
                      Elimina de forma permanente todos los comentarios y opiniones de la comunidad en la plataforma.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetCommentsOnly}
                    className="px-4 py-2.5 bg-red-500/10 border border-red-500/40 hover:bg-red-500 hover:text-white text-red-400 rounded font-display font-semibold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer shrink-0 w-full sm:w-auto"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Reiniciar Comentarios
                  </button>
                </div>
              </div>
            </div>

            {/* 2. RESPALDO TOTAL DEL ARCHIVO */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-display font-bold text-base tracking-widest text-brand-red uppercase flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  RESPALDO TOTAL DEL ARCHIVO
                </h2>
                <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono rounded tracking-wider">
                  100% COMPLETO Y AUTOCONTENIDO
                </span>
              </div>

              <p className="font-sans text-neutral-300 text-sm leading-relaxed">
                Descarga una copia de seguridad íntegra de toda la plataforma en un único archivo <span className="text-white font-mono font-bold">.JSON</span>. Se incluye absolutamente toda la información para que nunca pierdas ningún dato:
              </p>

              {/* Data Inclusions Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 py-2">
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Portadas completas:</strong> Base64 WebP de alta calidad</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Capítulos y Servidores:</strong> Todos los enlaces MP4 / Video</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Enlaces de Telegram:</strong> Canales y publicaciones</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Detalles y Sinopsis:</strong> Título, año, estado, sinopsis</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Estudios y Géneros:</strong> Nombres, IDs y vinculaciones</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-black/40 border border-dark-border rounded text-xs text-neutral-300">
                  <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Métricas y Listas:</strong> Vistas, descargas y favoritos</span>
                </div>
              </div>

              {backupStatus && (
                <div className="p-3 bg-white/5 border border-dark-border text-brand-red text-xs font-mono rounded">
                  {backupStatus}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleExportBackup}
                  disabled={isExporting}
                  className="px-6 py-3 bg-brand-red hover:bg-brand-red-hover disabled:opacity-60 text-white rounded font-display font-medium text-xs tracking-widest uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer shadow-lg shadow-brand-red/20"
                >
                  {isExporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Generando Respaldo Completo...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Descargar Respaldo Completo (.JSON)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 3. RESTAURAR RESPALDO */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-4">
              <h2 className="font-display font-bold text-base tracking-widest text-white uppercase flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                RESTAURAR RESPALDO
              </h2>
              <p className="font-sans text-neutral-400 text-sm">
                Selecciona tu archivo JSON de copia de seguridad o pega el código JSON de un respaldo exportado previamente para restaurar la base de datos completa con todas las portadas y capítulos.
              </p>

              {/* Directly upload file option */}
              <div className="p-4 bg-black/50 border border-dashed border-dark-border hover:border-brand-red/60 rounded-lg transition-all duration-300 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-brand-red/10 rounded-lg text-brand-red">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-display font-semibold text-xs text-white uppercase tracking-wider">Subir Archivo (.json)</h4>
                    <p className="font-mono text-[10px] text-neutral-400">Selecciona el archivo descargado desde tu celular o PC</p>
                  </div>
                </div>
                <label className="px-4 py-2.5 bg-brand-red hover:bg-brand-red-hover text-white rounded font-display font-semibold text-xs tracking-wider uppercase cursor-pointer transition-all duration-300 flex items-center gap-2 shrink-0">
                  <Upload className="h-3.5 w-3.5" />
                  Seleccionar Archivo
                  <input
                    type="file"
                    accept="*/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="relative flex items-center justify-center my-3">
                <div className="border-t border-dark-border w-full" />
                <span className="bg-dark-card px-3 font-mono text-[10px] text-neutral-500 uppercase tracking-widest absolute">o pega el código JSON</span>
              </div>

              <textarea
                rows={6}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='{ "studios": [...], "genres": [...], "animes": [...] }'
                className="w-full bg-[#050505] border border-dark-border focus:border-brand-red/50 rounded p-3 text-xs font-mono text-neutral-300 placeholder-neutral-800 outline-none transition-all duration-300"
              />

              {backupProgress && (
                <div className="space-y-2.5 p-4 bg-black/60 border border-brand-red/40 rounded-lg">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-display font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
                      Importación por Lotes en Progreso
                    </span>
                    <span className="font-mono text-brand-red font-bold text-sm">{backupProgress.percent}%</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-brand-red h-2.5 rounded-full transition-all duration-300 shadow-sm shadow-brand-red"
                      style={{ width: `${backupProgress.percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                    <span>{backupProgress.current} de {backupProgress.total} animes procesados</span>
                    <span className="text-emerald-400 font-semibold">Protección Anti-413 Activa</span>
                  </div>
                </div>
              )}

              {backupStatus && (
                <div className="p-3 bg-black/60 border border-dark-border text-neutral-200 text-xs font-mono rounded flex items-start gap-2">
                  <span className="text-brand-red font-bold shrink-0">›</span>
                  <span className="break-all">{backupStatus}</span>
                </div>
              )}

              <button
                onClick={handleImportBackup}
                disabled={(!importJson.trim() && !parsedBackupData) || isImporting}
                className="w-full sm:w-auto px-6 py-3 bg-white hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-white text-black font-display font-semibold text-xs tracking-widest uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer"
              >
                {isImporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Restaurando Base de Datos...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Aplicar e Importar Respaldo</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* --- FIREBASE STATS & QUOTAS TAB --- */}
        {activeTab === 'firebase-stats' && (
          <div className="space-y-6 max-w-4xl">
            {/* Header with Project Status & Refresh Button */}
            <div className="bg-dark-card border border-dark-border rounded-lg p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display font-bold text-base tracking-widest text-white uppercase">
                        ESPACIO
                      </h2>
                    </div>
                    <p className="font-sans text-neutral-400 text-xs mt-0.5">
                      Monitoreo en tiempo real del almacenamiento disponible y desglose de datos registrados en Firestore.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={fetchFirebaseQuotaStats}
                disabled={quotaStats.loading}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-dark-border text-white text-xs font-mono rounded flex items-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-amber-400 ${quotaStats.loading ? 'animate-spin' : ''}`} />
                <span>{quotaStats.loading ? 'Actualizando...' : 'Actualizar Estado'}</span>
              </button>
            </div>

            {quotaStats.loading && !quotaStats.data && (
              <div className="bg-dark-card border border-dark-border rounded-lg p-12 text-center space-y-3">
                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin mx-auto" />
                <p className="font-mono text-xs text-neutral-400">Analizando espacio en Firestore y límites de cuota...</p>
              </div>
            )}

            {quotaStats.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-xs font-mono flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>{quotaStats.error}</span>
                </div>
                <button
                  onClick={fetchFirebaseQuotaStats}
                  className="underline hover:text-white"
                >
                  Reintentar
                </button>
              </div>
            )}

            {quotaStats.data && (
              <>
                {/* 1. Storage Bar & Space Remaining Overview */}
                <div className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-amber-400" />
                      <h3 className="font-display font-semibold text-sm tracking-wider uppercase text-white">
                        Espacio de Almacenamiento (Base de Datos Firestore)
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-neutral-400">
                      Límite Gratuito: <strong className="text-white">{quotaStats.data.storage.limitFormatted}</strong>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="w-full bg-black/60 h-4 rounded-full overflow-hidden p-0.5 border border-dark-border flex">
                      <div
                        className="bg-gradient-to-r from-emerald-500 to-amber-500 h-full rounded-full transition-all duration-700 min-w-[6px]"
                        style={{ width: `${Math.max(1, Math.min(100, quotaStats.data.storage.percentUsed))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-emerald-400 font-bold">
                        En Uso: {quotaStats.data.storage.usedFormatted} ({quotaStats.data.storage.percentUsed}%)
                      </span>
                      <span className="text-white font-bold bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                        Disponible: {quotaStats.data.storage.remainingFormatted} ({quotaStats.data.storage.percentRemaining}%)
                      </span>
                    </div>
                  </div>

                  {/* 3 Metrics Cards (Espacio Usado, Espacio Libre, Total Documentos) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div className="bg-black/40 border border-dark-border rounded-lg p-4 space-y-1">
                      <span className="font-mono text-[11px] text-neutral-400 uppercase tracking-wider">Espacio Disponible</span>
                      <div className="text-xl font-display font-bold text-emerald-400">
                        {quotaStats.data.storage.remainingMB} MB
                      </div>
                      <p className="font-mono text-[10px] text-neutral-500">
                        {(quotaStats.data.storage.remainingMB / 1024).toFixed(2)} GB libres para miles de animes más
                      </p>
                    </div>

                    <div className="bg-black/40 border border-dark-border rounded-lg p-4 space-y-1">
                      <span className="font-mono text-[11px] text-neutral-400 uppercase tracking-wider">Espacio Ocupado</span>
                      <div className="text-xl font-display font-bold text-amber-400">
                        {quotaStats.data.storage.usedFormatted}
                      </div>
                      <p className="font-mono text-[10px] text-neutral-500">
                        {quotaStats.data.counts.totalDocuments} documentos registrados
                      </p>
                    </div>

                    <div className="bg-black/40 border border-dark-border rounded-lg p-4 space-y-1">
                      <span className="font-mono text-[11px] text-neutral-400 uppercase tracking-wider">Portadas en Servidor</span>
                      <div className="text-xl font-display font-bold text-white">
                        {quotaStats.data.storage.totalCoversDiskMB} MB
                      </div>
                      <p className="font-mono text-[10px] text-neutral-500">
                        {quotaStats.data.storage.totalCoversCount} portadas almacenadas
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Detailed Document Inventory */}
                <div className="bg-dark-card border border-dark-border rounded-lg p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-brand-red" />
                    <h3 className="font-display font-semibold text-sm tracking-wider uppercase text-white">
                      Desglose de Datos en tu Proyecto ({quotaStats.data.projectId})
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-black/40 border border-dark-border rounded text-center">
                      <span className="font-mono text-[10px] text-neutral-400 block uppercase">Animes</span>
                      <span className="text-lg font-display font-bold text-white">{quotaStats.data.counts.animes}</span>
                    </div>

                    <div className="p-3 bg-black/40 border border-dark-border rounded text-center">
                      <span className="font-mono text-[10px] text-neutral-400 block uppercase">Capítulos</span>
                      <span className="text-lg font-display font-bold text-white">{quotaStats.data.counts.episodes}</span>
                    </div>

                    <div className="p-3 bg-black/40 border border-dark-border rounded text-center">
                      <span className="font-mono text-[10px] text-neutral-400 block uppercase">Estudios</span>
                      <span className="text-lg font-display font-bold text-white">{quotaStats.data.counts.studios}</span>
                    </div>

                    <div className="p-3 bg-black/40 border border-dark-border rounded text-center">
                      <span className="font-mono text-[10px] text-neutral-400 block uppercase">Géneros</span>
                      <span className="text-lg font-display font-bold text-white">{quotaStats.data.counts.genres}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
          </motion.div>
        </AnimatePresence>

        {/* Modal de Inspección y Unificación de Portadas Duplicadas */}
        {showDuplicatesModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-fade-in">
            <div className="bg-[#0c0c0c] border border-dark-border rounded-xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-5 shadow-[0_25px_60px_rgba(0,0,0,0.9)]">
              <div className="flex items-center justify-between border-b border-dark-border pb-4">
                <div className="flex items-center gap-2.5 text-brand-red">
                  <Sparkles className="h-5 w-5" />
                  <div>
                    <h3 className="font-display font-bold text-xs tracking-widest uppercase text-white">
                      Análisis de Repetidos (Episodios, Telegram, Portadas, Nombres, Estudios y Géneros)
                    </h3>
                    <p className="font-mono text-[10px] text-neutral-400">
                      Unifica elementos repetidos en todo el sistema combinando historial de descargas, episodios y categorías.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDuplicatesModal(false)}
                  className="text-neutral-500 hover:text-white font-mono text-xs uppercase"
                >
                  ✕
                </button>
              </div>

              {duplicateDiagnostics.totalDuplicates === 0 ? (
                <div className="space-y-4">
                  <div className="text-center py-10 bg-black/40 border border-dark-border rounded-lg space-y-2">
                    <Check className="h-8 w-8 text-emerald-400 mx-auto" />
                    <h4 className="font-display font-semibold text-xs text-white uppercase">¡No se detectaron duplicados!</h4>
                    <p className="font-mono text-[10px] text-neutral-400">
                      Todos los enlaces de episodios, enlaces principales, nombres, imágenes, estudios y géneros son únicos en la base de datos.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isDeduplicating}
                    onClick={handleDeduplicate}
                    className="w-full py-2.5 bg-brand-red/10 hover:bg-brand-red text-brand-red hover:text-white border border-brand-red/30 rounded font-display font-semibold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                    title="Deduplica y unifica automáticamente estudios y géneros repetidos"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>{isDeduplicating ? 'Unificando estudios y géneros...' : 'Unificar Estudios y Géneros Repetidos'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary Badges */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Enlaces Episodios</span>
                      <span className="font-display font-bold text-sm text-brand-red">{duplicateDiagnostics.episodeLinkDupes.length} Grupos</span>
                    </div>
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Enlaces Telegram</span>
                      <span className="font-display font-bold text-sm text-brand-red">{duplicateDiagnostics.telegramDupes.length} Grupos</span>
                    </div>
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Nombres Repetidos</span>
                      <span className="font-display font-bold text-sm text-brand-red">{duplicateDiagnostics.titleDupes.length} Grupos</span>
                    </div>
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Imágenes Repetidas</span>
                      <span className="font-display font-bold text-sm text-brand-red">{duplicateDiagnostics.coverDupes.length} Grupos</span>
                    </div>
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Estudios Repetidos</span>
                      <span className="font-display font-bold text-sm text-purple-400">{duplicateDiagnostics.studioDupes.length} Grupos</span>
                    </div>
                    <div className="p-2.5 bg-dark-card border border-dark-border rounded-lg text-center space-y-0.5">
                      <span className="font-mono text-[8.5px] text-neutral-400 uppercase tracking-wider block">Géneros Repetidos</span>
                      <span className="font-display font-bold text-sm text-purple-400">{duplicateDiagnostics.genreDupes.length} Grupos</span>
                    </div>
                  </div>

                  {/* List of Duplicate Groups Preview */}
                  <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                    {/* Episode Link Dupes */}
                    {duplicateDiagnostics.episodeLinkDupes.map((group, idx) => (
                      <div key={`ep-${idx}`} className="p-3 bg-black/60 border border-dark-border/80 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono text-purple-400">
                          <span>Enlace de Episodio Duplicado</span>
                          <span>{group.length} coincidencias</span>
                        </div>
                        <p className="font-mono text-[10px] text-neutral-400 truncate bg-black/40 p-1.5 rounded border border-white/5">
                          {group[0].anime.episodes?.find(e => e.number === group[0].epNumber)?.telegramUrl || 'Enlace'}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {group.map(({ anime: a, epNumber }, i) => (
                            <div key={`${a.id}-${epNumber}-${i}`} className="flex items-center gap-2 bg-dark-card px-2 py-1 rounded border border-dark-border text-[10px]">
                              <span className="font-mono text-purple-400 font-bold">Ep. {epNumber}</span>
                              <span className="font-medium text-white truncate max-w-[140px]">{a.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Telegram Dupes */}
                    {duplicateDiagnostics.telegramDupes.map((group, idx) => (
                      <div key={`tg-${idx}`} className="p-3 bg-black/60 border border-dark-border/80 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono text-amber-400">
                          <span>Enlace Telegram Principal Duplicado</span>
                          <span>{group.length} coincidencias</span>
                        </div>
                        <p className="font-mono text-[10px] text-neutral-400 truncate bg-black/40 p-1.5 rounded border border-white/5">
                          {group[0].telegramUrl}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {group.map(a => (
                            <div key={a.id} className="flex items-center gap-2 bg-dark-card px-2 py-1 rounded border border-dark-border text-[10px]">
                              <div className="w-5 h-7 bg-neutral-900 rounded overflow-hidden shrink-0">
                                <SmartAnimeCover anime={a} className="w-full h-full object-cover" />
                              </div>
                              <span className="font-medium text-white truncate max-w-[150px]">{a.name}</span>
                              <span className="text-neutral-500 font-mono text-[9px]">({a.downloads || 0} descargas)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Title Dupes */}
                    {duplicateDiagnostics.titleDupes.map((group, idx) => (
                      <div key={`title-${idx}`} className="p-3 bg-black/60 border border-dark-border/80 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono text-amber-400">
                          <span>Nombre de Anime Duplicado</span>
                          <span>{group.length} coincidencias</span>
                        </div>
                        <p className="font-sans font-bold text-xs text-white">
                          "{group[0].name}"
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {group.map(a => (
                            <div key={a.id} className="flex items-center gap-2 bg-dark-card px-2 py-1 rounded border border-dark-border text-[10px]">
                              <div className="w-5 h-7 bg-neutral-900 rounded overflow-hidden shrink-0">
                                <SmartAnimeCover anime={a} className="w-full h-full object-cover" />
                              </div>
                              <span className="text-neutral-300 font-mono text-[9px] truncate max-w-[180px]">{a.telegramUrl}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Studio Dupes */}
                    {duplicateDiagnostics.studioDupes.map((group, idx) => (
                      <div key={`st-${idx}`} className="p-3 bg-black/60 border border-dark-border/80 rounded-lg space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-purple-400">
                          <span>Estudio Repetido</span>
                          <span>{group.length} coincidencias</span>
                        </div>
                        <p className="font-sans font-bold text-xs text-white">"{group[0].name}"</p>
                      </div>
                    ))}

                    {/* Genre Dupes */}
                    {duplicateDiagnostics.genreDupes.map((group, idx) => (
                      <div key={`gn-${idx}`} className="p-3 bg-black/60 border border-dark-border/80 rounded-lg space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-purple-400">
                          <span>Género Repetido</span>
                          <span>{group.length} coincidencias</span>
                        </div>
                        <p className="font-sans font-bold text-xs text-white">"{group[0].name}"</p>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      disabled={isDeduplicatingAnimes}
                      onClick={handleDeduplicateAnimes}
                      className="w-full py-3 bg-brand-red hover:bg-brand-red-hover disabled:opacity-50 text-white rounded font-display font-semibold text-xs tracking-widest uppercase flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer shadow-lg shadow-brand-red/20"
                    >
                      <Sparkles className="h-4 w-4" />
                      {isDeduplicatingAnimes ? 'Unificando y limpiando duplicados...' : 'Unificar Todo Automáticamente'}
                    </button>

                    <button
                      type="button"
                      disabled={isDeduplicating}
                      onClick={handleDeduplicate}
                      className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white border border-dark-border rounded font-display font-semibold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                      title="Deduplica y unifica automáticamente estudios y géneros repetidos"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-brand-red" />
                      <span>{isDeduplicating ? 'Unificando estudios y géneros...' : 'Unificar Estudios y Géneros'}</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-dark-border">
                <button
                  type="button"
                  onClick={() => setShowDuplicatesModal(false)}
                  className="px-4 py-2 bg-[#181818] hover:bg-[#222] text-neutral-300 rounded font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-fade-in">
            <div className="bg-[#0b0b0b] border border-dark-border rounded-lg p-6 max-w-sm w-full space-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
              <div className="flex items-center gap-2.5 text-brand-red">
                <AlertCircle className="h-5 w-5 animate-pulse" />
                <h3 className="font-display font-bold text-xs tracking-widest uppercase">{deleteConfirm.title}</h3>
              </div>
              <p className="font-sans text-[11px] text-neutral-400 leading-relaxed">
                {deleteConfirm.message}
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    deleteConfirm.onConfirm();
                    setDeleteConfirm(null);
                  }}
                  className="flex-1 py-2 bg-brand-red hover:bg-brand-red-hover text-white rounded font-display font-semibold text-[10px] tracking-widest uppercase transition-all duration-300 cursor-pointer"
                >
                  Confirmar
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2 bg-[#141414] hover:bg-[#202020] border border-dark-border text-neutral-400 hover:text-white rounded font-mono text-[10px] uppercase tracking-wider transition-colors duration-300 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Ficha de Anime - Exact replica of Screenshot 2 */}
        {selectedAnimeDetails && (() => {
          const sIds = (selectedAnimeDetails.studioIds && selectedAnimeDetails.studioIds.length > 0)
            ? selectedAnimeDetails.studioIds
            : (selectedAnimeDetails.studioId ? [selectedAnimeDetails.studioId] : []);
          const sNames = sIds.map(id => studioMapForAdmin.get(id) || studios.find(s => s.id === id)?.name).filter(Boolean);
          const sName = sNames.length > 0 ? sNames.join(', ') : 'Sin estudio';

          const gNames = (selectedAnimeDetails.genreIds || [])
            .map(id => genres.find(g => g.id === id)?.name)
            .filter(Boolean);
          const genreText = gNames.length > 0 ? gNames.join(', ') : 'Sin géneros';

          const rStats = getAnimeRatingStats(selectedAnimeDetails.id);
          const ratingText = rStats.totalVotes === 0 
            ? 'Sin calificación' 
            : `★ ${rStats.average.toFixed(1)} (${rStats.totalVotes} voto${rStats.totalVotes === 1 ? '' : 's'})`;

          const epCount = selectedAnimeDetails.episodes?.length || 0;
          const epText = `${epCount} episodio${epCount === 1 ? '' : 's'}`;

          return (
            <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-fade-in">
              <div className="bg-[#0e061a] border border-[#2b144d] rounded-2xl p-4 sm:p-5 max-w-sm sm:max-w-md w-full shadow-2xl space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-20 bg-neutral-900 border border-purple-500/30 rounded-lg overflow-hidden shrink-0 shadow">
                      <SmartAnimeCover anime={selectedAnimeDetails} studioName={sName} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="font-sans font-bold text-sm sm:text-base text-white leading-snug line-clamp-2">
                        {selectedAnimeDetails.name} {selectedAnimeDetails.year ? `(${selectedAnimeDetails.year})` : ''}
                      </h3>
                      <p className="font-mono text-xs text-neutral-400">
                        Ficha de Anime
                      </p>
                      <div className="pt-0.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 text-[10px] sm:text-[11px] font-mono">
                          <Globe className="h-3 w-3 text-emerald-400 shrink-0" />
                          <span className="truncate max-w-[180px] sm:max-w-xs">{selectedAnimeDetails.storageLocation || 'Firebase Firestore (kuzeh-01)'}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedAnimeDetails(null)}
                    className="p-1.5 rounded-lg bg-[#1a0f2e] border border-[#311756] text-neutral-400 hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Content Box: DETALLES DEL CONTENIDO */}
                <div className="bg-[#130722] border border-[#29124a] rounded-xl p-3.5 sm:p-4 space-y-2.5 font-mono text-xs sm:text-[13px]">
                  <div className="flex items-center gap-2 text-[#ec4899] font-bold text-xs uppercase tracking-wider mb-1">
                    <Film className="h-4 w-4 text-[#ec4899] shrink-0" />
                    <span>DETALLES DEL CONTENIDO</span>
                  </div>

                  <div className="space-y-1.5 text-neutral-300">
                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Estudios:</span>
                      <span className="text-neutral-100 font-medium truncate">{sName}</span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Géneros:</span>
                      <span className="text-neutral-200 line-clamp-2">{genreText}</span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Estado:</span>
                      <span className={`font-bold ${
                        (selectedAnimeDetails.status?.toLowerCase().includes('emisi') || selectedAnimeDetails.status === 'Próximamente')
                          ? 'text-emerald-400'
                          : 'text-neutral-300'
                      }`}>
                        {(selectedAnimeDetails.status?.toLowerCase().includes('emisi') || selectedAnimeDetails.status === 'Próximamente') ? 'Emisión' : 'Finalizado'}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Descargas:</span>
                      <span className="text-white font-bold">{selectedAnimeDetails.downloads || 0}</span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Calificación:</span>
                      <span className="text-amber-400 font-bold">{ratingText}</span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-neutral-400 font-semibold shrink-0">Episodios:</span>
                      <span className="text-white font-bold">{epText}</span>
                    </div>

                    {selectedAnimeDetails.description && (
                      <div className="border-t border-[#261144] pt-2 mt-2">
                        <span className="text-neutral-400 font-semibold block mb-1">Sinopsis:</span>
                        <p className="text-neutral-300 font-sans text-xs leading-relaxed line-clamp-4">
                          {selectedAnimeDetails.description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Action: Purple CERRAR Button */}
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => setSelectedAnimeDetails(null)}
                    className="px-6 py-2 bg-[#9d4edd] hover:bg-[#8b3fd0] text-white font-sans font-bold text-xs uppercase tracking-wider rounded-lg shadow-md transition-all active:scale-95 cursor-pointer ml-auto block"
                  >
                    CERRAR
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Quick Add Episode Modal */}
        {showQuickAddEpModal && (
          <div className="fixed inset-0 z-[9990] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-dark-card border border-dark-border rounded-xl p-6 max-w-lg w-full space-y-5 shadow-2xl relative">
              <div className="flex items-center justify-between border-b border-dark-border pb-3">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-5 w-5 text-purple-400" />
                  <h3 className="font-display font-bold text-sm tracking-widest text-white uppercase">
                    Agregar Episodio por Enlace
                  </h3>
                </div>
                <button
                  onClick={() => setShowQuickAddEpModal(false)}
                  className="text-neutral-500 hover:text-white p-1 text-xs font-mono"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* Chapter Inputs List */}
                <div className="space-y-2.5">
                  <label className="font-mono text-[9.5px] text-purple-300 uppercase tracking-widest block font-semibold">
                    Episodios a Agregar ({quickEpItems.length}/12)
                  </label>

                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {quickEpItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-[#050505] border border-dark-border rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-purple-300 font-bold uppercase">Nº Episodio</span>
                            <input
                              type="number"
                              min="1"
                              max="999"
                              value={item.number}
                              onChange={(e) => handleUpdateQuickEpNumber(idx, e.target.value)}
                              className="w-16 bg-[#0a0a0a] border border-dark-border focus:border-purple-500 rounded px-2 py-0.5 text-xs text-white font-mono outline-none"
                            />
                          </div>
                          {quickEpItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveQuickEpField(idx)}
                              className="text-neutral-500 hover:text-red-400 p-1 text-xs font-mono"
                              title="Eliminar este episodio"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            ref={(el) => { quickEpInputRefs.current[idx] = el; }}
                            type="text"
                            value={item.url}
                            onChange={(e) => handleQuickItemUrlChange(idx, e.target.value)}
                            onPaste={(e) => {
                              const pasted = e.clipboardData.getData('text');
                              if (pasted) {
                                handleQuickItemUrlChange(idx, pasted);
                              }
                            }}
                            placeholder={`Pegar enlace del episodio ${item.number} (ej. Internet Archive)`}
                            className="flex-1 min-w-0 bg-[#0a0a0a] border border-dark-border focus:border-purple-500 rounded p-2.5 text-xs text-white placeholder-neutral-600 outline-none transition-colors font-mono"
                          />

                          {/* Botón miniatura al lado del enlace: '+' si no hay, '✓' si está lista */}
                          <label
                            className={`h-9 w-9 shrink-0 flex items-center justify-center rounded cursor-pointer transition-all border group select-none ${
                              item.coverImage
                                ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-400 hover:bg-emerald-900/50 shadow-sm'
                                : 'bg-[#0a0a0a] border-dark-border hover:border-purple-500/60 text-neutral-400 hover:text-white'
                            }`}
                            title={item.coverImage ? 'Miniatura lista (clic para cambiar, clic derecho para quitar)' : 'Agregar miniatura al episodio'}
                            onContextMenu={(e) => {
                              if (item.coverImage) {
                                e.preventDefault();
                                setQuickEpItems(prev => {
                                  const updated = [...prev];
                                  updated[idx] = { ...updated[idx], coverImage: undefined };
                                  return updated;
                                });
                                showNotification(`Miniatura removida del Episodio ${item.number}`, 'success');
                              }
                            }}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onload = (ev) => {
                                    const res = ev.target?.result as string;
                                    if (res) {
                                      setQuickEpItems(prev => {
                                        const updated = [...prev];
                                        updated[idx] = { ...updated[idx], coverImage: res };
                                        return updated;
                                      });
                                      showNotification(`Miniatura lista para el Episodio ${item.number}`, 'success');
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                  e.target.value = '';
                                }
                              }}
                            />
                            {item.coverImage ? (
                              <Check className="h-4 w-4 text-emerald-400 stroke-[2.5]" />
                            ) : (
                              <Plus className="h-4 w-4 text-neutral-400 group-hover:text-purple-300 transition-colors" />
                            )}
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Single Dynamic Button changing label according to the next chapter number */}
                  {quickEpItems.length < 12 && (
                    <button
                      type="button"
                      onClick={handleAddQuickEpField}
                      className="w-full py-2 bg-[#121212] hover:bg-[#1a1a1a] border border-purple-500/30 hover:border-purple-500/60 text-purple-300 hover:text-white rounded-lg font-mono text-xs font-semibold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Plus className="h-3.5 w-3.5 text-purple-400" />
                      <span>➕ Episodio {nextQuickEpNumber}</span>
                    </button>
                  )}
                </div>

                {/* Target Anime Selector */}
                <div className="space-y-1.5">
                  <label className="font-mono text-[9.5px] text-neutral-300 uppercase tracking-widest block font-semibold">
                    Anime Destino *
                  </label>
                  <select
                    value={quickEpTargetAnimeId}
                    onChange={(e) => setQuickEpTargetAnimeId(e.target.value)}
                    className="w-full bg-[#050505] border border-dark-border focus:border-purple-500 rounded p-2.5 text-xs text-white outline-none transition-colors"
                  >
                    <option value="">-- Selecciona un anime --</option>
                    <option value="NEW_ANIME" className="text-purple-300 font-bold">
                      ✨ + Crear nuevo anime con este título: "{quickEpDetectedTitle || 'Sin Nombre'}"
                    </option>
                    <optgroup label="Animes Existentes en la Galería">
                      {animes.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.episodes?.length || 0} episodios)
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-dark-border">
                <button
                  type="button"
                  onClick={() => setShowQuickAddEpModal(false)}
                  className="px-4 py-2 bg-[#111] hover:bg-neutral-800 text-neutral-400 hover:text-white rounded font-mono text-xs uppercase tracking-wider transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSavingQuickEp || !quickEpItems.some(it => it.url.trim() !== '')}
                  onClick={handleSaveQuickEpisode}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded font-display font-medium text-xs tracking-wider uppercase transition-all duration-200 flex items-center gap-1.5 shadow-lg shadow-purple-600/30 cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  {isSavingQuickEp ? 'Guardando...' : `Guardar ${quickEpItems.filter(it => it.url.trim() !== '').length || 1} Episodio(s)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floating Trash Bin Modal - Always centered in the middle of screen */}
        {showTrashModal && (
          <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div 
              className="absolute inset-0" 
              onClick={() => setShowTrashModal(false)} 
            />
            <div className="relative z-10 bg-[#0e0818] border border-purple-900/60 rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-[0_25px_60px_rgba(0,0,0,0.9)] space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-purple-950/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-red-950/50 border border-red-500/30 text-red-400">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide">
                      Papelera de Eliminados
                    </h3>
                    <p className="font-mono text-[10px] text-neutral-400">
                      {trashNames.length} {trashNames.length === 1 ? 'anime registrado' : 'animes registrados'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTrashModal(false)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* List of names only */}
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900/60 scrollbar-track-transparent">
                {trashNames.length > 0 ? (
                  trashNames.map((name, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-2 rounded-lg bg-[#140b24] border border-[#23153c] text-xs font-medium text-neutral-200 flex items-center gap-2 truncate"
                    >
                      <span className="font-mono text-[9px] text-purple-400 font-bold shrink-0">#{idx + 1}</span>
                      <span className="truncate">{name}</span>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <Trash2 className="h-8 w-8 text-neutral-700 mx-auto" />
                    <p className="font-mono text-xs text-neutral-500">La papelera está vacía.</p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-2 border-t border-purple-950/80 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={trashNames.length === 0 || isClearingTrash}
                  onClick={handleEmptyTrash}
                  className="px-4 py-2 bg-red-600/90 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-600/90 text-white rounded-xl font-mono text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-red-950/50 active:scale-95"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isClearingTrash ? 'Vaciando...' : 'Vaciar papelera'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowTrashModal(false)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-xl font-mono text-xs transition-colors cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Toast Notification */}
        {notification && (
          <div className="fixed bottom-6 right-6 bg-[#0c0c0c] border border-dark-border/80 rounded-lg p-4 shadow-[0_12px_40px_rgba(0,0,0,0.85)] z-[9999] flex items-center gap-3 animate-slide-up border-l-4 border-l-brand-red">
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${notification.type === 'success' ? 'bg-emerald-500' : 'bg-brand-red'}`} />
            <p className="font-display text-xs text-white font-semibold tracking-wide">{notification.message}</p>
          </div>
        )}
      </main>
    </div>
  );
}
