/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react';
import { Studio, Genre, Anime, normalizeAnimeYear } from './types';
import { 
  requestPersistentStorage, 
  saveMyListToIDB, 
  getMyListFromIDB, 
  saveMyListAnimesToIDB,
  saveCatalogToIDB,
  getCatalogFromIDB
} from './lib/idbStorage';
import { getStableDeviceId } from './lib/deviceFingerprint';
import { auth, onAuthStateChanged, configureAuthPersistence, db, doc, getDoc, collection, getDocs } from './lib/firebase';
import { User } from 'firebase/auth';
import { 
  addAnimeToUserList, 
  removeAnimeFromUserList, 
  subscribeToUserList, 
  cleanupExpiredUserListItems, 
  syncLocalItemsToUserList,
  updateUserLastLogin,
  cleanupInactiveUsers
} from './lib/userListService';
import {
  addAnimeToWatched,
  removeAnimeFromWatched,
  subscribeToUserWatched,
  syncLocalWatchedToUser
} from './lib/userWatchedService';
import GalleryCard from './components/GalleryCard';
import GalleryFilter, { GalleryDisplayMode } from './components/GalleryFilter';
import AnimeDetail from './components/AnimeDetail';
import FilterModal from './components/FilterModal';
import StudioDetailModal from './components/StudioDetailModal';
import AuthModal from './components/AuthModal';
import UserProfileModal from './components/UserProfileModal';
import ReportIssueModal from './components/ReportIssueModal';
import PopularHeroCarousel from './components/PopularHeroCarousel';
import HorizontalSectionRow from './components/HorizontalSectionRow';
import { getRecommendedAnimes } from './utils/recommendationManager';

const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
import { SmartAnimeCover, processImageSrc, globalImageCache, preloadAllAnimes, preloadAnimeCover, getFallbackSvg, startPrioritizedAppLoading, prefetchAnime, prefetchCatalogPage } from './utils/imageFallback';
import { normalizeEpisodesList } from './utils/episodeUtils';
import { getAnimeRatingStats } from './utils/ratingManager';
import { computeHeroFeaturedAnimes, recordHeroAnimeView } from './utils/heroCycleManager';

const extractEpisodeThumbnails = (list: Anime[]): string[] => {
  const result: string[] = [];
  list.forEach(a => {
    if (a.episodes) {
      a.episodes.forEach(ep => {
        if (ep.isNew && (ep.thumbnail || ep.coverImage)) {
          result.push((ep.thumbnail || ep.coverImage)!);
        }
      });
    }
  });
  return result;
};
import { 
  Search, Film, Info, Plus, ChevronDown, Check, Send, AlertCircle, 
  MapPin, Heart, ExternalLink, ShieldCheck, Shield, Zap, Lock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  SlidersHorizontal, X, RotateCcw, Flame, Menu, UserCheck, LogIn, Palette, Moon, Sparkles, Eye, Bookmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppTheme } from './lib/theme';

// Path to generated hero background
const heroBg = '/src/assets/images/hero_background_1784586062430.jpg';

// Items per page: 10 rows of 3 items in base view (30 items per page)
const ITEMS_PER_PAGE = 30;

// Custom SignIcon matching user image
const SignIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2.2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M4 2v20" />
    <path d="M4 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4" />
    <path d="M4 11h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4" />
  </svg>
);

import { 
  NormalizedAnimeData, 
  normalizeSearchText, 
  calculateRelevanceScore, 
  matchesFuzzySearch, 
  buildNormalizedAnimeData 
} from './utils/searchUtils';

export type PageType = 'home' | 'detail' | 'admin' | 'my-list' | 'watched' | 'studio';

export const isUpcomingStatus = (status?: string) => Boolean(
  status && (
    status === 'Próximamente' ||
    status.toLowerCase() === 'próximamente' ||
    status.toLowerCase() === 'proximamente'
  )
);

const isEmisionStatus = (status?: string) => Boolean(
  status && (
    status.toLowerCase().includes('emisi') ||
    status.toLowerCase().includes('emisión')
  ) && !isUpcomingStatus(status)
);

// Limpieza de datos temporales/locales al reiniciar o recargar la página para que siempre inicie fresca
if (typeof window !== 'undefined') {
  try {
    const keysToCleanOnRestart = [
      'hk_guest_my_list',
      'hk_guest_my_list_ts',
      'kh_guest_watched_list',
      'kh_catalog_page',
      'kh_display_mode',
      'kh_studios_expanded',
      'hk_cached_animes',
      'hk_cached_studios',
      'hk_cached_genres',
      'kh_report_chat_messages',
      'kh_recommendations_48h_v1',
      'kh_persisted_loaded_covers',
      'kh_anime_views_24h'
    ];
    keysToCleanOnRestart.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch (e) {}
}

export default function App() {
  // Page routing state
  const [currentPage, setCurrentPage] = useState<PageType>('home');
  const [previousPage, setPreviousPage] = useState<PageType>('home');
  const [selectedStudio, setSelectedStudio] = useState<Studio | null>(null);
  const [selectedAnimeId, setSelectedAnimeId] = useState<string>('');
  const [selectedEpisodeNum, setSelectedEpisodeNum] = useState<number | undefined>(undefined);
  const [navDirection, setNavDirection] = useState<number>(1);
  const [isDetailAnimating, setIsDetailAnimating] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isCatalogSearchOpen, setIsCatalogSearchOpen] = useState<boolean>(false);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');
  const deferredCatalogSearchQuery = React.useDeferredValue(catalogSearchQuery);
  const [catalogSearchVisibleCount, setCatalogSearchVisibleCount] = useState<number>(30);
  const catalogSearchInputRef = useRef<HTMLInputElement>(null);

  // In-session "Mi Lista" state (isolated by user account in Firestore or clean in-memory session)
  const [myListIds, setMyListIds] = useState<string[]>([]);

  // In-session "Vistos" state (isolated by user account in Firestore or clean in-memory session)
  const [watchedIds, setWatchedIds] = useState<string[]>([]);

  // 1. Firebase Auth listener & Firestore User List Auto-Sync (100% Isolated per User)
  useEffect(() => {
    let isMounted = true;

    // Safely configure auth persistence
    configureAuthPersistence().catch(() => {});

    let unsubscribeList: (() => void) | null = null;
    let unsubscribeWatched: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;
      setCurrentUser(user);
      setAuthLoading(false);

      if (unsubscribeList) {
        unsubscribeList();
        unsubscribeList = null;
      }
      if (unsubscribeWatched) {
        unsubscribeWatched();
        unsubscribeWatched = null;
      }

      if (user) {
        // Load user theme preference
        try {
          const userSavedTheme = localStorage.getItem(`kh_theme_${user.uid}`);
          if (userSavedTheme === 'default' || userSavedTheme === 'black') {
            setAppTheme(userSavedTheme as any, user.uid);
          } else {
            getDoc(doc(db, 'users', user.uid)).then(snap => {
              if (snap.exists()) {
                const uTheme = snap.data()?.theme;
                if (uTheme === 'default' || uTheme === 'black') {
                  setAppTheme(uTheme, user.uid);
                }
              }
            }).catch(() => {});
          }
        } catch (e) {}

        // Immediately load user-specific cached list for fast render
        try {
          const userCache = localStorage.getItem(`hk_user_my_list_${user.uid}`);
          if (userCache) {
            setMyListIds(JSON.parse(userCache));
          } else {
            setMyListIds([]);
          }
        } catch (e) {
          setMyListIds([]);
        }

        // Immediately load user-specific cached watched list
        try {
          const userWatchedCache = localStorage.getItem(`kh_user_watched_${user.uid}`);
          if (userWatchedCache) {
            setWatchedIds(JSON.parse(userWatchedCache));
          } else {
            setWatchedIds([]);
          }
        } catch (e) {
          setWatchedIds([]);
        }

        // Update last login timestamp and run cleanup safely in background
        updateUserLastLogin(user.uid, user.email, user.displayName).catch(() => {});
        cleanupInactiveUsers().catch(() => {});
        cleanupExpiredUserListItems(user.uid).catch(() => {});

        // Sync ONLY guest items if the user created items while logged out in guest mode
        try {
          const savedGuest = localStorage.getItem('hk_guest_my_list');
          if (savedGuest) {
            const guestIds: string[] = JSON.parse(savedGuest);
            if (guestIds.length > 0) {
              await syncLocalItemsToUserList(user.uid, guestIds);
            }
            localStorage.removeItem('hk_guest_my_list');
          }
          // Remove old legacy shared key so it can't contaminate any account
          localStorage.removeItem('hk_my_list');
        } catch (e) {}

        // Sync guest watched items if any
        try {
          const savedGuestWatched = localStorage.getItem('kh_guest_watched_list');
          if (savedGuestWatched) {
            const guestWatchedIds: string[] = JSON.parse(savedGuestWatched);
            if (guestWatchedIds.length > 0) {
              await syncLocalWatchedToUser(user.uid, guestWatchedIds);
            }
            localStorage.removeItem('kh_guest_watched_list');
          }
        } catch (e) {}

        // Priority 1: Subscribe to Firebase account list with real-time sync
        unsubscribeList = subscribeToUserList(user.uid, (validAnimeIds) => {
          if (!isMounted) return;
          setMyListIds(validAnimeIds);
          try {
            localStorage.setItem(`hk_user_my_list_${user.uid}`, JSON.stringify(validAnimeIds));
          } catch (e) {}
          saveMyListToIDB(validAnimeIds, user.uid);
        });

        // Priority 2: Subscribe to Firebase watched list with real-time sync across devices
        unsubscribeWatched = subscribeToUserWatched(user.uid, (animeIds) => {
          if (!isMounted) return;
          setWatchedIds(animeIds);
          try {
            localStorage.setItem(`kh_user_watched_${user.uid}`, JSON.stringify(animeIds));
          } catch (e) {}
        });
      } else {
        // User logged out: clear state and guest cache so no account leakage happens
        localStorage.removeItem('hk_guest_my_list');
        localStorage.removeItem('hk_my_list');
        localStorage.removeItem('kh_guest_watched_list');
        setMyListIds([]);
        setWatchedIds([]);
      }
    });

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    requestPersistentStorage();

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeList) {
        unsubscribeList();
      }
      if (unsubscribeWatched) {
        unsubscribeWatched();
      }
    };
  }, []);

  const handleToggleWatched = (animeId: string) => {
    setWatchedIds(prev => {
      const exists = prev.includes(animeId);
      const updated = exists ? prev.filter(id => id !== animeId) : [...prev, animeId];
      const uid = auth.currentUser?.uid;

      if (uid) {
        try {
          localStorage.setItem(`kh_user_watched_${uid}`, JSON.stringify(updated));
        } catch (e) {}

        if (exists) {
          removeAnimeFromWatched(uid, animeId).catch(() => {});
        } else {
          addAnimeToWatched(uid, animeId).catch(() => {});
        }
      } else {
        try {
          localStorage.setItem('kh_guest_watched_list', JSON.stringify(updated));
        } catch (e) {}
      }

      return updated;
    });
  };

  const handleToggleMyList = (animeId: string) => {
    setMyListIds(prev => {
      const exists = prev.includes(animeId);
      const updated = exists ? prev.filter(id => id !== animeId) : [...prev, animeId];
      
      const uid = auth.currentUser?.uid;

      if (uid) {
        // Logged-in user: store under user-specific key
        try {
          localStorage.setItem(`hk_user_my_list_${uid}`, JSON.stringify(updated));
        } catch (e) {}

        if (exists) {
          removeAnimeFromUserList(uid, animeId);
        } else {
          addAnimeToUserList(uid, animeId);
        }
        saveMyListToIDB(updated, uid);
        const myListAnimes = animes.filter(a => updated.includes(a.id));
        saveMyListAnimesToIDB(myListAnimes, uid);
      } else {
        // Guest user: store under guest key with 90-day timestamp tracking
        try {
          const timestampMap: Record<string, number> = JSON.parse(localStorage.getItem('hk_guest_my_list_ts') || '{}');
          if (exists) {
            delete timestampMap[animeId];
          } else {
            timestampMap[animeId] = Date.now();
          }
          localStorage.setItem('hk_guest_my_list_ts', JSON.stringify(timestampMap));
          localStorage.setItem('hk_guest_my_list', JSON.stringify(updated));
        } catch (e) {}
        saveMyListToIDB(updated, 'guest');
        const myListAnimes = animes.filter(a => updated.includes(a.id));
        saveMyListAnimesToIDB(myListAnimes, 'guest');
      }

      return updated;
    });
  };

  // Database lists state
  const [studios, setStudios] = useState<Studio[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [animes, setAnimes] = useState<Anime[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Search & Filters state
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [returnAnimeId, setReturnAnimeId] = useState<string>('');
  const returnAnimeOriginPageRef = useRef<PageType>('home');
  const studioPageRef = useRef<number>(1);
  const studioScrollRef = useRef<number>(0);
  const [selectedStudioId, setSelectedStudioId] = useState('');
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedRating, setSelectedRating] = useState('');
  const [sortBy, setSortBy] = useState<string>('name-asc');
  const [displayMode, setDisplayMode] = useState<GalleryDisplayMode>('sections');
  const [page, setPage] = useState<number>(1);

  const handleToggleDisplayMode = (mode: GalleryDisplayMode) => {
    setDisplayMode(mode);
    try {
      localStorage.setItem('kh_display_mode', mode);
    } catch {}
    if (mode === 'catalog') {
      try {
        const savedPage = localStorage.getItem('kh_catalog_page');
        const parsed = parseInt(savedPage || '1', 10);
        if (!isNaN(parsed) && parsed >= 1) {
          setPage(parsed);
        }
      } catch {}
    }
  };
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [myListTab, setMyListTab] = useState<'saved' | 'watched'>('saved');
  const [appTheme, setAppTheme] = useAppTheme();

  const handleUserUpdated = () => {
    if (auth.currentUser) {
      setCurrentUser(Object.assign(Object.create(Object.getPrototypeOf(auth.currentUser)), auth.currentUser));
    }
  };

  const handleLogout = async () => {
    setMyListIds([]);
    try {
      localStorage.removeItem('hk_guest_my_list');
      localStorage.removeItem('hk_my_list');
    } catch (e) {}
    await auth.signOut();
  };
  const [pageDirection, setPageDirection] = useState<number>(1);
  const [genreUsageMap, setGenreUsageMap] = useState<Record<string, number>>({});

  // Persistent studio filter expansion across route navigation & reloads
  const [isStudiosExpanded, setIsStudiosExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('kh_studios_expanded') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleStudiosExpanded = useCallback(() => {
    setIsStudiosExpanded(prev => {
      const next = !prev;
      try {
        localStorage.setItem('kh_studios_expanded', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Listen for custom event to open auth modal when guest tries to vote
  useEffect(() => {
    const handleOpenAuth = () => setIsAuthModalOpen(true);
    window.addEventListener('kh_open_auth_modal', handleOpenAuth);
    return () => window.removeEventListener('kh_open_auth_modal', handleOpenAuth);
  }, []);

  const [ratingVersion, setRatingVersion] = useState(0);
  useEffect(() => {
    const handleRatingUpdate = () => setRatingVersion(v => v + 1);
    window.addEventListener('kh_rating_updated', handleRatingUpdate);
    return () => window.removeEventListener('kh_rating_updated', handleRatingUpdate);
  }, []);

  const [heroCycleVersion, setHeroCycleVersion] = useState(0);
  useEffect(() => {
    const handleHeroUpdate = () => setHeroCycleVersion(v => v + 1);
    window.addEventListener('kh_hero_cycle_updated', handleHeroUpdate);
    const interval = setInterval(() => {
      setHeroCycleVersion(v => v + 1);
    }, 60000);
    return () => {
      window.removeEventListener('kh_hero_cycle_updated', handleHeroUpdate);
      clearInterval(interval);
    };
  }, []);


  // Reset page to 1 only when search or filters change, NOT when toggling displayMode or navigating
  useEffect(() => {
    setPageDirection(1);
    setPage(1);
    try {
      localStorage.setItem('kh_catalog_page', '1');
    } catch {}
  }, [searchQuery, selectedStudioId, selectedGenreIds, selectedYear, selectedStatus, selectedRating, sortBy]);

  // Fetch Database Data from APIs safely without wiping state on error
  const fetchData = async (silent = false) => {
    try {
      if (!silent && animes.length === 0) {
        setLoading(true);
      }
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('hk_admin_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Cache-busting headers to prevent Vercel CDN/Browser edge caches from serving stale data
      const fetchHeaders: HeadersInit = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        ...headers
      };

      // Try combined /api/bootstrap endpoint first if on a Node/Express server
      const bootstrapRes = await fetch(`/api/bootstrap?_t=${Date.now()}`, { 
        headers: fetchHeaders,
        cache: 'no-store'
      }).catch(() => null);

      let isStaticHosting = false;

      if (bootstrapRes && bootstrapRes.ok) {
        const contentType = bootstrapRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await bootstrapRes.json().catch(() => null);
          if (data && Array.isArray(data.studios) && Array.isArray(data.genres) && Array.isArray(data.animes)) {
            const normalizedAnimes = data.animes.map((a: any) => ({
              ...a,
              episodes: normalizeEpisodesList(a.episodes)
            }));
            setStudios(data.studios);
            setGenres(data.genres);
            setAnimes(normalizedAnimes);
            try {
              sessionStorage.setItem('hk_cached_studios', JSON.stringify(data.studios));
              sessionStorage.setItem('hk_cached_genres', JSON.stringify(data.genres));
              sessionStorage.setItem('hk_cached_animes', JSON.stringify(normalizedAnimes));
            } catch (e) {}
            // Permanent persistent save in IndexedDB
            saveCatalogToIDB(normalizedAnimes, data.studios, data.genres);
            // Prioritized startup load: episodes & catalog page 1 first, then background queue
            const epThumbs = extractEpisodeThumbnails(normalizedAnimes);
            startPrioritizedAppLoading(normalizedAnimes, data.studios, epThumbs);
            return;
          }
        } else {
          isStaticHosting = true;
        }
      } else {
        isStaticHosting = true;
      }

      let loadedStudios: Studio[] | null = null;
      let loadedGenres: Genre[] | null = null;
      let loadedAnimes: Anime[] | null = null;

      // Only attempt individual API requests if NOT on static hosting (e.g. Vercel)
      if (!isStaticHosting) {
        const [resStudios, resGenres, resAnimes] = await Promise.all([
          fetch(`/api/studios?_t=${Date.now()}`, { headers: fetchHeaders, cache: 'no-store' }).catch(() => null),
          fetch(`/api/genres?_t=${Date.now()}`, { headers: fetchHeaders, cache: 'no-store' }).catch(() => null),
          fetch(`/api/animes?_t=${Date.now()}`, { headers: fetchHeaders, cache: 'no-store' }).catch(() => null)
        ]);

        if (resStudios && resStudios.ok) {
          const contentType = resStudios.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              const dataStudios = await resStudios.json();
              if (Array.isArray(dataStudios)) loadedStudios = dataStudios;
            } catch (e) {}
          }
        }

        if (resGenres && resGenres.ok) {
          const contentType = resGenres.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              const dataGenres = await resGenres.json();
              if (Array.isArray(dataGenres)) loadedGenres = dataGenres;
            } catch (e) {}
          }
        }

        if (resAnimes && resAnimes.ok) {
          const contentType = resAnimes.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              const dataAnimes = await resAnimes.json();
              if (Array.isArray(dataAnimes)) {
                loadedAnimes = dataAnimes.map((a: any) => ({
                  ...a,
                  episodes: normalizeEpisodesList(a.episodes)
                }));
              }
            } catch (e) {}
          }
        }
      }

      // CRITICAL FALLBACK FOR VERCEL / NETLIFY / GITHUB PAGES / STATIC HOSTING:
      // If the Node/Express backend is not running or returned 404 (common in static deployments),
      // connect and query directly from Firebase Firestore in the client browser!
      if (!loadedAnimes || loadedAnimes.length === 0) {
        console.info('⚡ [Modo Hosting Estático / Vercel] Backend Express en /api/ no detectado. Conectando directamente a Firebase Firestore...');
        try {
          const [animesSnap, studiosSnap, genresSnap] = await Promise.all([
            getDocs(collection(db, 'animes')).catch(() => null),
            getDocs(collection(db, 'studios')).catch(() => null),
            getDocs(collection(db, 'genres')).catch(() => null)
          ]);

          if (animesSnap && !animesSnap.empty) {
            loadedAnimes = animesSnap.docs.map(docSnap => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                name: d.name || '',
                image: d.image || '',
                coverData: d.coverData || (d.image && typeof d.image === 'string' && d.image.startsWith('data:') ? d.image : undefined),
                year: d.year || '',
                telegramUrl: d.telegramUrl || '',
                episodes: normalizeEpisodesList(d.episodes),
                studioId: d.studioId || '',
                studioIds: d.studioIds || (d.studioId ? [d.studioId] : []),
                genreIds: d.genreIds || [],
                status: d.status || 'Finalizado',
                description: d.description || '',
                hidden: Boolean(d.hidden),
                downloads: Number(d.downloads) || 0,
                createdAt: d.createdAt || '',
                updatedAt: d.updatedAt || '',
                storageLocation: 'Firebase Firestore (khentai)',
                savedInFirestore: true
              } as Anime;
            });
          }

          if (studiosSnap && !studiosSnap.empty) {
            loadedStudios = studiosSnap.docs.map(docSnap => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                name: d.name || '',
                image: d.image || '',
                storageLocation: 'Firebase Firestore (khentai)'
              } as Studio;
            });
          }

          if (genresSnap && !genresSnap.empty) {
            loadedGenres = genresSnap.docs.map(docSnap => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                name: d.name || '',
                storageLocation: 'Firebase Firestore (khentai)'
              } as Genre;
            });
          }
        } catch (fsErr) {
          console.warn('⚠️ [Firebase Direct Fallback Warning]:', fsErr);
        }
      }

      if (loadedStudios && loadedStudios.length > 0) {
        setStudios(loadedStudios);
        try {
          sessionStorage.setItem('hk_cached_studios', JSON.stringify(loadedStudios));
          localStorage.setItem('hk_cached_studios', JSON.stringify(loadedStudios));
        } catch (e) {}
      }

      if (loadedGenres && loadedGenres.length > 0) {
        setGenres(loadedGenres);
        try {
          sessionStorage.setItem('hk_cached_genres', JSON.stringify(loadedGenres));
          localStorage.setItem('hk_cached_genres', JSON.stringify(loadedGenres));
        } catch (e) {}
      }

      if (loadedAnimes && loadedAnimes.length > 0) {
        setAnimes(loadedAnimes);
        try {
          sessionStorage.setItem('hk_cached_animes', JSON.stringify(loadedAnimes));
          localStorage.setItem('hk_cached_animes', JSON.stringify(loadedAnimes));
        } catch (e) {}
        saveCatalogToIDB(loadedAnimes, loadedStudios || studios, loadedGenres || genres);
        const epThumbs = extractEpisodeThumbnails(loadedAnimes);
        startPrioritizedAppLoading(loadedAnimes, loadedStudios || studios, epThumbs);
      }
    } catch (err) {
      console.warn('Sync status:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sync state once on startup: loads cache for instant 0ms render, and immediately fetches fresh data in background
  useEffect(() => {
    let isMounted = true;
    getCatalogFromIDB().then(cached => {
      if (!isMounted) return;
      if (cached && Array.isArray(cached.animes) && cached.animes.length > 0) {
        setAnimes(cached.animes);
        if (cached.studios && cached.studios.length > 0) setStudios(cached.studios);
        if (cached.genres && cached.genres.length > 0) setGenres(cached.genres);
        setLoading(false);
        const epThumbs = extractEpisodeThumbnails(cached.animes);
        startPrioritizedAppLoading(cached.animes, cached.studios || studios, epThumbs);
        // Instant background revalidation to guarantee latest changes are reflected immediately
        fetchData(true);
      } else {
        fetchData(false);
      }
    }).catch(() => {
      if (isMounted) {
        fetchData(false);
      }
    });

    // Refresh only when explicit mutations occur (like admin edits or manual trigger)
    const handleManualRefresh = () => {
      fetchData(true);
    };
    window.addEventListener('kh_refresh_catalog', handleManualRefresh);

    const handleInitialPath = () => {
      const path = window.location.pathname;
      if (path.startsWith('/anime/')) {
        const id = path.split('/').pop();
        if (id) {
          setSelectedAnimeId(id);
          setCurrentPage('detail');
        }
      } else if (path === '/admin') {
        setCurrentPage('admin');
      } else if (path === '/mi-lista') {
        setMyListTab('saved');
        setCurrentPage('my-list');
      } else if (path === '/vistos') {
        setMyListTab('watched');
        setCurrentPage('my-list');
      } else if (path.startsWith('/estudio/')) {
        const id = path.split('/')[2];
        const st = studios.find(s => s.id === id || s.name === decodeURIComponent(id));
        if (st) {
          setSelectedStudio(st);
          setCurrentPage('studio');
        } else {
          setCurrentPage('home');
        }
      } else {
        setCurrentPage('home');
      }
    };

    handleInitialPath();

    const handlePopState = () => {
      handleInitialPath();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('kh_refresh_catalog', handleManualRefresh);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);



  // Protection for /admin route: Only authenticated users with email kuzeofc@gmail.com can access
  useEffect(() => {
    if (currentPage === 'admin' && !authLoading) {
      const isAuthorizedAdmin = currentUser && currentUser.email?.toLowerCase().trim() === 'kuzeofc@gmail.com';
      if (!isAuthorizedAdmin) {
        setCurrentPage('home');
        window.history.replaceState(null, '', '/');
      }
    }
  }, [currentPage, currentUser, authLoading]);

  // Dynamic SEO Document Title update based on current page / selected anime
  useEffect(() => {
    if (currentPage === 'detail' && selectedAnimeId) {
      const anime = animes.find(a => a.id === selectedAnimeId);
      if (anime) {
        document.title = `${anime.name} - KuzeHentai | Anime Hentai Subtitulado en Español`;
      } else {
        document.title = `Anime Hentai - KuzeHentai`;
      }
    } else if (currentPage === 'admin') {
      document.title = `Panel Administrador - KuzeHentai`;
    } else if (currentPage === 'my-list') {
      document.title = `Mi Lista - KuzeHentai`;
    } else if (currentPage === 'watched') {
      document.title = `Animes Vistos - KuzeHentai`;
    } else if (currentPage === 'studio' && selectedStudio) {
      document.title = `${selectedStudio.name} - KuzeHentai | Catálogo del Estudio`;
    } else {
      document.title = `KuzeHentai - Catálogo Hentai Subtitulado en Español | Anime Hentai`;
    }
  }, [currentPage, selectedAnimeId, selectedStudio, animes]);

  // Scroll position & cover reference tracking for fluid gallery restoration
  const savedScrollPos = useRef<number>(0);
  const lastViewedAnimeId = useRef<string>('');

  // Lightweight, ultra-smooth and fast requestAnimationFrame scroll helper
  const smoothScrollTo = (targetY: number, duration = 220) => {
    const startY = window.scrollY || document.documentElement.scrollTop;
    const difference = targetY - startY;
    if (Math.abs(difference) < 4) {
      window.scrollTo(0, targetY);
      return;
    }

    const startTime = performance.now();
    // Ease-out expo curve for instant responsive movement and rapid arrival
    const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const step = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutExpo(progress);

      window.scrollTo(0, startY + difference * easedProgress);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        window.scrollTo(0, targetY);
      }
    };

    requestAnimationFrame(step);
  };

  // Custom router navigation function with smooth position restoration
  const navigateTo = (
    nextPage: PageType,
    animeId = '',
    episodeNum?: number,
    studio?: Studio | null,
    originPage?: PageType
  ) => {
    const prev = originPage !== undefined ? originPage : currentPage;
    setPreviousPage(prev);

    if (nextPage === 'admin') {
      const isAuthorizedAdmin = currentUser && currentUser.email?.toLowerCase().trim() === 'kuzeofc@gmail.com';
      if (!isAuthorizedAdmin) {
        setCurrentPage('home');
        window.history.replaceState(null, '', '/');
        return;
      }
    }

    if (nextPage === 'detail' || nextPage === 'my-list' || nextPage === 'watched' || nextPage === 'admin' || nextPage === 'studio') {
      setNavDirection(1);
    } else if (nextPage === 'home') {
      setNavDirection(-1);
    }

    if (studio !== undefined) {
      setSelectedStudio(studio);
    } else if (nextPage === 'home' || nextPage === 'my-list' || nextPage === 'watched') {
      setSelectedStudio(null);
    }

    // Save current scroll Y and anime ID when entering detail view
    if (nextPage === 'detail') {
      setIsDetailAnimating(true);
      if (prev !== 'detail') {
        savedScrollPos.current = window.scrollY || document.documentElement.scrollTop;
      }
      if (animeId) {
        lastViewedAnimeId.current = animeId;
      }
    } else if (nextPage === 'my-list') {
      setTimeout(() => {
        const savedAnimes = animes.filter(a => myListIds.includes(a.id));
        preloadAllAnimes(savedAnimes, studios);
      }, 300);
    } else if (nextPage === 'watched') {
      setTimeout(() => {
        const watchedAnimes = animes.filter(a => watchedIds.includes(a.id));
        preloadAllAnimes(watchedAnimes, studios);
      }, 300);
    } else if (prev === 'detail') {
      setIsDetailAnimating(true);
    }

    if (nextPage === 'watched') {
      setMyListTab('watched');
      setCurrentPage('my-list');
    } else if (nextPage === 'my-list') {
      if (prev !== 'my-list') {
        setMyListTab('saved');
      }
      setCurrentPage('my-list');
    } else {
      setCurrentPage(nextPage);
    }
    setSelectedAnimeId(animeId);
    setSelectedEpisodeNum(episodeNum);
    
    if (nextPage === 'detail' && animeId) {
      setTimeout(() => {
        recordHeroAnimeView(animeId);
      }, 500);
    }
    
    let path = '/';
    if (nextPage === 'detail') path = `/anime/${animeId}`;
    else if (nextPage === 'admin') path = '/admin';
    else if (nextPage === 'my-list') path = '/mi-lista';
    else if (nextPage === 'watched') path = '/vistos';
    else if (nextPage === 'studio') path = `/estudio/${studio?.id || selectedStudio?.id || ''}`;
    
    window.history.pushState(null, '', path);
    
    if (nextPage === 'admin' || nextPage === 'detail' || nextPage === 'studio' || nextPage === 'watched') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    } else if (nextPage === 'home') {
      try {
        const savedMode = localStorage.getItem('kh_display_mode');
        if (savedMode === 'sections' || savedMode === 'episodes' || savedMode === 'catalog') {
          setDisplayMode(savedMode as GalleryDisplayMode);
          if (savedMode === 'catalog') {
            const savedPage = localStorage.getItem('kh_catalog_page');
            const parsed = parseInt(savedPage || '1', 10);
            if (!isNaN(parsed) && parsed >= 1) {
              setPage(parsed);
            }
          }
        }
      } catch {}

      if (prev !== 'detail') {
        window.scrollTo(0, 0);
      }
    } else {
      window.scrollTo(0, 0);
    }
  };

  // Clear and toggle filter handlers
  const handleResetAllFilters = () => {
    setSearchQuery('');
    setCatalogSearchQuery('');
    setSelectedStudioId('');
    setSelectedGenreIds([]);
    setSelectedYear('');
    setSelectedStatus('');
    setSelectedRating('');
    setSortBy('name-asc');
  };

  const handleToggleGenre = (genreId: string) => {
    setGenreUsageMap(prev => ({
      ...prev,
      [genreId]: (prev[genreId] || 0) + 1
    }));
    if (selectedGenreIds.includes(genreId)) {
      setSelectedGenreIds(selectedGenreIds.filter(id => id !== genreId));
    } else {
      setSelectedGenreIds([...selectedGenreIds, genreId]);
    }
  };

  // Map for original array positions to ensure strict order-of-addition sorting
  const originalAnimeIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    animes.forEach((a, idx) => map.set(a.id, idx));
    return map;
  }, [animes]);

  // Fast Lookup Maps for memoized filtering & sorting
  const studioNameMap = useMemo(() => {
    const map = new Map<string, string>();
    studios.forEach(s => map.set(s.id, s.name));
    return map;
  }, [studios]);

  const genreNameMap = useMemo(() => {
    const map = new Map<string, string>();
    genres.forEach(g => map.set(g.id, g.name));
    return map;
  }, [genres]);

  // Pre-normalize text & tokens for all animes once so typing/deleting in search is 100% instant with 0ms lag
  const normalizedAnimeCache = useMemo<NormalizedAnimeData[]>(() => {
    return animes.map(anime => buildNormalizedAnimeData(anime, studioNameMap, genreNameMap));
  }, [animes, studioNameMap, genreNameMap]);

  // Deferred search query to keep typing in search input 100% smooth without thread locks
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // --- Optimized Filtering Logic ---
  const filteredAnimes = useMemo(() => {
    const trimmedQuery = deferredSearchQuery.trim();
    const normQuery = normalizeSearchText(trimmedQuery);
    const normQueryNoSpaces = normQuery.replace(/\s+/g, '');
    const queryTokens = normQuery.split(' ').filter(Boolean);

    return normalizedAnimeCache
      .filter(data => {
        const anime = data.anime;
        const sIds = (anime.studioIds && anime.studioIds.length > 0)
          ? anime.studioIds
          : (anime.studioId ? [anime.studioId] : []);
        // Los animes en 'Próximamente' no van a salir en el catálogo ni agregarse a listas públicas
        // hasta que el admin les cambie de etiqueta a Emisión o Finalizado
        if (isUpcomingStatus(anime.status) && selectedStatus !== 'Próximamente') {
          return false;
        }

        const matchesStudio = selectedStudioId === '' || sIds.includes(selectedStudioId);
        const matchesGenre = selectedGenreIds.length === 0 || 
          selectedGenreIds.every(gid => anime.genreIds?.includes(gid));
        const matchesYear = selectedYear === '' || (normalizeAnimeYear(anime.year) === selectedYear.trim());
        const matchesStatus = selectedStatus === '' || (() => {
          const s = (anime.status || 'Finalizado').toLowerCase();
          if (selectedStatus === 'Próximamente') {
            return isUpcomingStatus(anime.status);
          }
          if (selectedStatus === 'Emisión') {
            return isEmisionStatus(anime.status);
          }
          if (selectedStatus === 'Finalizado') {
            return s.includes('finaliz');
          }
          return s === selectedStatus.toLowerCase();
        })();

        const matchesRating = selectedRating === '' || (() => {
          const stats = getAnimeRatingStats(anime.id);
          if (selectedRating === '0') return stats.totalVotes === 0;
          if (selectedRating === '5') return Math.round(stats.average) === 5 || stats.average >= 4.5;
          if (selectedRating === '4') return Math.round(stats.average) === 4 || (stats.average >= 3.5 && stats.average < 4.5);
          if (selectedRating === '3') return Math.round(stats.average) === 3 || (stats.average >= 2.5 && stats.average < 3.5);
          if (selectedRating === '2') return Math.round(stats.average) === 2 || (stats.average >= 1.5 && stats.average < 2.5);
          if (selectedRating === '1') return Math.round(stats.average) === 1 || (stats.average >= 0.5 && stats.average < 1.5);
          return true;
        })();

        const matchesDisplayMode = true;

        if (!matchesStudio || !matchesGenre || !matchesYear || !matchesStatus || !matchesDisplayMode || !matchesRating) {
          return false;
        }

        if (!normQuery) return true;

        return matchesFuzzySearch(normQuery, normQueryNoSpaces, queryTokens, data);
      })
      .map(data => data.anime);
  }, [normalizedAnimeCache, deferredSearchQuery, selectedStudioId, selectedGenreIds, selectedYear, selectedStatus, selectedRating, displayMode]);

  // --- Reusable Sorting Logic for all Anime Lists (Catalog, Search, and Filtered Views) ---
  const applyAnimeSorting = useCallback((list: Anime[], sortType: string) => {
    return [...list].sort((a, b) => {
      if (sortType === 'rating-desc') {
        const statsA = getAnimeRatingStats(a.id);
        const statsB = getAnimeRatingStats(b.id);
        if (statsB.average !== statsA.average) return statsB.average - statsA.average;
        if (statsB.totalVotes !== statsA.totalVotes) return statsB.totalVotes - statsA.totalVotes;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      }
      if (sortType === 'rating-asc') {
        const statsA = getAnimeRatingStats(a.id);
        const statsB = getAnimeRatingStats(b.id);
        if (statsA.average !== statsB.average) return statsA.average - statsB.average;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      }
      if (sortType === 'name-asc') {
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      }
      if (sortType === 'name-desc') {
        return b.name.localeCompare(a.name, 'es', { sensitivity: 'base' });
      }
      if (sortType === 'year-desc') {
        const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
        const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
        if (yearA !== yearB) return yearB - yearA;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
        const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
        const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
        return idxB - idxA;
      }
      if (sortType === 'year-asc') {
        const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
        const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
        if (yearA !== yearB) return yearA - yearB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeA - timeB;
        const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
        const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
        return idxA - idxB;
      }

      // 'recientes': Según su año de lanzamiento más reciente (ej. 2026 antes que 2024),
      // y a igualdad de año, los más recientemente agregados (createdAt más nuevo primero)
      const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
      const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
      if (yearA !== yearB) {
        return yearB - yearA;
      }

      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA > 0 && timeB > 0 && timeA !== timeB) {
        return timeB - timeA;
      }
      if (timeA > 0 && timeB === 0) return -1;
      if (timeB > 0 && timeA === 0) return 1;

      const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
      const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
      return idxB - idxA;
    });
  }, [originalAnimeIndexMap]);

  // --- Optimized Sorting Logic ---
  const sortedAnimes = useMemo(() => {
    const trimmedQuery = deferredSearchQuery.trim();
    const normQuery = normalizeSearchText(trimmedQuery);

    if (normQuery) {
      const normQueryNoSpaces = normQuery.replace(/\s+/g, '');
      const queryTokens = normQuery.split(' ').filter(Boolean);
      const filteredAnimeSet = new Set(filteredAnimes);

      const filteredDataSet = normalizedAnimeCache.filter(data => filteredAnimeSet.has(data.anime));

      const scored = filteredDataSet.map(data => {
        const score = calculateRelevanceScore(normQuery, normQueryNoSpaces, queryTokens, data);
        return { anime: data.anime, score };
      });

      scored.sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return a.anime.name.localeCompare(b.anime.name, 'es', { sensitivity: 'base' });
      });

      return scored.map(s => s.anime);
    }

    if (displayMode === 'episodes') {
      const result = [...filteredAnimes];
      return result.sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        if (timeA !== timeB) return timeB - timeA;

        const epsA = a.episodes?.length || 0;
        const epsB = b.episodes?.length || 0;
        if (epsB !== epsA) return epsB - epsA;

        const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
        const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
        return idxB - idxA;
      });
    }

    return applyAnimeSorting(filteredAnimes, sortBy);
  }, [filteredAnimes, normalizedAnimeCache, deferredSearchQuery, sortBy, displayMode, originalAnimeIndexMap, applyAnimeSorting]);

  // --- Individual Episodes for "Nuevos episodios" (solo animes/episodios activados desde el panel de administración) ---
  const recentEpisodes = useMemo(() => {
    const items: {
      id: string;
      anime: Anime;
      episodeNumber: number;
      episodeTitle?: string;
      coverImage?: string;
      timestamp: number;
    }[] = [];

    // Recorre animes y filtra ÚNICAMENTE episodios activados explícitamente con isNew === true
    animes.forEach(anime => {
      if (anime.hidden) return;

      const eps = anime.episodes && anime.episodes.length > 0
        ? anime.episodes
        : [];

      // Filter episodes explicitly chosen with the toggle switch (isNew === true)
      const targetEps = eps.filter(ep => Boolean(ep.isNew));

      const baseTime = anime.createdAt
        ? new Date(anime.createdAt).getTime()
        : 0;

      targetEps.forEach(ep => {
        const epNum = Number(ep.number) || 1;
        // El timestamp toma addedToRecentAt si existe para respetar el orden exacto de agregación
        const epTimestamp = ep.addedToRecentAt
          ? new Date(ep.addedToRecentAt).getTime()
          : (baseTime + epNum * 1000);
        items.push({
          id: `${anime.id}-ep-${epNum}`,
          anime,
          episodeNumber: epNum,
          episodeTitle: ep.title || ep.name,
          coverImage: ep.thumbnail || ep.coverImage || anime.coverData || anime.image,
          timestamp: epTimestamp,
        });
      });
    });

    // Orden de agregación: el episodio agregado/activado más recientemente va de primero
    items.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return (b.episodeNumber || 0) - (a.episodeNumber || 0);
    });

    return items;
  }, [animes]);

  // --- Recomendaciones (personalizadas según los gustos de cada usuario y aisladas por cuenta) ---
  const recommendedAnimes = useMemo(() => {
    return getRecommendedAnimes(animes, myListIds, watchedIds, currentUser?.uid);
  }, [animes, myListIds, watchedIds, currentUser?.uid]);

  // --- Últimos Hentai: ordenados estrictamente por fecha (año y fecha de adición) tal como en el catálogo principal ---
  const latestCatalogAnimes = useMemo(() => {
    const visible = animes.filter(a => !a.hidden && !isUpcomingStatus(a.status));
    const sorted = [...visible].sort((a, b) => {
      // Orden estrictamente por año descendente
      const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
      const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
      if (yearA !== yearB) {
        return yearB - yearA;
      }
      // Luego por fecha de creación/adición
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA > 0 && timeB > 0 && timeA !== timeB) {
        return timeB - timeA;
      }
      const epsA = (a.episodes || []).length;
      const epsB = (b.episodes || []).length;
      if (epsB !== epsA) return epsB - epsA;
      return (originalAnimeIndexMap.get(b.id) ?? 0) - (originalAnimeIndexMap.get(a.id) ?? 0);
    });
    return sorted.slice(0, 20);
  }, [animes, originalAnimeIndexMap]);

  // --- Nombre del mes anterior en español dinámico y Populares del mes anterior (20 más populares) ---
  const { previousMonthName, previousMonthPopularAnimes } = useMemo(() => {
    const now = new Date();
    // Mes anterior: si estamos en enero (mes 0), el mes anterior es diciembre (mes 11) del año anterior
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    // Nombres en minúscula en español
    const monthNamesEs = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const prevMonthIndex = prevMonthDate.getMonth();
    const rawMonthName = monthNamesEs[prevMonthIndex] || 'el mes anterior';

    const visible = animes.filter(a => !a.hidden && !isUpcomingStatus(a.status));
    // Ordenar los 20 animes más populares: descargas acumuladas + actividad de vistas
    const sorted = [...visible].sort((a, b) => {
      const dlA = a.downloads || 0;
      const dlB = b.downloads || 0;
      if (dlB !== dlA) return dlB - dlA;
      const ratingA = getAnimeRatingStats(a.id).average;
      const ratingB = getAnimeRatingStats(b.id).average;
      if (ratingB !== ratingA) return ratingB - ratingA;
      return (b.episodes || []).length - (a.episodes || []).length;
    });

    return {
      previousMonthName: rawMonthName,
      previousMonthPopularAnimes: sorted.slice(0, 20),
    };
  }, [animes, ratingVersion]);

  // --- Próximamente: animes etiquetados como 'Próximamente' al crear/editar en admin ---
  const upcomingSectionAnimes = useMemo(() => {
    const visible = animes.filter(a => !a.hidden && isUpcomingStatus(a.status));
    const sorted = [...visible].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
    return sorted;
  }, [animes]);

  // --- Mi Lista: animes guardados por el usuario (solo si el usuario tiene animes agregados) ---
  const myListSectionAnimes = useMemo(() => {
    if (myListIds.length === 0) return [];
    const idSet = new Set(myListIds);
    const visible = animes.filter(a => idSet.has(a.id) && !a.hidden);
    const idOrder = new Map<string, number>();
    myListIds.forEach((id, index) => idOrder.set(id, index));
    return [...visible].sort((a, b) => {
      const idxA = idOrder.get(a.id) ?? 9999;
      const idxB = idOrder.get(b.id) ?? 9999;
      return idxA - idxB;
    });
  }, [animes, myListIds]);

  // --- Catálogo para sección horizontal (aplica filtros activos y ordenación seleccionada) ---
  const catalogSectionAnimes = useMemo(() => {
    const visible = animes.filter(anime => {
      if (anime.hidden) return false;
      if (selectedStatus === 'Próximamente') {
        if (!isUpcomingStatus(anime.status)) return false;
      } else if (isUpcomingStatus(anime.status)) {
        return false;
      }

      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      if (selectedStudioId && !sIds.includes(selectedStudioId)) return false;
      if (selectedGenreIds.length > 0 && !selectedGenreIds.every(gid => anime.genreIds?.includes(gid))) return false;
      if (selectedYear && normalizeAnimeYear(anime.year) !== selectedYear.trim()) return false;
      if (selectedStatus) {
        const s = (anime.status || 'Finalizado').toLowerCase();
        if (selectedStatus === 'Emisión' && !isEmisionStatus(anime.status)) return false;
        if (selectedStatus === 'Finalizado' && !s.includes('finaliz')) return false;
      }
      if (selectedRating) {
        const stats = getAnimeRatingStats(anime.id);
        if (selectedRating === '0' && stats.totalVotes !== 0) return false;
        if (selectedRating === '5' && !(Math.round(stats.average) === 5 || stats.average >= 4.5)) return false;
        if (selectedRating === '4' && !(Math.round(stats.average) === 4 || (stats.average >= 3.5 && stats.average < 4.5))) return false;
        if (selectedRating === '3' && !(Math.round(stats.average) === 3 || (stats.average >= 2.5 && stats.average < 3.5))) return false;
        if (selectedRating === '2' && !(Math.round(stats.average) === 2 || (stats.average >= 1.5 && stats.average < 2.5))) return false;
        if (selectedRating === '1' && !(Math.round(stats.average) === 1 || (stats.average >= 0.5 && stats.average < 1.5))) return false;
      }
      return true;
    });

    return applyAnimeSorting(visible, sortBy);
  }, [
    animes,
    selectedStudioId,
    selectedGenreIds,
    selectedYear,
    selectedStatus,
    selectedRating,
    sortBy,
    applyAnimeSorting
  ]);

  // --- Animes para la barra de búsqueda en la sección Catálogo de Inicio (mostrados en vertical con score de relevancia en tiempo real y ordenación) ---
  const catalogSearchSectionAnimes = useMemo(() => {
    const trimmed = deferredCatalogSearchQuery.trim();
    const normQuery = normalizeSearchText(trimmed);
    const normQueryNoSpaces = normQuery.replace(/\s+/g, '');
    const queryTokens = normQuery.split(' ').filter(Boolean);

    const visibleCache = normalizedAnimeCache.filter(data => {
      const anime = data.anime;
      if (anime.hidden) return false;
      if (selectedStatus === 'Próximamente') {
        if (!isUpcomingStatus(anime.status)) return false;
      } else if (isUpcomingStatus(anime.status)) {
        return false;
      }

      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      if (selectedStudioId && !sIds.includes(selectedStudioId)) return false;
      if (selectedGenreIds.length > 0 && !selectedGenreIds.every(gid => anime.genreIds?.includes(gid))) return false;
      if (selectedYear && normalizeAnimeYear(anime.year) !== selectedYear.trim()) return false;
      if (selectedStatus) {
        const s = (anime.status || 'Finalizado').toLowerCase();
        if (selectedStatus === 'Emisión' && !isEmisionStatus(anime.status)) return false;
        if (selectedStatus === 'Finalizado' && !s.includes('finaliz')) return false;
      }
      if (selectedRating) {
        const stats = getAnimeRatingStats(anime.id);
        if (selectedRating === '0' && stats.totalVotes !== 0) return false;
        if (selectedRating === '5' && !(Math.round(stats.average) === 5 || stats.average >= 4.5)) return false;
        if (selectedRating === '4' && !(Math.round(stats.average) === 4 || (stats.average >= 3.5 && stats.average < 4.5))) return false;
        if (selectedRating === '3' && !(Math.round(stats.average) === 3 || (stats.average >= 2.5 && stats.average < 3.5))) return false;
        if (selectedRating === '2' && !(Math.round(stats.average) === 2 || (stats.average >= 1.5 && stats.average < 2.5))) return false;
        if (selectedRating === '1' && !(Math.round(stats.average) === 1 || (stats.average >= 0.5 && stats.average < 1.5))) return false;
      }
      if (!normQuery) return true;
      return matchesFuzzySearch(normQuery, normQueryNoSpaces, queryTokens, data);
    });

    if (!normQuery) {
      return applyAnimeSorting(visibleCache.map(d => d.anime), sortBy);
    }

    const scored = visibleCache.map(data => ({
      anime: data.anime,
      score: calculateRelevanceScore(normQuery, normQueryNoSpaces, queryTokens, data)
    }));

    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return applyAnimeSorting([a.anime, b.anime], sortBy)[0] === a.anime ? -1 : 1;
    });

    return scored.map(s => s.anime);
  }, [
    normalizedAnimeCache,
    deferredCatalogSearchQuery,
    selectedStudioId,
    selectedGenreIds,
    selectedYear,
    selectedStatus,
    selectedRating,
    sortBy,
    applyAnimeSorting
  ]);

  const displayedCatalogSearchAnimes = useMemo(() => {
    return catalogSearchSectionAnimes.slice(0, catalogSearchVisibleCount);
  }, [catalogSearchSectionAnimes, catalogSearchVisibleCount]);

  useEffect(() => {
    setCatalogSearchVisibleCount(30);
  }, [deferredCatalogSearchQuery, selectedStudioId, selectedGenreIds, selectedYear, selectedStatus, selectedRating, sortBy]);

  const totalCatalogPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedAnimes.length / ITEMS_PER_PAGE));
  }, [sortedAnimes.length]);

  const handlePageChange = useCallback((newPage: number, isSwipe = false) => {
    if (newPage < 1 || newPage > totalCatalogPages || newPage === page) return;
    setPageDirection(newPage > page ? 1 : -1);
    setPage(newPage);
    try {
      localStorage.setItem('kh_catalog_page', String(newPage));
    } catch {}
    
    // Only adjust scroll if user has scrolled significantly past the grid top, and avoid jarring jumps during swipe
    if (!isSwipe) {
      const gridElem = document.getElementById('portadas-grid-top');
      if (gridElem) {
        const rect = gridElem.getBoundingClientRect();
        if (rect.top < -100) {
          const currentY = window.scrollY || document.documentElement.scrollTop;
          const targetY = Math.max(0, currentY + rect.top - 80);
          window.scrollTo({ top: targetY, left: 0, behavior: 'instant' as ScrollBehavior });
        }
      }
    }
  }, [page, totalCatalogPages]);

  // Gestos de deslizamiento ultra-fluidos (Fast Responsive Swipe Gestures)
  useEffect(() => {
    if ((currentPage !== 'home' && currentPage !== 'my-list' && currentPage !== 'watched') || isFilterModalOpen || isAuthModalOpen || isProfileModalOpen) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.closest('input') ||
          target.closest('textarea') ||
          target.closest('.no-swipe'))
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

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      const isHorizontal = absX > absY * 0.7;
      const isFastFlick = absX >= 18 && duration < 320;
      const isStandardSwipe = absX >= 24 && duration < 750;

      if (isHorizontal && (isFastFlick || isStandardSwipe)) {
        if (currentPage === 'my-list' || currentPage === 'watched') {
          if (deltaX < 0) {
            // Swipe Left -> switch from Mi Lista to Vistos
            if (myListTab === 'saved') {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              setMyListTab('watched');
              window.history.replaceState(null, '', '/vistos');
            }
          } else if (deltaX > 0) {
            // Swipe Right -> switch from Vistos to Mi Lista, or from Mi Lista to Galería
            if (myListTab === 'watched') {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              setMyListTab('saved');
              window.history.replaceState(null, '', '/mi-lista');
            } else {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              navigateTo('home');
            }
          }
          return;
        }

        if (deltaX < 0) {
          // Deslizamiento de DERECHA a IZQUIERDA (Swipe Left -> Siguiente)
          if (displayMode === 'episodes') {
            try {
              if (navigator.vibrate) navigator.vibrate(12);
            } catch {}
            handleToggleDisplayMode('catalog');
          } else if (displayMode === 'catalog') {
            if (page < totalCatalogPages) {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              handlePageChange(page + 1, true);
            }
          }
        } else if (deltaX > 0) {
          // Deslizamiento de IZQUIERDA a DERECHA (Swipe Right -> Anterior)
          if (displayMode === 'catalog') {
            if (page > 1) {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              handlePageChange(page - 1, true);
            } else {
              try {
                if (navigator.vibrate) navigator.vibrate(12);
              } catch {}
              handleToggleDisplayMode('episodes');
            }
          }
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    currentPage,
    displayMode,
    page,
    totalCatalogPages,
    isFilterModalOpen,
    isAuthModalOpen,
    isProfileModalOpen,
    handlePageChange
  ]);

  // Instant active-page & full-catalog preloader (warms browser memory & globalImageCache for zero-latency page switching)
  useEffect(() => {
    if (animes.length === 0) return;

    // 1. Preload the current visible page items immediately with top priority
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const currentPageItems = sortedAnimes.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    preloadAllAnimes(currentPageItems, studios);

    // 2. Preload adjacent pages (next and previous) so switching pages is instantaneous
    const nextPageItems = sortedAnimes.slice(startIndex + ITEMS_PER_PAGE, startIndex + (ITEMS_PER_PAGE * 2));
    if (nextPageItems.length > 0) {
      preloadAllAnimes(nextPageItems, studios);
    }
    if (page > 1) {
      const prevPageItems = sortedAnimes.slice(Math.max(0, startIndex - ITEMS_PER_PAGE), startIndex);
      preloadAllAnimes(prevPageItems, studios);
    }

    // 3. Preload all remaining items in background into memory store
    const timer = setTimeout(() => {
      preloadAllAnimes(animes, studios);
    }, 400);

    return () => clearTimeout(timer);
  }, [page, animes, sortedAnimes, studios]);

  // Instantly restore exact scroll position when returning to catalog view
  useEffect(() => {
    if (currentPage === 'home' || currentPage === 'my-list') {
      const targetPos = savedScrollPos.current;
      if (targetPos > 0) {
        const restore = () => {
          window.scrollTo({ top: targetPos, left: 0, behavior: 'instant' as ScrollBehavior });
        };
        // 1. Instant synchronous attempt
        restore();
        // 2. Next animation frame
        requestAnimationFrame(restore);
        // 3. Debounced layout passes to guarantee pixel accuracy
        const t1 = setTimeout(restore, 20);
        const t2 = setTimeout(restore, 80);
        const t3 = setTimeout(() => {
          restore();
          savedScrollPos.current = 0;
        }, 220);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      }
    }
  }, [currentPage]);

  // Ensure scroll is at 0,0 when entering admin view
  useEffect(() => {
    if (currentPage === 'admin') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [currentPage]);

  // Selected anime lookup memoized for maximum fluidity
  const currentAnime = useMemo(() => animes.find(a => a.id === selectedAnimeId), [animes, selectedAnimeId]);

  // --- Popularity Calculations for Studios, Genres and Top 3 Portadas ---
  const handleDownload = React.useCallback(async (animeId: string) => {
    if (!animeId) return;
    recordHeroAnimeView(animeId);
    // Optimistically update download count in local state for immediate UI sorting
    setAnimes(prev => prev.map(a => a.id === animeId ? { ...a, downloads: (a.downloads || 0) + 1 } : a));
    try {
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000;
      const raw = localStorage.getItem('kh_anime_views_24h');
      const list = raw ? JSON.parse(raw) : [];
      const filtered = Array.isArray(list) ? list.filter((item: any) => item && typeof item.timestamp === 'number' && item.timestamp > cutoff) : [];
      filtered.push({ animeId, timestamp: now });
      localStorage.setItem('kh_anime_views_24h', JSON.stringify(filtered.slice(-150)));
    } catch {}
    try {
      await fetch(`/api/animes/${animeId}/download`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      });
    } catch (err) {
      console.warn('Network sync for download count deferred:', err);
    }
  }, []);

  const sortedStudiosByPopularity = React.useMemo(() => {
    const visible = animes.filter(a => !a.hidden);
    const studioStats = new Map<string, { downloads: number; count: number }>();
    for (let i = 0; i < visible.length; i++) {
      const anime = visible[i];
      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      for (let j = 0; j < sIds.length; j++) {
        const sid = sIds[j];
        if (!sid) continue;
        const current = studioStats.get(sid) || { downloads: 0, count: 0 };
        current.downloads += (anime.downloads || 0);
        current.count += 1;
        studioStats.set(sid, current);
      }
    }

    return [...studios].sort((a, b) => {
      const statsA = studioStats.get(a.id) || { downloads: 0, count: 0 };
      const statsB = studioStats.get(b.id) || { downloads: 0, count: 0 };
      if (statsB.downloads !== statsA.downloads) return statsB.downloads - statsA.downloads;
      if (statsB.count !== statsA.count) return statsB.count - statsA.count;
      return a.name.localeCompare(b.name);
    });
  }, [studios, animes]);

  const sortedGenresByPopularity = React.useMemo(() => {
    const visible = animes.filter(a => !a.hidden);
    const genreStats = new Map<string, { downloads: number; count: number }>();
    for (let i = 0; i < visible.length; i++) {
      const anime = visible[i];
      if (!anime.genreIds) continue;
      for (let j = 0; j < anime.genreIds.length; j++) {
        const gid = anime.genreIds[j];
        const current = genreStats.get(gid) || { downloads: 0, count: 0 };
        current.downloads += (anime.downloads || 0);
        current.count += 1;
        genreStats.set(gid, current);
      }
    }

    return [...genres].sort((a, b) => {
      const statsA = genreStats.get(a.id) || { downloads: 0, count: 0 };
      const statsB = genreStats.get(b.id) || { downloads: 0, count: 0 };
      const dlA = statsA.downloads + (genreUsageMap[a.id] || 0) * 10;
      const dlB = statsB.downloads + (genreUsageMap[b.id] || 0) * 10;
      if (dlB !== dlA) return dlB - dlA;
      if (statsB.count !== statsA.count) return statsB.count - statsA.count;
      return a.name.localeCompare(b.name);
    });
  }, [genres, animes, genreUsageMap]);

  // --- Carrusel Hero estilo Crunchyroll (Ciclo de 24 horas: 3 Populares + 1 Mejor Calificado + 2 Nuevos Episodios) ---
  const heroFeaturedAnimes = React.useMemo(() => {
    return computeHeroFeaturedAnimes(animes);
  }, [animes, ratingVersion, heroCycleVersion]);

  // Render Section Selector helper
  const scrollToExplore = () => {
    const target = document.getElementById('explorar');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const hasActiveFilters = Boolean(
    selectedGenreIds.length > 0 ||
    selectedYear ||
    selectedStatus ||
    selectedRating ||
    selectedStudioId ||
    sortBy !== 'name-asc'
  );

  const isSearchOrFilterActive = Boolean(
    deferredSearchQuery.trim() ||
    hasActiveFilters
  );


  // --- PUBLIC HOME VIEW & TOP LEVEL PAGES ---
  return (
    <div className={`relative min-h-screen ${currentPage === 'detail' ? 'bg-[#08080a]' : 'bg-dark-bg'} text-white font-sans selection:bg-brand-red selection:text-white flex flex-col overflow-x-hidden border-0 outline-none`}>
      <AnimatePresence mode="wait" initial={false}>
        {currentPage === 'admin' ? (
          <motion.div
            key="admin"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-full min-h-screen overflow-x-hidden"
          >
            {authLoading ? (
              <div className="min-h-screen bg-[#12091c] flex flex-col items-center justify-center font-sans text-neutral-400 gap-3">
                <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                <span className="text-xs font-mono tracking-widest text-neutral-400">Verificando credenciales de administrador...</span>
              </div>
            ) : currentUser && currentUser.email?.toLowerCase().trim() === 'kuzeofc@gmail.com' ? (
              <React.Suspense fallback={
                <div className="min-h-screen bg-[#12091c] flex items-center justify-center font-sans text-neutral-400 text-sm">
                  Cargando panel de administración...
                </div>
              }>
                <AdminPanel
                  studios={sortedStudiosByPopularity}
                  genres={sortedGenresByPopularity}
                  animes={animes}
                  onRefresh={fetchData}
                  onBackToHome={() => navigateTo('home')}
                  currentUser={currentUser}
                />
              </React.Suspense>
            ) : null}
          </motion.div>
        ) : currentPage === 'studio' && selectedStudio ? (
          <motion.div
            key={`studio-${selectedStudio.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-full min-h-screen overflow-x-hidden"
          >
            <StudioDetailModal
              key={selectedStudio.id}
              studio={selectedStudio}
              initialPage={studioPageRef.current}
              initialScrollY={studioScrollRef.current}
              onClose={() => {
                studioPageRef.current = 1;
                studioScrollRef.current = 0;
                if (returnAnimeId) {
                  const targetAnime = returnAnimeId;
                  const origin = returnAnimeOriginPageRef.current || 'home';
                  setReturnAnimeId('');
                  setSelectedStudio(null);
                  navigateTo('detail', targetAnime, undefined, null, origin);
                } else if (previousPage === 'detail' && selectedAnimeId) {
                  const origin = returnAnimeOriginPageRef.current || 'home';
                  setSelectedStudio(null);
                  navigateTo('detail', selectedAnimeId, undefined, null, origin);
                } else {
                  setSelectedStudio(null);
                  navigateTo('home');
                }
              }}
              animes={animes}
              studios={studios}
              onSelectAnime={(animeId, page, scrollY) => {
                studioPageRef.current = page || 1;
                studioScrollRef.current = scrollY || 0;
                navigateTo('detail', animeId, undefined, selectedStudio, 'studio');
              }}
            />
          </motion.div>
        ) : currentPage === 'detail' && currentAnime ? (
          <motion.div
            key={`detail-${selectedAnimeId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onAnimationComplete={() => setIsDetailAnimating(false)}
            className="w-full min-h-screen overflow-x-hidden"
          >
            <AnimeDetail
              anime={currentAnime}
              initialEpisodeNum={selectedEpisodeNum}
              navDirection={navDirection}
              studios={studios}
              genres={genres}
              animes={animes}
              onBack={() => {
                if (previousPage === 'studio' && selectedStudio) {
                  navigateTo('studio', undefined, undefined, selectedStudio);
                } else if (previousPage === 'my-list') {
                  navigateTo('my-list');
                } else if (previousPage === 'watched') {
                  navigateTo('watched');
                } else {
                  navigateTo('home');
                }
              }}
              onDownload={handleDownload}
              isSaved={myListIds.includes(currentAnime.id)}
              onToggleMyList={handleToggleMyList}
              isWatched={watchedIds.includes(currentAnime.id)}
              onToggleWatched={handleToggleWatched}
              onSelectAnime={(animeId) => navigateTo('detail', animeId)}
              onSelectStudio={(studioId) => {
                const st = studios.find(s => s.id === studioId);
                if (st) {
                  setReturnAnimeId(currentAnime.id);
                  returnAnimeOriginPageRef.current = (previousPage === 'studio') ? 'home' : previousPage;
                  navigateTo('studio', undefined, undefined, st);
                } else {
                  setSelectedStudioId(studioId);
                  setSelectedGenreIds([]);
                  navigateTo('home');
                  setTimeout(() => {
                    document.getElementById('explorar')?.scrollIntoView({ behavior: 'smooth' });
                  }, 100);
                }
              }}
              onSelectGenre={(genreId) => {
                setSelectedStudioId('');
                setSelectedGenreIds([genreId]);
                navigateTo('home');
                setTimeout(() => {
                  document.getElementById('explorar')?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="home-shell-view"
            custom={navDirection}
            initial={(dir: number) => ({
              opacity: 0,
              x: dir >= 0 ? '100%' : '-100%'
            })}
            animate={{
              opacity: 1,
              x: 0
            }}
            exit={(dir: number) => ({
              opacity: 0,
              x: dir >= 0 ? '-100%' : '100%'
            })}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: 'transform, opacity' }}
            className="w-full min-h-screen flex flex-col"
          >
            {/* 1. Global Navigation Bar - Clean transparent overlay on Home, no intrusive sliding bar */}
            <nav className={`z-50 py-3 sm:py-4 px-3.5 sm:px-6 lg:px-8 border-none outline-none ${
              currentPage === 'home'
                ? 'absolute top-0 left-0 right-0 bg-transparent'
                : 'fixed top-0 left-0 right-0 bg-[#0e091b]/95 backdrop-blur-md shadow-lg shadow-black/60 border-b border-[#2b1747]/40'
            }`}>
              <div className="max-w-[1500px] 2xl:max-w-[1800px] 3xl:max-w-[2100px] mx-auto flex items-center justify-end">
                {/* Right Top Auth / User Button */}
                <div className="flex items-center gap-2 sm:gap-2.5">
                  {currentUser ? (
                    <div className="flex items-center gap-2 sm:gap-2.5">
                      {((currentUser.email?.toLowerCase() === 'kuzeofc@gmail.com') || (typeof window !== 'undefined' && localStorage.getItem('hk_admin_token'))) && (
                        <button
                          type="button"
                          onClick={() => navigateTo('admin')}
                          className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-[#1b102e]/85 hover:bg-[#2b1747] border border-purple-400/40 hover:border-purple-300 text-white shadow-lg backdrop-blur-md transition-all duration-300 active:scale-95 group cursor-pointer"
                          title="Panel de Administración"
                          aria-label="Panel de Administración"
                        >
                          <div className="flex flex-col gap-[3px] items-center justify-center w-4 pointer-events-none">
                            <div className="h-[2px] w-full bg-purple-200 rounded-xs group-hover:bg-white transition-colors shadow-xs" />
                            <div className="h-[2px] w-full bg-purple-200 rounded-xs group-hover:bg-white transition-colors shadow-xs" />
                            <div className="h-[2px] w-full bg-purple-200 rounded-xs group-hover:bg-white transition-colors shadow-xs" />
                          </div>
                        </button>
                      )}

                      {/* Google Profile Picture & Name (Clickable to open user window with custom name, Mi Lista & logout) */}
                      <button 
                        type="button"
                        onClick={() => setIsProfileModalOpen(true)}
                        className="flex items-center gap-2 rounded-full p-0.5 bg-black/40 hover:bg-black/60 border border-white/10 hover:border-purple-400/40 backdrop-blur-md transition-all duration-300 cursor-pointer active:scale-95 group focus:outline-none shadow-lg"
                        title="Toca para ver tu perfil, cambiar nombre, ver Mi Lista o cerrar sesión"
                      >
                        {currentUser.photoURL ? (
                          <img
                            src={currentUser.photoURL}
                            alt={currentUser.displayName || 'Foto de perfil'}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover shadow-sm shrink-0 ring-1 ring-white/20 group-hover:scale-105 transition-transform"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector('.kh-avatar-fallback') as HTMLElement | null;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className={`kh-avatar-fallback w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-purple-800 to-brand-red text-white font-bold text-sm shrink-0 items-center justify-center ring-1 ring-white/20 group-hover:scale-105 transition-transform ${currentUser.photoURL ? 'hidden' : 'flex'}`}
                        >
                          {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                        </div>
                        <span className="hidden sm:inline-block font-mono text-xs text-neutral-200 truncate max-w-[130px] font-medium group-hover:text-white transition-colors drop-shadow px-1">
                          {currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => setIsAuthModalOpen(true)}
                      className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-brand-red hover:from-purple-500 hover:to-brand-red/90 text-white rounded-full text-xs font-medium tracking-wide shadow-lg hover:shadow-purple-500/25 transition-all duration-300 flex items-center gap-1.5 cursor-pointer border border-white/20 backdrop-blur-md"
                      title="Iniciar sesión"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      <span>Iniciar Sesión</span>
                    </button>
                  )}
                </div>
              </div>
            </nav>

            {/* 3. Main Search & Explore Gallery Area */}
            <main id="explorar" className={`relative z-10 max-w-[1500px] 2xl:max-w-[1800px] 3xl:max-w-[2100px] mx-auto w-full px-1.5 sm:px-5 lg:px-7 ${
              currentPage === 'home' ? 'pt-0' : 'pt-[62px] sm:pt-[68px]'
            } pb-3 sm:pb-4 space-y-4 flex-grow`}>
              <AnimatePresence mode="popLayout" custom={navDirection} initial={false}>
                {currentPage === 'my-list' || currentPage === 'watched' ? (
                  <motion.div
                    key="my-list-view"
                    custom={navDirection}
                    initial={(dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? '100%' : '-100%'
                    })}
                    animate={{
                      opacity: 1,
                      x: 0
                    }}
                    exit={(dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? '-100%' : '100%'
                    })}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    style={{ willChange: 'transform, opacity' }}
                    className="space-y-5"
                  >
                    {/* Top Row: Back to Galería Button & Two-tab Selector (Mi Lista / Vistos) */}
                    <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={() => navigateTo('home')}
                        className="group inline-flex items-center gap-2 font-mono text-[10px] text-neutral-400 hover:text-white uppercase tracking-widest transition-colors duration-300 cursor-pointer select-none"
                      >
                        <ChevronLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
                        Galería
                      </button>

                      {/* Recuadro de Mi Lista y Vistos - con el MISMO diseño y tamaño que el de episodios y catálogo */}
                      <div className="inline-flex items-center gap-0.5 p-[2.5px] bg-[#090514] border border-[#2b1747] rounded-lg shadow-sm">
                        <button
                          type="button"
                          onClick={() => {
                            setMyListTab('saved');
                            window.history.replaceState(null, '', '/mi-lista');
                          }}
                          className={`px-2.5 py-1 rounded-[6px] font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
                            myListTab === 'saved'
                              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                          title="Mostrar animes guardados en Mi Lista"
                        >
                          <span>Mi Lista</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMyListTab('watched');
                            window.history.replaceState(null, '', '/vistos');
                          }}
                          className={`px-2.5 py-1 rounded-[6px] font-mono text-[9px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer select-none ${
                            myListTab === 'watched'
                              ? 'bg-gradient-to-r from-purple-700 to-purple-600 text-white shadow-sm border border-purple-400/40'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                          title="Mostrar animes marcados como vistos"
                        >
                          <span>Vistos</span>
                        </button>
                      </div>
                    </div>

                    {/* LADO 1: MI LISTA */}
                    {myListTab === 'saved' ? (
                      <div className="space-y-4">
                        {/* Header Title & Subtitle */}
                        <div className="space-y-1.5 pb-2">
                          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2">
                            <SignIcon className="h-6 w-6 text-brand-red shrink-0" />
                            <span>MI LISTA</span>
                            {myListIds.length > 0 && (
                              <span className="text-xs font-mono px-2.5 py-0.5 bg-brand-red/20 text-brand-red rounded-full border border-brand-red/30">
                                {myListIds.length}
                              </span>
                            )}
                          </h1>
                          <p className="font-mono text-xs text-neutral-400 max-w-2xl leading-relaxed">
                            Los elementos guardados se conservan durante 90 días.
                          </p>
                        </div>

                        {/* Grid of Saved Animes */}
                        {(() => {
                          const savedAnimes = animes.filter(a => myListIds.includes(a.id));
                          
                          if (savedAnimes.length === 0) {
                            return (
                              <div className="text-center py-16 px-4 bg-dark-card border border-dark-border rounded-2xl max-w-xl mx-auto my-8 space-y-3">
                                <div className="flex justify-center pb-1"><SignIcon className="h-10 w-10 text-brand-red/70" /></div>
                                <p className="font-sans text-neutral-300 text-sm leading-relaxed whitespace-pre-line">
                                  No has agregado ningún anime.{"\n\n"}
                                  Abre un anime y pulsa '<span className="text-brand-red font-semibold">Agregar a mi lista</span>' para guardarlo.
                                </p>
                                <div className="pt-2">
                                  <button
                                    onClick={() => navigateTo('home')}
                                    className="px-4 py-2 bg-brand-red hover:bg-[#ff3b75] text-white rounded-xl text-xs font-mono font-medium transition-colors cursor-pointer"
                                  >
                                    Explorar catálogo
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1">
                              {savedAnimes.map(anime => (
                                <GalleryCard
                                  key={anime.id}
                                  anime={anime}
                                  studios={studios}
                                  onClick={() => navigateTo('detail', anime.id)}
                                />
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      /* LADO 2: VISTOS */
                      <div className="space-y-4">
                        {/* Header Title & Subtitle */}
                        <div className="space-y-1.5 pb-2">
                          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight flex items-center gap-2">
                            <Eye className="h-6 w-6 text-emerald-400 shrink-0" />
                            <span>ANIMES VISTOS</span>
                            {watchedIds.length > 0 && (
                              <span className="text-xs font-mono px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                                {watchedIds.length}
                              </span>
                            )}
                          </h1>
                          <p className="font-mono text-xs text-neutral-400 max-w-2xl leading-relaxed">
                            Historial de animes que has marcado como vistos.
                          </p>
                        </div>

                        {/* Grid of Watched Animes */}
                        {(() => {
                          const watchedAnimes = animes.filter(a => watchedIds.includes(a.id));
                          
                          if (watchedAnimes.length === 0) {
                            return (
                              <div className="text-center py-16 px-4 bg-dark-card border border-dark-border rounded-2xl max-w-xl mx-auto my-8 space-y-3">
                                <div className="flex justify-center pb-1"><Eye className="h-10 w-10 text-emerald-400/70" /></div>
                                <p className="font-sans text-neutral-300 text-sm leading-relaxed whitespace-pre-line">
                                  No has marcado ningún anime como visto aún.{"\n\n"}
                                  Abre cualquier anime y pulsa '<span className="text-emerald-400 font-semibold">Visto</span>' para añadirlo a tu historial.
                                </p>
                                <div className="pt-2">
                                  <button
                                    onClick={() => navigateTo('home')}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-medium transition-colors cursor-pointer"
                                  >
                                    Explorar catálogo
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1">
                              {watchedAnimes.map(anime => (
                                <GalleryCard
                                  key={anime.id}
                                  anime={anime}
                                  studios={studios}
                                  onClick={() => navigateTo('detail', anime.id)}
                                />
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="gallery-home-view"
                    custom={navDirection}
                    initial={(dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? '100%' : '-100%',
                      scale: 0.98
                    })}
                    animate={{
                      opacity: 1,
                      x: 0,
                      scale: 1
                    }}
                    exit={(dir: number) => ({
                      opacity: 0,
                      x: dir >= 0 ? '-35%' : '100%',
                      scale: 0.98
                    })}
                    transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                    className="space-y-5"
                  >
        {/* Crunchyroll-Style Hero Banner Carousel for Más Populares - Extending to the top of the page */}
        <section aria-label="Animes Más Populares" className="no-swipe -mx-1.5 sm:-mx-5 lg:-mx-7 w-[calc(100%+0.75rem)] sm:w-[calc(100%+2.5rem)] lg:w-[calc(100%+3.5rem)]">
          <PopularHeroCarousel
            animes={heroFeaturedAnimes}
            studios={studios}
            genres={genres}
            onSelectAnime={(animeId) => navigateTo('detail', animeId)}
            savedAnimeIds={myListIds}
            onToggleMyList={handleToggleMyList}
            loading={loading}
          />
        </section>

        {/* Sections Stream (Crunchyroll-style horizontal rows) */}
        {loading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, sIdx) => (
              <div key={sIdx} className="space-y-3">
                <div className="h-6 w-44 bg-purple-900/30 rounded-lg animate-pulse" />
                <div className="flex gap-2 overflow-hidden">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="aspect-[2/3] w-32 shrink-0 bg-[#10091d] border border-purple-900/30 rounded-xl animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-7 sm:space-y-9 pt-1">
            {/* SECCIÓN 1: RECOMENDADOS (10 animes, sin los vistos) */}
            <HorizontalSectionRow
              title="Recomendados"
              icon={<Sparkles className="w-4 h-4 text-purple-400" />}
            >
              {recommendedAnimes.map((anime, idx) => (
                <div key={`rec-${anime.id}`} className="w-[115px] xs:w-[130px] sm:w-[145px] md:w-[160px] shrink-0">
                  <GalleryCard
                    anime={anime}
                    studios={studios}
                    index={idx}
                    onClick={() => navigateTo('detail', anime.id)}
                  />
                </div>
              ))}
            </HorizontalSectionRow>

            {/* SECCIÓN 2: NUEVOS EPISODIOS (solo animes/episodios activados desde el panel de administración) */}
            <HorizontalSectionRow
              title="Nuevos episodios"
              icon={<Film className="w-4 h-4 text-purple-400" />}
            >
              {recentEpisodes.length === 0 ? (
                <div className="py-4 px-3.5 text-xs font-mono text-neutral-400 w-full bg-[#120a1f]/60 rounded-xl border border-purple-900/30 flex items-center gap-2">
                  <Film className="w-4 h-4 text-purple-400/50 shrink-0" />
                  <span>No hay episodios activados. Actívalos desde el panel de administración.</span>
                </div>
              ) : (
                recentEpisodes.slice(0, 20).map((item) => (
                  <div key={item.id} className="w-[200px] xs:w-[230px] sm:w-[260px] md:w-[280px] shrink-0">
                    <div
                      onClick={() => navigateTo('detail', item.anime.id, item.episodeNumber)}
                      onMouseEnter={() => prefetchAnime(item.anime, studios)}
                      onPointerEnter={() => prefetchAnime(item.anime, studios)}
                      onTouchStart={() => prefetchAnime(item.anime, studios)}
                      className="group relative aspect-video w-full rounded-xl overflow-hidden cursor-pointer transition-all duration-200 shadow-md select-none active:scale-[0.98] hover:opacity-95 outline-none border border-purple-900/40"
                    >
                      {item.coverImage ? (
                        <img
                          src={item.coverImage}
                          alt={`${item.anime.name} - Ep ${item.episodeNumber}`}
                          loading="eager"
                          decoding="async"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = getFallbackSvg(item.anime.name);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full bg-[#150a24] flex items-center justify-center">
                          <Film className="h-6 w-6 text-purple-400/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 pointer-events-none" />
                      <div className="absolute top-1.5 left-1.5 h-4.5 min-w-[34px] px-1.5 rounded-full bg-black/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-sm z-10">
                        <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-white tracking-tight uppercase leading-none">
                          EP {item.episodeNumber}
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1.5 sm:p-2 pt-4 pointer-events-none">
                        <p className="font-display text-xs sm:text-[13px] text-white font-medium truncate group-hover:text-purple-300 transition-colors leading-tight">
                          {item.anime.name}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </HorizontalSectionRow>

            {/* SECCIÓN 3: ÚLTIMOS HENTAI (pantalla grande estilo más populares, la mitad de grande, solo título) */}
            <HorizontalSectionRow
              title="Últimos Hentai"
              icon={<Sparkles className="w-4 h-4 text-purple-400" />}
            >
              {latestCatalogAnimes.map((anime) => {
                const sIds = (anime.studioIds && anime.studioIds.length > 0)
                  ? anime.studioIds
                  : (anime.studioId ? [anime.studioId] : []);
                const studioName = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';

                return (
                  <div
                    key={`uh-${anime.id}`}
                    className="w-[260px] xs:w-[290px] sm:w-[340px] md:w-[380px] aspect-[16/9] shrink-0 relative rounded-2xl overflow-hidden bg-[#0a0515] border border-[#2b1747] hover:border-purple-500/70 shadow-lg shadow-black/70 group cursor-pointer active:scale-[0.98] transition-all select-none"
                    onClick={() => navigateTo('detail', anime.id)}
                    onMouseEnter={() => prefetchAnime(anime, studios)}
                    onPointerEnter={() => prefetchAnime(anime, studios)}
                    onTouchStart={() => prefetchAnime(anime, studios)}
                  >
                    <SmartAnimeCover
                      anime={anime}
                      studioName={studioName}
                      alt={anime.name}
                      loading="eager"
                      className="w-full h-full object-cover object-[center_25%] group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Solo difuminado suave abajo en el título */}
                    <div className="absolute inset-x-0 bottom-0 h-16 sm:h-20 bg-gradient-to-t from-[#090514]/95 via-[#090514]/70 to-transparent pointer-events-none" />

                    {/* Solo el título */}
                    <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 z-10 pointer-events-none">
                      <p className="font-display font-bold text-sm sm:text-base md:text-[17px] text-white tracking-tight leading-snug drop-shadow truncate group-hover:text-purple-300 transition-colors">
                        {anime.name}
                      </p>
                    </div>
                  </div>
                );
              })}
            </HorizontalSectionRow>

            {/* SECCIÓN 4: POPULARES DEL MES ANTERIOR (ej. "Populares de septiembre", "Populares de octubre", etc.) */}
            <HorizontalSectionRow
              title={`Populares de ${previousMonthName}`}
              icon={<Sparkles className="w-4 h-4 text-purple-400" />}
            >
              {previousMonthPopularAnimes.map((anime, idx) => (
                <div key={`prev-month-${anime.id}`} className="w-[115px] xs:w-[130px] sm:w-[145px] md:w-[160px] shrink-0">
                  <GalleryCard
                    anime={anime}
                    studios={studios}
                    index={idx}
                    onClick={() => navigateTo('detail', anime.id)}
                  />
                </div>
              ))}
            </HorizontalSectionRow>

            {/* SECCIÓN 5: PRÓXIMAMENTE (recuadro grande como Últimos Hentai, solo el nombre sin texto encima) */}
            {upcomingSectionAnimes.length > 0 && (
              <HorizontalSectionRow
                title="Próximamente"
                icon={<Sparkles className="w-4 h-4 text-purple-400" />}
              >
                {upcomingSectionAnimes.map((anime) => {
                  const sIds = (anime.studioIds && anime.studioIds.length > 0)
                    ? anime.studioIds
                    : (anime.studioId ? [anime.studioId] : []);
                  const studioName = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';

                  return (
                    <div
                      key={`up-${anime.id}`}
                      className="w-[260px] xs:w-[290px] sm:w-[340px] md:w-[380px] aspect-[16/9] shrink-0 relative rounded-2xl overflow-hidden bg-[#0a0515] border border-[#2b1747] hover:border-purple-500/70 shadow-lg shadow-black/70 group cursor-pointer active:scale-[0.98] transition-all select-none"
                      onClick={() => navigateTo('detail', anime.id)}
                      onMouseEnter={() => prefetchAnime(anime, studios)}
                      onPointerEnter={() => prefetchAnime(anime, studios)}
                      onTouchStart={() => prefetchAnime(anime, studios)}
                    >
                      <SmartAnimeCover
                        anime={anime}
                        studioName={studioName}
                        alt={anime.name}
                        loading="eager"
                        className="w-full h-full object-cover object-[center_25%] group-hover:scale-105 transition-transform duration-300"
                      />
                      {/* Solo difuminado suave abajo en el título */}
                      <div className="absolute inset-x-0 bottom-0 h-16 sm:h-20 bg-gradient-to-t from-[#090514]/95 via-[#090514]/70 to-transparent pointer-events-none" />

                      {/* Solo el nombre (sin ningún otro texto o etiqueta encima) */}
                      <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 z-10 pointer-events-none">
                        <p className="font-display font-bold text-sm sm:text-base md:text-[17px] text-white tracking-tight leading-snug drop-shadow truncate group-hover:text-purple-300 transition-colors">
                          {anime.name}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </HorizontalSectionRow>
            )}

            {/* SECCIÓN 6: MI LISTA (debajo de Próximamente; solo se muestra si hay animes guardados; si no hay, no se muestra ni el título ni nada) */}
            {myListSectionAnimes.length > 0 && (
              <HorizontalSectionRow
                title="Mi Lista"
                icon={<Bookmark className="w-4 h-4 text-purple-400" />}

              >
                {myListSectionAnimes.map((anime, idx) => (
                  <div key={`my-list-home-${anime.id}`} className="w-[115px] xs:w-[130px] sm:w-[145px] md:w-[160px] shrink-0">
                    <GalleryCard
                      anime={anime}
                      studios={studios}
                      index={idx}
                      onClick={() => navigateTo('detail', anime.id)}
                    />
                  </div>
                ))}
              </HorizontalSectionRow>
            )}

            {/* SECCIÓN 7: CATÁLOGO (al tocar la lupita se quita el título y se muestra la barra encima de los animes en vertical con filtrado dinámico) */}
            {!isCatalogSearchOpen ? (
              <HorizontalSectionRow
                title="Catálogo"
                icon={<Sparkles className="w-4 h-4 text-purple-400" />}
                rightAction={
                  <button
                    type="button"
                    onClick={() => {
                      setIsCatalogSearchOpen(true);
                      setCatalogSearchVisibleCount(30);
                      requestAnimationFrame(() => {
                        catalogSearchInputRef.current?.focus();
                      });
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border bg-[#150a26] border-[#2b1747] text-purple-300 hover:text-white hover:border-purple-500/60 text-xs font-mono transition-all duration-200 cursor-pointer active:scale-95"
                    title="Buscar en el catálogo"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium hidden xs:inline">Buscar</span>
                  </button>
                }
              >
                {catalogSectionAnimes.map((anime, idx) => (
                  <div key={`cat-${anime.id}`} className="w-[115px] xs:w-[130px] sm:w-[145px] md:w-[160px] shrink-0">
                    <GalleryCard
                      anime={anime}
                      studios={studios}
                      index={idx}
                      onClick={() => navigateTo('detail', anime.id)}
                    />
                  </div>
                ))}
              </HorizontalSectionRow>
            ) : (
              <div id="seccion-catalogo-search-container" className="space-y-4 pt-1 animate-in fade-in duration-200">
                {/* Barra de búsqueda directamente encima de los animes */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="relative flex-1">
                    <div className="relative bg-[#090514] border border-[#2b1747] hover:border-purple-600/50 focus-within:border-purple-500 rounded-2xl p-1.5 flex items-center transition-all duration-300 shadow-xl">
                      <Search className="h-5 w-5 text-purple-400 ml-2.5 sm:ml-3 shrink-0" />
                      <input
                        ref={catalogSearchInputRef}
                        type="text"
                        value={catalogSearchQuery}
                        onChange={(e) => setCatalogSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="Buscar en el catálogo..."
                        className="w-full bg-transparent px-2.5 sm:px-3 py-2 text-xs sm:text-sm text-white placeholder-white/70 outline-none font-sans"
                      />
                      {catalogSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setCatalogSearchQuery('');
                            catalogSearchInputRef.current?.focus();
                          }}
                          className="p-1.5 mr-1 text-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                          title="Limpiar búsqueda"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Botón Filtros */}
                  <button
                    type="button"
                    onClick={() => setIsFilterModalOpen(true)}
                    className="relative flex items-center justify-center gap-2 px-3.5 sm:px-5 py-3 bg-[#090514] hover:bg-[#120822] border border-[#2b1747] hover:border-purple-600/50 text-white rounded-2xl text-xs sm:text-sm font-medium shrink-0 transition-all duration-300 shadow-xl cursor-pointer"
                    title="Abrir panel de filtros"
                  >
                    <SlidersHorizontal className="h-4 w-4 text-purple-400" />
                    <span className="hidden xs:inline">Filtros</span>
                    {hasActiveFilters && (
                      <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse" />
                    )}
                  </button>

                  {/* Botón para cerrar la búsqueda y restaurar el título del catálogo */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsCatalogSearchOpen(false);
                      setCatalogSearchQuery('');
                    }}
                    className="p-3 bg-[#090514] hover:bg-[#120822] border border-[#2b1747] hover:border-purple-600/50 text-neutral-400 hover:text-white rounded-2xl text-xs font-medium shrink-0 transition-all duration-300 shadow-xl cursor-pointer"
                    title="Cerrar búsqueda y restaurar catálogo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Badges de filtros activos si están aplicados */}
                {hasActiveFilters && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest mr-1">Filtros:</span>
                    {sortBy !== 'name-asc' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 border border-purple-500/50 rounded-full text-[11px] text-purple-300 font-mono">
                        {sortBy === 'recientes' ? 'Más Recientes' :
                         sortBy === 'rating-desc' ? 'Mejor Calificados' :
                         sortBy === 'rating-asc' ? 'Menos Calificados' :
                         sortBy === 'name-desc' ? 'Nombre (Z - A)' :
                         sortBy === 'year-desc' ? 'Año reciente' :
                         sortBy === 'year-asc' ? 'Año antiguo' : sortBy}
                        <button onClick={() => setSortBy('name-asc')}><X className="h-3 w-3" /></button>
                      </span>
                    )}
                    {selectedRating && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-[11px] text-[#ff5588] font-mono">
                        {selectedRating === '0' ? 'Sin votos' : `${selectedRating}★`}
                        <button onClick={() => setSelectedRating('')}><X className="h-3 w-3" /></button>
                      </span>
                    )}
                    {selectedYear && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-[11px] text-[#ff5588] font-mono">
                        {selectedYear}
                        <button onClick={() => setSelectedYear('')}><X className="h-3 w-3" /></button>
                      </span>
                    )}
                    {selectedStatus && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-[11px] text-[#ff5588] font-mono">
                        {selectedStatus}
                        <button onClick={() => setSelectedStatus('')}><X className="h-3 w-3" /></button>
                      </span>
                    )}
                    {selectedStudioId && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 border border-purple-500/50 rounded-full text-[11px] text-purple-300 font-mono">
                        {studios.find(s => s.id === selectedStudioId)?.name || 'Estudio'}
                        <button onClick={() => setSelectedStudioId('')}><X className="h-3 w-3" /></button>
                      </span>
                    )}
                  </div>
                )}

                {/* Los animes del catálogo mostrados con el mismo estilo en vertical (grid vertical de pósters) */}
                {catalogSearchSectionAnimes.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-purple-900/40 rounded-2xl bg-[#120a1f]/60 max-w-md mx-auto p-6 space-y-2">
                    <AlertCircle className="h-7 w-7 text-purple-400/60 mx-auto" />
                    <p className="font-display font-medium text-sm text-white">No se encontraron animes en el catálogo</p>
                    <p className="font-sans text-xs text-neutral-400">Intenta con otro término de búsqueda o limpia los filtros.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1">
                      {displayedCatalogSearchAnimes.map((anime, idx) => (
                        <GalleryCard
                          key={`cat-search-${anime.id}`}
                          anime={anime}
                          studios={studios}
                          index={idx}
                          isNewEpisodesMode={false}
                          onClick={() => navigateTo('detail', anime.id)}
                        />
                      ))}
                    </div>
                    {catalogSearchSectionAnimes.length > catalogSearchVisibleCount && (
                      <div className="pt-4 pb-2 text-center">
                        <button
                          type="button"
                          onClick={() => setCatalogSearchVisibleCount(prev => prev + 30)}
                          className="px-6 py-2.5 rounded-xl border border-purple-500/40 bg-[#160a28] hover:bg-[#230f3f] text-purple-300 hover:text-white text-xs font-mono transition-all duration-200 shadow-lg cursor-pointer active:scale-95"
                        >
                          Cargar más animes ({catalogSearchSectionAnimes.length - catalogSearchVisibleCount} restantes)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Modal Sheet */}
      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        studios={sortedStudiosByPopularity}
        genres={sortedGenresByPopularity}
        animes={animes}
        selectedStudioId={selectedStudioId}
        selectedGenreIds={selectedGenreIds}
        selectedYear={selectedYear}
        selectedStatus={selectedStatus}
        selectedRating={selectedRating}
        sortBy={sortBy}
        onSelectStudio={setSelectedStudioId}
        onSelectGenreIds={setSelectedGenreIds}
        onSelectYear={setSelectedYear}
        onSelectStatus={setSelectedStatus}
        onSelectRating={setSelectedRating}
        onSelectSortBy={setSortBy}
        onResetFilters={handleResetAllFilters}
        onOpenStudio={(st) => {
          setIsFilterModalOpen(false);
          navigateTo('studio', undefined, undefined, st);
        }}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* User Profile Window / Modal */}
      <AnimatePresence>
        {isProfileModalOpen && (
          <UserProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            currentUser={currentUser}
            myListCount={myListIds.length}
            watchedCount={watchedIds.length}
            onOpenMyList={() => navigateTo('my-list')}
            onOpenWatched={() => navigateTo('watched')}
            onOpenReportModal={() => setIsReportModalOpen(true)}
            onLogout={handleLogout}
            onUserUpdated={handleUserUpdated}
          />
        )}
      </AnimatePresence>

      {/* Report Issue Chat Modal */}
      <ReportIssueModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        currentUser={currentUser}
      />
    </div>
  );
}
