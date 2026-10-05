/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react';
import { Studio, Genre, Anime, normalizeAnimeYear } from './types';
import { requestPersistentStorage, saveMyListToIDB, getMyListFromIDB, saveMyListAnimesToIDB } from './lib/idbStorage';
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

const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
import { SmartAnimeCover, processImageSrc, globalImageCache, preloadAllAnimes, preloadAnimeCover } from './utils/imageFallback';
import { normalizeEpisodesList } from './utils/episodeUtils';
import { getAnimeRatingStats } from './utils/ratingManager';
import { 
  Search, Film, Info, Plus, ChevronDown, Check, Send, AlertCircle, 
  MapPin, Heart, ExternalLink, ShieldCheck, Shield, Zap, Lock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  SlidersHorizontal, X, RotateCcw, Flame, Menu, UserCheck, LogIn, Palette, Moon, Sparkles, Eye
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

  // Persistent "Mi Lista" state (isolated by user account or guest session, auto-purges >90 days)
  const [myListIds, setMyListIds] = useState<string[]>(() => {
    try {
      const guestSaved = localStorage.getItem('hk_guest_my_list');
      if (guestSaved) {
        const rawIds: string[] = JSON.parse(guestSaved);
        if (Array.isArray(rawIds)) {
          const timestampMap: Record<string, number> = JSON.parse(localStorage.getItem('hk_guest_my_list_ts') || '{}');
          const now = Date.now();
          const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
          const validIds = rawIds.filter(id => {
            const ts = timestampMap[id];
            if (!ts) return true;
            return now - ts <= NINETY_DAYS_MS;
          });
          if (validIds.length !== rawIds.length) {
            try { localStorage.setItem('hk_guest_my_list', JSON.stringify(validIds)); } catch (e) {}
          }
          return validIds;
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  });

  // Persistent "Vistos" state (isolated by user account or guest session)
  const [watchedIds, setWatchedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('kh_guest_watched_list');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch (e) {
      return [];
    }
  });

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

  // Database lists state with persistent session & local cache for zero-latency instant rendering
  const [studios, setStudios] = useState<Studio[]>(() => {
    try {
      const sess = sessionStorage.getItem('hk_cached_studios');
      if (sess) return JSON.parse(sess);
      const saved = localStorage.getItem('hk_cached_studios');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  const [genres, setGenres] = useState<Genre[]>(() => {
    try {
      const sess = sessionStorage.getItem('hk_cached_genres');
      if (sess) return JSON.parse(sess);
      const saved = localStorage.getItem('hk_cached_genres');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  const [animes, setAnimes] = useState<Anime[]>(() => {
    try {
      const sess = sessionStorage.getItem('hk_cached_animes');
      if (sess) return JSON.parse(sess);
      const saved = localStorage.getItem('hk_cached_animes');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      const sess = sessionStorage.getItem('hk_cached_animes');
      if (sess && JSON.parse(sess).length > 0) return false;
      const saved = localStorage.getItem('hk_cached_animes');
      return saved ? JSON.parse(saved).length === 0 : true;
    } catch (e) { return true; }
  });

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
  const [sortBy, setSortBy] = useState<string>('recientes');
  const [displayMode, setDisplayMode] = useState<GalleryDisplayMode>(() => {
    try {
      const saved = localStorage.getItem('kh_display_mode');
      return (saved === 'episodes' || saved === 'catalog') ? (saved as GalleryDisplayMode) : 'episodes';
    } catch {
      return 'episodes';
    }
  });

  const [page, setPage] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('kh_catalog_page');
      const parsed = parseInt(saved || '1', 10);
      return !isNaN(parsed) && parsed >= 1 ? parsed : 1;
    } catch {
      return 1;
    }
  });

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


  const [isHeaderVisible, setIsHeaderVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY <= 15) {
        setIsHeaderVisible(true);
      } else {
        setIsHeaderVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
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

      // Try combined /api/bootstrap endpoint first for 3x faster initial load
      const bootstrapRes = await fetch('/api/bootstrap', { headers }).catch(() => null);
      if (bootstrapRes && bootstrapRes.ok) {
        const contentType = bootstrapRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await bootstrapRes.json();
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
              localStorage.setItem('hk_cached_studios', JSON.stringify(data.studios));
              localStorage.setItem('hk_cached_genres', JSON.stringify(data.genres));
              localStorage.setItem('hk_cached_animes', JSON.stringify(normalizedAnimes));
            } catch (e) {}
            // Eagerly prime all anime covers into memory cache
            preloadAllAnimes(normalizedAnimes, data.studios);
            return;
          }
        }
      }

      // Fallback to individual API requests if bootstrap is not available
      const [resStudios, resGenres, resAnimes] = await Promise.all([
        fetch('/api/studios').catch(() => null),
        fetch('/api/genres').catch(() => null),
        fetch('/api/animes', { headers }).catch(() => null)
      ]);

      let loadedStudios: Studio[] | null = null;
      let loadedGenres: Genre[] | null = null;
      let loadedAnimes: Anime[] | null = null;

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
        preloadAllAnimes(loadedAnimes, loadedStudios || studios);
      }
    } catch (err) {
      console.warn('Sync status:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sync state once on startup & persist without periodic polling (content stays until page reload)
  useEffect(() => {
    // Only fetch if we don't already have animes loaded in state
    if (animes.length === 0) {
      fetchData(false);
    } else {
      setLoading(false);
      // Prime memory cache with already loaded animes
      preloadAllAnimes(animes, studios);
    }

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
        setCurrentPage('my-list');
      } else if (path === '/vistos') {
        setCurrentPage('watched');
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
        const target = animes.find(a => a.id === animeId);
        if (target) {
          const sIds = (target.studioIds && target.studioIds.length > 0) ? target.studioIds : (target.studioId ? [target.studioId] : []);
          const sName = studios.find(s => sIds.includes(s.id))?.name || 'Estudio';
          preloadAnimeCover(target, sName);
        }
      }
    } else if (nextPage === 'my-list') {
      const savedAnimes = animes.filter(a => myListIds.includes(a.id));
      preloadAllAnimes(savedAnimes, studios);
    } else if (nextPage === 'watched') {
      const watchedAnimes = animes.filter(a => watchedIds.includes(a.id));
      preloadAllAnimes(watchedAnimes, studios);
    } else if (prev === 'detail') {
      setIsDetailAnimating(true);
    }

    setCurrentPage(nextPage);
    setSelectedAnimeId(animeId);
    setSelectedEpisodeNum(episodeNum);
    
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
        if (savedMode === 'episodes' || savedMode === 'catalog') {
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
    setSelectedStudioId('');
    setSelectedGenreIds([]);
    setSelectedYear('');
    setSelectedStatus('');
    setSelectedRating('');
    setSortBy('recientes');
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
        const matchesStudio = selectedStudioId === '' || sIds.includes(selectedStudioId);
        const matchesGenre = selectedGenreIds.length === 0 || 
          selectedGenreIds.every(gid => anime.genreIds?.includes(gid));
        const matchesYear = selectedYear === '' || (normalizeAnimeYear(anime.year) === selectedYear.trim());
        const matchesStatus = selectedStatus === '' || anime.status === selectedStatus;

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

        const matchesDisplayMode = displayMode === 'catalog' || anime.status === 'Emisión';

        if (!matchesStudio || !matchesGenre || !matchesYear || !matchesStatus || !matchesDisplayMode || !matchesRating) {
          return false;
        }

        if (!normQuery) return true;

        return matchesFuzzySearch(normQuery, normQueryNoSpaces, queryTokens, data);
      })
      .map(data => data.anime);
  }, [normalizedAnimeCache, deferredSearchQuery, selectedStudioId, selectedGenreIds, selectedYear, selectedStatus, selectedRating, displayMode]);

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
        return a.anime.name.localeCompare(b.anime.name);
      });

      return scored.map(s => s.anime);
    }

    const result = [...filteredAnimes];
    return result.sort((a, b) => {
      if (sortBy === 'rating-desc') {
        const ratingA = getAnimeRatingStats(a.id).average;
        const ratingB = getAnimeRatingStats(b.id).average;
        if (ratingB !== ratingA) return ratingB - ratingA;
      }
      if (sortBy === 'rating-asc') {
        const ratingA = getAnimeRatingStats(a.id).average;
        const ratingB = getAnimeRatingStats(b.id).average;
        if (ratingA !== ratingB) return ratingA - ratingB;
      }
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'name-desc') {
        return b.name.localeCompare(a.name);
      }
      if (sortBy === 'year-desc') {
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
      if (sortBy === 'year-asc') {
        const yearA = parseInt(normalizeAnimeYear(a.year) || '0', 10) || 0;
        const yearB = parseInt(normalizeAnimeYear(b.year) || '0', 10) || 0;
        if (yearA !== yearB) return yearA - yearB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
        const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
        const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
        return idxB - idxA;
      }

      if (displayMode === 'episodes') {
        // Priority 1: Latest update/activity timestamp (updatedAt > createdAt)
        // When episodes are added or anime is updated, updatedAt is set to that moment.
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        if (timeA !== timeB) return timeB - timeA;

        // Priority 2: Status 'Emisión'
        const isEmisionA = a.status === 'Emisión' ? 1 : 0;
        const isEmisionB = b.status === 'Emisión' ? 1 : 0;
        if (isEmisionB !== isEmisionA) return isEmisionB - isEmisionA;

        // Priority 3: Episodes count
        const epsA = a.episodes?.length || 0;
        const epsB = b.episodes?.length || 0;
        if (epsB !== epsA) return epsB - epsA;

        const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
        const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
        return idxB - idxA;
      }

      // Default sorting / 'recientes': Sort strictly by YEAR descending, then by ORDER OF ADDITION (newest added first)
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

      const idxA = originalAnimeIndexMap.get(a.id) ?? 0;
      const idxB = originalAnimeIndexMap.get(b.id) ?? 0;
      return idxB - idxA;
    });
  }, [filteredAnimes, normalizedAnimeCache, deferredSearchQuery, sortBy, displayMode, originalAnimeIndexMap]);

  // --- Individual Episodes for "Episodios" section (Covers for each episode, separated cards) ---
  const recentEpisodes = useMemo(() => {
    if (displayMode !== 'episodes') return [];

    const items: {
      id: string;
      anime: Anime;
      episodeNumber: number;
      episodeTitle?: string;
      coverImage?: string;
      timestamp: number;
    }[] = [];

    filteredAnimes.forEach(anime => {
      // Si el anime está finalizado, sus episodios nunca se muestran en la sección de Episodios
      if (anime.status === 'Finalizado') return;

      const eps = anime.episodes && anime.episodes.length > 0
        ? anime.episodes
        : (anime.telegramUrl ? [{ number: 1, mp4Url: anime.telegramUrl, isNew: false }] : []);

      // Filter episodes explicitly chosen with the toggle switch
      const explicitNewEps = eps.filter(ep => Boolean(ep.isNew));

      let targetEps = explicitNewEps;

      // If none explicitly marked, but anime is in Emisión and has legacy episodes without explicit flags, fallback to eps
      if (targetEps.length === 0 && anime.status === 'Emisión') {
        const hasAnyExplicitFlag = eps.some(ep => ep.isNew !== undefined);
        if (!hasAnyExplicitFlag) {
          targetEps = eps;
        }
      }

      if (targetEps.length === 0) return;

      const baseTime = anime.createdAt
        ? new Date(anime.createdAt).getTime()
        : (anime.updatedAt ? new Date(anime.updatedAt).getTime() : 0);

      targetEps.forEach(ep => {
        const epNum = Number(ep.number) || 1;
        // El timestamp toma addedToRecentAt si existe para respetar el orden exacto de llegada
        const epTimestamp = ep.addedToRecentAt
          ? new Date(ep.addedToRecentAt).getTime()
          : (baseTime + epNum * 1000);
        items.push({
          id: `${anime.id}-ep-${epNum}`,
          anime,
          episodeNumber: epNum,
          episodeTitle: ep.title || ep.name,
          coverImage: ep.coverImage,
          timestamp: epTimestamp,
        });
      });
    });

    // Sort newest first: mayor timestamp primero; si coincide, número de episodio mayor primero
    items.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return (b.episodeNumber || 0) - (a.episodeNumber || 0);
    });

    // Limit to 30 episodes
    return items.slice(0, 30);
  }, [filteredAnimes, displayMode]);

  const totalCatalogPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedAnimes.length / ITEMS_PER_PAGE));
  }, [sortedAnimes.length]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage < 1 || newPage > totalCatalogPages || newPage === page) return;
    setPageDirection(newPage > page ? 1 : -1);
    setPage(newPage);
    try {
      localStorage.setItem('kh_catalog_page', String(newPage));
    } catch {}
    const gridElem = document.getElementById('portadas-grid-top');
    if (gridElem) {
      const rect = gridElem.getBoundingClientRect();
      const currentY = window.scrollY || document.documentElement.scrollTop;
      const targetY = Math.max(0, currentY + rect.top - 80);
      window.scrollTo({ top: targetY, left: 0, behavior: 'instant' as ScrollBehavior });
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [page, totalCatalogPages]);

  // Gestos de deslizamiento (Swipe):
  // 1. En 'Episodios': deslizar de DERECHA a IZQUIERDA pasa al Catálogo.
  // 2. En 'Catálogo':
  //    - Deslizar de DERECHA a IZQUIERDA avanza a la página siguiente del catálogo.
  //    - Deslizar de IZQUIERDA a DERECHA:
  //      * Si página > 1: retrocede a la página anterior del catálogo.
  //      * Si página === 1: vuelve al apartado de Episodios.
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
          target.closest('button.cursor-pointer') ||
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

      // Movimiento horizontal predominante (evita interferir con scroll vertical)
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && duration < 750) {
        if (currentPage === 'my-list' || currentPage === 'watched') {
          if (deltaX > 45) {
            try {
              if (navigator.vibrate) navigator.vibrate(20);
            } catch {}
            navigateTo('home');
          }
          return;
        }

        if (deltaX < -45) {
          // Deslizamiento de DERECHA a IZQUIERDA (Swipe Left)
          if (displayMode === 'episodes') {
            try {
              if (navigator.vibrate) navigator.vibrate(20);
            } catch {}
            handleToggleDisplayMode('catalog');
          } else if (displayMode === 'catalog') {
            if (page < totalCatalogPages) {
              try {
                if (navigator.vibrate) navigator.vibrate(20);
              } catch {}
              handlePageChange(page + 1);
            }
          }
        } else if (deltaX > 45) {
          // Deslizamiento de IZQUIERDA a DERECHA (Swipe Right)
          if (displayMode === 'catalog') {
            if (page > 1) {
              try {
                if (navigator.vibrate) navigator.vibrate(20);
              } catch {}
              handlePageChange(page - 1);
            } else {
              try {
                if (navigator.vibrate) navigator.vibrate(20);
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
      if (savedScrollPos.current > 0) {
        window.scrollTo({ top: savedScrollPos.current, left: 0, behavior: 'instant' as ScrollBehavior });
        savedScrollPos.current = 0;
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

  // Selected anime lookup
  const currentAnime = animes.find(a => a.id === selectedAnimeId);

  // --- Popularity Calculations for Studios, Genres and Top 3 Portadas ---
  const handleDownload = React.useCallback(async (animeId: string) => {
    if (!animeId) return;
    // Optimistically update download count in local state for immediate UI sorting
    setAnimes(prev => prev.map(a => a.id === animeId ? { ...a, downloads: (a.downloads || 0) + 1 } : a));
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

  const top3Animes = React.useMemo(() => {
    const visibleAnimes = animes.filter(a => !a.hidden);
    if (visibleAnimes.length === 0) return [];

    const studioDownloadsMap: Record<string, number> = {};
    const studioCountMap: Record<string, number> = {};
    const genreDownloadsMap: Record<string, number> = {};
    const genreCountMap: Record<string, number> = {};

    for (let i = 0; i < visibleAnimes.length; i++) {
      const anime = visibleAnimes[i];
      const dl = anime.downloads || 0;
      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      for (let j = 0; j < sIds.length; j++) {
        const sid = sIds[j];
        if (sid) {
          studioDownloadsMap[sid] = (studioDownloadsMap[sid] || 0) + dl;
          studioCountMap[sid] = (studioCountMap[sid] || 0) + 1;
        }
      }
      if (anime.genreIds) {
        for (let j = 0; j < anime.genreIds.length; j++) {
          const gid = anime.genreIds[j];
          genreDownloadsMap[gid] = (genreDownloadsMap[gid] || 0) + dl;
          genreCountMap[gid] = (genreCountMap[gid] || 0) + 1;
        }
      }
    }

    for (let i = 0; i < genres.length; i++) {
      const g = genres[i];
      if (genreUsageMap[g.id]) {
        genreDownloadsMap[g.id] = (genreDownloadsMap[g.id] || 0) + (genreUsageMap[g.id] || 0) * 10;
      }
    }

    const scored = visibleAnimes.map((anime, idx) => {
      const dlScore = (anime.downloads || 0) * 100000;
      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      const sScore = sIds.reduce((acc, sid) => acc + (studioDownloadsMap[sid] || 0) * 100 + (studioCountMap[sid] || 0) * 10, 0);
      const gScore = (anime.genreIds || []).reduce((acc, gid) => acc + (genreDownloadsMap[gid] || 0) + (genreCountMap[gid] || 0), 0);
      const totalScore = dlScore + sScore + gScore;
      return { anime, totalScore, originalIndex: idx };
    });

    const popularOnly = scored.filter(item => (item.anime.downloads || 0) > 0);
    popularOnly.sort((a, b) => {
      if ((b.anime.downloads || 0) !== (a.anime.downloads || 0)) {
        return (b.anime.downloads || 0) - (a.anime.downloads || 0);
      }
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.originalIndex - b.originalIndex;
    });

    return popularOnly.slice(0, 3).map(item => item.anime);
  }, [animes, studios, genres, genreUsageMap]);

  // Render Section Selector helper
  const scrollToExplore = () => {
    const target = document.getElementById('explorar');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };


  // --- PUBLIC HOME VIEW & TOP LEVEL PAGES ---
  return (
    <div className={`relative min-h-screen ${currentPage === 'detail' ? 'bg-[#08080a]' : 'bg-dark-bg'} text-white font-sans selection:bg-brand-red selection:text-white flex flex-col overflow-x-hidden border-0 outline-none`}>
      <AnimatePresence mode="popLayout" custom={navDirection} initial={false}>
        {currentPage === 'admin' ? (
          <motion.div
            key="admin"
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
            {/* 1. Global Navigation Bar - Compact Dark Violet & Black */}
            <nav className={`fixed top-0 left-0 right-0 z-50 bg-[#0e091b]/95 backdrop-blur-md py-2.5 sm:py-3 px-4 sm:px-6 lg:px-8 border-none outline-none transition-transform duration-200 ease-out ${
              isHeaderVisible ? 'translate-y-0' : '-translate-y-full'
            }`}>
              <div className="max-w-[1500px] 2xl:max-w-[1800px] 3xl:max-w-[2100px] mx-auto flex items-center justify-between">
                {/* Logo Brand */}
                <div 
                  onClick={() => {
                    // Recargar la página al presionar el título KuzeHentai
                    window.location.reload();
                  }}
                  className="group flex items-center cursor-pointer select-none active:scale-95 transition-transform"
                  title="Recargar página KuzeHentai"
                >
                  <span className="font-display font-black text-xl tracking-widest text-white transition-colors duration-300 group-hover:text-brand-red">
                    KuzeHentai
                  </span>
                </div>

                {/* Desktop Navigation Links */}
                <div className="hidden md:flex items-center gap-8 font-mono text-[10px] tracking-widest uppercase text-neutral-400">
                  <a href="#acerca" className="hover:text-white transition-colors duration-300">Acerca de</a>
                  <a href="https://t.me/kuzehenta" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors duration-300">Colecciones</a>
                  <a href="https://t.me/kuzehenta" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors duration-300">Contacto</a>
                </div>

                {/* Right Top Auth / User Button */}
                <div className="flex items-center gap-2">
                  {currentUser ? (
                    <div className="flex items-center gap-2">
                      {currentUser.email?.toLowerCase() === 'kuzeofc@gmail.com' && (
                        <button
                          type="button"
                          onClick={() => navigateTo('admin')}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#201733] border border-[#372854] text-white shadow-md transition-all duration-300 hover:border-purple-500/60 active:scale-95 group cursor-pointer"
                          title="Panel de Administración"
                          aria-label="Panel de Administración"
                        >
                          <div className="flex flex-col gap-[3px] items-center justify-center w-4 pointer-events-none">
                            <div className="h-[2px] w-full bg-[#a3a3b2] rounded-xs group-hover:bg-white transition-colors" />
                            <div className="h-[2px] w-full bg-[#a3a3b2] rounded-xs group-hover:bg-white transition-colors" />
                            <div className="h-[2px] w-full bg-[#a3a3b2] rounded-xs group-hover:bg-white transition-colors" />
                          </div>
                        </button>
                      )}

                      {/* Google Profile Picture & Name (Clickable to open user window with custom name, Mi Lista & logout) */}
                      <button 
                        type="button"
                        onClick={() => setIsProfileModalOpen(true)}
                        className="flex items-center gap-2 rounded-full transition-all duration-300 cursor-pointer active:scale-95 group focus:outline-none"
                        title="Toca para ver tu perfil, cambiar nombre, ver Mi Lista o cerrar sesión"
                      >
                        {currentUser.photoURL ? (
                          <img
                            src={currentUser.photoURL}
                            alt={currentUser.displayName || 'Foto de perfil'}
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover shadow-sm shrink-0 group-hover:scale-105 transition-transform"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector('.kh-avatar-fallback') as HTMLElement | null;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className={`kh-avatar-fallback w-10 h-10 rounded-full bg-gradient-to-tr from-purple-800 to-brand-red text-white font-bold text-sm shrink-0 items-center justify-center group-hover:scale-105 transition-transform ${currentUser.photoURL ? 'hidden' : 'flex'}`}
                        >
                          {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                        </div>
                        <span className="hidden sm:inline-block font-mono text-xs text-neutral-200 truncate max-w-[130px] font-medium group-hover:text-white transition-colors">
                          {currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => setIsAuthModalOpen(true)}
                      className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-brand-red hover:from-purple-500 hover:to-brand-red/90 text-white rounded-full text-xs font-medium tracking-wide shadow-md hover:shadow-purple-500/25 transition-all duration-300 flex items-center gap-1.5 cursor-pointer border border-white/10"
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
            <main id="explorar" className="relative z-10 max-w-[1500px] 2xl:max-w-[1800px] 3xl:max-w-[2100px] mx-auto w-full px-1.5 sm:px-5 lg:px-7 pt-24 pb-3 sm:pb-4 space-y-4 flex-grow">
              <AnimatePresence mode="popLayout" custom={navDirection} initial={false}>
                {currentPage === 'my-list' ? (
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
                    className="space-y-6"
                  >
                    {/* Back Button */}
                    <button
                      onClick={() => navigateTo('home')}
                      className="group inline-flex items-center gap-2 font-mono text-[10px] text-neutral-400 hover:text-brand-red uppercase tracking-widest transition-colors duration-300 cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
                      Galería
                    </button>

                    {/* Header Title & Subtitle */}
                    <div className="space-y-2 pb-4">
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
                  </motion.div>
                ) : currentPage === 'watched' ? (
                  <motion.div
                    key="watched-view"
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
                    className="space-y-6"
                  >
                    {/* Back Button */}
                    <button
                      onClick={() => navigateTo('home')}
                      className="group inline-flex items-center gap-2 font-mono text-[10px] text-neutral-400 hover:text-emerald-400 uppercase tracking-widest transition-colors duration-300 cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
                      Galería
                    </button>

                    {/* Header Title & Subtitle */}
                    <div className="space-y-2 pb-4">
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
        {/* Compact Top 3 Portadas Más Populares Section (Positioned above search bar) */}
        <div className="space-y-2">
          <div className="flex items-center">
            <h2 className="flex items-center gap-1.5 font-mono text-[10px] text-[#ff5588] uppercase tracking-widest font-bold">
              <Flame className="h-3.5 w-3.5" />
              <span>Más Populares</span>
            </h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-3 gap-0.5 sm:gap-1 max-w-2xl">
              {[1, 2, 3].map((i) => (
                <div key={i} className="aspect-[2/3] bg-[#15121e] border border-[#272236] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : top3Animes.length > 0 ? (
            <div className="grid grid-cols-3 gap-0.5 sm:gap-1 max-w-2xl">
              {top3Animes.map((anime) => {
                const sIds = (anime.studioIds && anime.studioIds.length > 0)
                  ? anime.studioIds
                  : (anime.studioId ? [anime.studioId] : []);
                const studioName = studios.find(s => sIds.includes(s.id))?.name || 'Sin estudio';
                return (
                  <div
                    key={anime.id}
                    onClick={() => navigateTo('detail', anime.id)}
                    title={anime.name}
                    className="group relative aspect-[2/3] bg-neutral-900 rounded-xl overflow-hidden border border-[#272236] hover:border-[#ff5588]/70 shadow-md hover:shadow-lg hover:shadow-[#ff5588]/15 cursor-pointer block p-0 text-left touch-manipulation select-none active:scale-[0.96] hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <SmartAnimeCover
                      anime={anime}
                      studioName={studioName}
                      alt={anime.name}
                      loading="eager"
                      priority={true}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {/* Subtle title overlay at bottom */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1.5 sm:p-2 pt-4 pointer-events-none">
                      <p className="font-display text-xs sm:text-[13px] text-white font-medium truncate group-hover:text-[#ff5588] transition-colors leading-tight">
                        {anime.name}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Real-time Search Input Bar with Separate "Filtros" Bubble */}
        <div className="space-y-3">
          <div className="max-w-2xl flex items-center gap-2 sm:gap-3">
            {/* Search box bubble with Autocomplete (matching community support bubble palette) */}
            <div className="relative flex-1">
              <div className="relative bg-[#090514] border border-[#2b1747] hover:border-purple-600/50 focus-within:border-purple-500 rounded-2xl p-1.5 flex items-center transition-all duration-300 shadow-xl">
                <Search 
                  className="h-5 w-5 text-white ml-2.5 sm:ml-3 shrink-0 cursor-pointer hover:text-white/80 transition-colors" 
                  onClick={() => {
                    const target = document.getElementById('resultados-busqueda-anchor') || document.getElementById('portadas-grid-top');
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  title="Buscar y ver resultados"
                />

                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                      const target = document.getElementById('resultados-busqueda-anchor') || document.getElementById('portadas-grid-top');
                      if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }
                  }}
                  placeholder="Buscar hentai..."
                  className="w-full bg-transparent px-2.5 sm:px-3 py-2 text-xs sm:text-sm text-white placeholder-white/70 outline-none font-sans"
                />

                {searchQuery && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSearchQuery('');
                      setPage(1);
                      if (searchInputRef.current) {
                        searchInputRef.current.focus();
                      }
                    }}
                    className="p-1.5 mr-1 text-white/70 hover:text-white transition-colors cursor-pointer shrink-0"
                    title="Limpiar texto"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Separate "Filtros" Bubble (matching community support bubble palette) */}
            <button
              type="button"
              onClick={() => setIsFilterModalOpen(true)}
              className="relative flex items-center justify-center gap-2 px-4 sm:px-5 py-3 bg-[#090514] hover:bg-[#120822] border border-[#2b1747] hover:border-purple-600/50 text-white rounded-2xl text-xs sm:text-sm font-medium shrink-0 transition-all duration-300 shadow-xl cursor-pointer"
              title="Abrir panel de filtros"
            >
              <SlidersHorizontal className="h-4 w-4 text-[#ff5588] shrink-0" />
              <span>Filtros</span>
              {(selectedGenreIds.length > 0 || selectedYear || selectedStatus || selectedRating || selectedStudioId) && (
                <span className="w-2 h-2 rounded-full bg-[#ff5588] animate-pulse shrink-0" />
              )}
            </button>
          </div>

          {/* Anchor for smooth auto-scrolling on Enter press */}
          <div id="resultados-busqueda-anchor" className="scroll-mt-24" />

          {/* Active Filter Badges Display */}
          {(selectedGenreIds.length > 0 || selectedYear || selectedStatus || selectedRating || selectedStudioId) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-mono text-neutral-500 uppercase tracking-widest mr-1">Filtros activos:</span>
              
              {selectedRating && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-xs text-[#ff5588] font-mono">
                  Calificación: {selectedRating === '0' ? 'Sin votos' : `${selectedRating}★`}
                  <button onClick={() => setSelectedRating('')} className="hover:text-white"><X className="h-3 w-3" /></button>
                </span>
              )}

              {selectedYear && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-xs text-[#ff5588] font-mono">
                  Año: {selectedYear}
                  <button onClick={() => setSelectedYear('')} className="hover:text-white"><X className="h-3 w-3" /></button>
                </span>
              )}

              {selectedStatus && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-xs text-[#ff5588] font-mono">
                  Estado: {selectedStatus}
                  <button onClick={() => setSelectedStatus('')} className="hover:text-white"><X className="h-3 w-3" /></button>
                </span>
              )}

              {selectedStudioId && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-xs text-[#ff5588] font-mono">
                  Estudio: {studios.find(s => s.id === selectedStudioId)?.name}
                  <button onClick={() => setSelectedStudioId('')} className="hover:text-white"><X className="h-3 w-3" /></button>
                </span>
              )}

              {selectedGenreIds.map(gid => {
                const gName = genres.find(g => g.id === gid)?.name;
                return (
                  <span key={gid} className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#ff5588]/15 border border-[#ff5588]/40 rounded-full text-xs text-[#ff5588] font-mono">
                    Género: {gName}
                    <button onClick={() => handleToggleGenre(gid)} className="hover:text-white"><X className="h-3 w-3" /></button>
                  </span>
                );
              })}

              <button
                type="button"
                onClick={handleResetAllFilters}
                className="text-[11px] font-mono text-neutral-400 hover:text-[#ff5588] underline ml-2"
              >
                Borrar todos
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Studio Pill Filters (Sorted by popularity) */}
        <GalleryFilter
          studios={sortedStudiosByPopularity}
          animes={animes}
          selectedStudioId={selectedStudioId}
          onSelectStudio={setSelectedStudioId}
          isStudiosOpen={isStudiosExpanded}
          onToggleStudiosOpen={handleToggleStudiosExpanded}
          displayMode={displayMode}
          onToggleDisplayMode={handleToggleDisplayMode}
        />

        {/* 4. Elegant Minimalist Gallery Cards Grid */}
        {loading ? (
          displayMode === 'episodes' ? (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3.5 md:gap-4">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="aspect-[16/10] bg-[#10091d] border border-purple-900/30 rounded-xl animate-pulse flex items-center justify-center">
                  <span className="font-mono text-[9px] text-neutral-600 tracking-widest">CARGANDO</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1">
              {[...Array(ITEMS_PER_PAGE)].map((_, i) => (
                <div key={i} className="aspect-[2/3] bg-dark-card border border-[#272236] rounded-xl animate-pulse flex items-center justify-center">
                  <span className="font-mono text-[8px] text-neutral-700 tracking-widest">LOADING</span>
                </div>
              ))}
            </div>
          )
        ) : displayMode === 'episodes' ? (
          recentEpisodes.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-purple-900/40 rounded-2xl bg-[#120a1f]/60 max-w-md mx-auto p-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-purple-950/60 border border-purple-800/40 flex items-center justify-center mx-auto text-purple-400">
                <Film className="h-6 w-6" />
              </div>
              <h3 className="font-display font-medium text-base text-white">No hay episodios nuevos</h3>
              <p className="font-sans text-xs text-neutral-400 max-w-xs mx-auto leading-relaxed">
                Todos los animes agregados actualmente están finalizados y se encuentran disponibles en el catálogo.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleToggleDisplayMode('catalog')}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-700 to-purple-600 hover:from-purple-600 hover:to-purple-500 text-white font-mono text-xs font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer shadow-md shadow-purple-900/30"
                >
                  Ver Catálogo Completo
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 touch-pan-y">
              <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1">
                {recentEpisodes.map((item, idx) => (
                  <GalleryCard
                    key={item.id}
                    anime={item.anime}
                    studios={studios}
                    index={idx}
                    isNewEpisodesMode={true}
                    episodeNumber={item.episodeNumber}
                    episodeCoverImage={item.coverImage}
                    onClick={() => navigateTo('detail', item.anime.id, item.episodeNumber)}
                  />
                ))}
              </div>
            </div>
          )
        ) : sortedAnimes.length === 0 ? (
          <div className="py-24 text-center border border-dashed border-dark-border/40 rounded-lg space-y-3">
            <AlertCircle className="h-8 w-8 text-brand-red/60 mx-auto" />
            <h3 className="font-display font-medium text-sm">No se encontraron resultados</h3>
            <p className="font-sans text-xs text-neutral-500">Prueba ajustando los filtros de estudio, género o el buscador.</p>
          </div>
        ) : (() => {
          const activeList = sortedAnimes;
          const itemsPerPage = ITEMS_PER_PAGE;
          const startIndex = (page - 1) * itemsPerPage;
          const endIndex = startIndex + itemsPerPage;
          const currentPageItems = activeList.slice(startIndex, endIndex);
          const totalPages = Math.ceil(activeList.length / itemsPerPage);
          const hasMore = activeList.length > endIndex;

          return (
            <div id="portadas-grid-top" className="relative w-full overflow-hidden scroll-mt-28">
              <AnimatePresence mode="popLayout" custom={pageDirection}>
                <motion.div
                  key={page}
                  custom={pageDirection}
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
                  className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-0.5 sm:gap-1"
                >
                  {currentPageItems.map((anime, idx) => (
                    <GalleryCard
                      key={anime.id}
                      anime={anime}
                      studios={studios}
                      index={idx}
                      isNewEpisodesMode={false}
                      onClick={() => navigateTo('detail', anime.id)}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>

              {/* Modern smart pagination controls (Only for Catalog mode) */}
              {displayMode === 'catalog' && totalPages > 1 && (() => {
                const getSmartPageNumbers = (current: number, total: number): number[] => {
                  if (total <= 6) {
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

                const pageNumbers = getSmartPageNumbers(page, totalPages);

                return (
                  <div className="flex items-center justify-center mt-2.5 pt-2 pb-1 font-mono">
                    <div className="flex items-center gap-2.5 sm:gap-4 overflow-x-auto scrollbar-none py-1 max-w-full justify-center">
                      {/* Previous Page Button */}
                      <button
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page === 1}
                        aria-label="Página anterior"
                        className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      {/* Page Numbers */}
                      {pageNumbers.map((pNum) => {
                        const isActive = pNum === page;

                        return (
                          <button
                            key={pNum}
                            onClick={() => handlePageChange(pNum)}
                            className={`px-2.5 sm:px-3.5 py-1.5 shrink-0 font-mono text-xs sm:text-sm tracking-wider transition-all duration-150 cursor-pointer select-none ${
                              isActive
                                ? 'text-[#ff5588] font-extrabold scale-110'
                                : 'text-white font-bold hover:text-[#ff5588] active:scale-95'
                            }`}
                          >
                            {pNum}
                          </button>
                        );
                      })}

                      {/* Next Page Button */}
                      <button
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page === totalPages}
                        aria-label="Página siguiente"
                        className="p-2 shrink-0 text-white hover:text-[#ff5588] active:scale-95 disabled:opacity-20 disabled:hover:text-white disabled:cursor-not-allowed transition-colors cursor-pointer select-none"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}
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
            onLogout={handleLogout}
            onUserUpdated={handleUserUpdated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
