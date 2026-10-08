/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  db, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  getDocs,
  onAuthStateChanged,
  serverTimestamp 
} from '../lib/firebase';

export interface VoteData {
  v5: number;
  v4: number;
  v3: number;
  v2: number;
  v1: number;
}

export interface RatingStats {
  v5: number;
  v4: number;
  v3: number;
  v2: number;
  v1: number;
  totalVotes: number;
  average: number; // e.g. 4.8 out of 5.0
  userVote: number | null; // 1 to 5 or null
}

// In-memory cache for ratings
const ratingsCache: Record<string, VoteData> = {};
const userVotesCache: Record<string, number> = {};

export function clearAllRatingsCache() {
  Object.keys(ratingsCache).forEach((k) => delete ratingsCache[k]);
  Object.keys(userVotesCache).forEach((k) => delete userVotesCache[k]);
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('kh_anime_votes_') || key.startsWith('kh_user_vote_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('kh_rating_updated', { detail: {} }));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('kh_clear_ratings_cache', () => {
    clearAllRatingsCache();
  });
}

function getInitialVotes(): VoteData {
  return { v5: 0, v4: 0, v3: 0, v2: 0, v1: 0 };
}

// Global real-time listener for all ratings in Firestore
let isListenerInitialized = false;

function initRealtimeRatingsListener() {
  if (isListenerInitialized || !db) return;
  isListenerInitialized = true;

  try {
    const ratingsColl = collection(db, 'anime_ratings');
    let unsub: (() => void) | null = null;
    unsub = onSnapshot(ratingsColl, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const animeId = change.doc.id;
        if (change.type === 'removed') {
          delete ratingsCache[animeId];
          try {
            localStorage.removeItem(`kh_anime_votes_${animeId}`);
          } catch {}
          window.dispatchEvent(new CustomEvent('kh_rating_updated', { detail: { animeId } }));
          return;
        }

        const data = change.doc.data();
        if (data) {
          const voteData: VoteData = {
            v5: Math.max(0, Number(data.v5) || 0),
            v4: Math.max(0, Number(data.v4) || 0),
            v3: Math.max(0, Number(data.v3) || 0),
            v2: Math.max(0, Number(data.v2) || 0),
            v1: Math.max(0, Number(data.v1) || 0),
          };
          ratingsCache[animeId] = voteData;
          try {
            localStorage.setItem(`kh_anime_votes_${animeId}`, JSON.stringify(voteData));
          } catch {}
          window.dispatchEvent(new CustomEvent('kh_rating_updated', { detail: { animeId } }));
        }
      });
    }, (err: any) => {
      const errMsg = String(err?.message || err);
      if (err?.code === 'not-found' || errMsg.includes('NOT_FOUND') || err?.code === 'permission-denied') {
        if (unsub) {
          try { unsub(); } catch {}
          unsub = null;
        }
      } else {
        console.warn('[RatingManager] Ratings snapshot error:', err);
      }
    });
  } catch (err) {
    console.warn('[RatingManager] Failed to attach ratings listener:', err);
  }
}

// Track user's votes when logged in
onAuthStateChanged(auth, async (user) => {
  if (user && db) {
    try {
      const q = query(collection(db, 'user_anime_votes'), where('userId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data && data.animeId && typeof data.vote === 'number') {
          userVotesCache[`${user.uid}_${data.animeId}`] = data.vote;
          try {
            localStorage.setItem(`kh_user_vote_${user.uid}_${data.animeId}`, data.vote.toString());
          } catch {}
        }
      });
      window.dispatchEvent(new CustomEvent('kh_rating_updated', { detail: { userId: user.uid } }));
    } catch (err) {
      console.warn('[RatingManager] Failed to fetch user votes:', err);
    }
  }
});

// Auto initialize listener
initRealtimeRatingsListener();

export function getAnimeRatingStats(animeId: string): RatingStats {
  if (!animeId) {
    return { v5: 0, v4: 0, v3: 0, v2: 0, v1: 0, totalVotes: 0, average: 0, userVote: null };
  }

  // 1. Check in-memory cache or localStorage
  let voteData: VoteData;
  if (ratingsCache[animeId]) {
    voteData = ratingsCache[animeId];
  } else {
    const storedVotesRaw = localStorage.getItem(`kh_anime_votes_${animeId}`);
    if (storedVotesRaw) {
      try {
        const parsed = JSON.parse(storedVotesRaw);
        voteData = {
          v5: Number(parsed.v5) || 0,
          v4: Number(parsed.v4) || 0,
          v3: Number(parsed.v3) || 0,
          v2: Number(parsed.v2) || 0,
          v1: Number(parsed.v1) || 0,
        };
        ratingsCache[animeId] = voteData;
      } catch {
        voteData = getInitialVotes();
        ratingsCache[animeId] = voteData;
      }
    } else {
      voteData = getInitialVotes();
      ratingsCache[animeId] = voteData;
    }
  }

  // 2. Check user vote if logged in
  let userVote: number | null = null;
  const currentUser = auth.currentUser;

  if (currentUser) {
    const cacheKey = `${currentUser.uid}_${animeId}`;
    if (userVotesCache[cacheKey] !== undefined) {
      userVote = userVotesCache[cacheKey];
    } else {
      const storedUserVote = localStorage.getItem(`kh_user_vote_${currentUser.uid}_${animeId}`);
      if (storedUserVote) {
        const parsed = parseInt(storedUserVote, 10);
        if (parsed >= 1 && parsed <= 5) {
          userVote = parsed;
          userVotesCache[cacheKey] = parsed;
        }
      }
    }
  }

  const totalVotes = voteData.v5 + voteData.v4 + voteData.v3 + voteData.v2 + voteData.v1;
  const totalScore = (voteData.v5 * 5) + (voteData.v4 * 4) + (voteData.v3 * 3) + (voteData.v2 * 2) + (voteData.v1 * 1);
  const average = totalVotes > 0 ? parseFloat((totalScore / totalVotes).toFixed(1)) : 0;

  return {
    v5: voteData.v5,
    v4: voteData.v4,
    v3: voteData.v3,
    v2: voteData.v2,
    v1: voteData.v1,
    totalVotes,
    average,
    userVote,
  };
}

export function submitAnimeVote(animeId: string, starRating: number): { stats: RatingStats; error?: string } {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      stats: getAnimeRatingStats(animeId),
      error: 'Debes iniciar sesión para poder calificar.',
    };
  }

  if (starRating < 1 || starRating > 5) {
    return { stats: getAnimeRatingStats(animeId) };
  }

  const userId = currentUser.uid;
  const currentStats = getAnimeRatingStats(animeId);
  const { userVote } = currentStats;

  let v5 = currentStats.v5;
  let v4 = currentStats.v4;
  let v3 = currentStats.v3;
  let v2 = currentStats.v2;
  let v1 = currentStats.v1;

  // Remove old vote if user already voted
  if (userVote === 1) v1 = Math.max(0, v1 - 1);
  if (userVote === 2) v2 = Math.max(0, v2 - 1);
  if (userVote === 3) v3 = Math.max(0, v3 - 1);
  if (userVote === 4) v4 = Math.max(0, v4 - 1);
  if (userVote === 5) v5 = Math.max(0, v5 - 1);

  let newRatingValue: number | null = starRating;

  // If user clicked the same vote, toggle off
  if (userVote === starRating) {
    newRatingValue = null;
    delete userVotesCache[`${userId}_${animeId}`];
    try {
      localStorage.removeItem(`kh_user_vote_${userId}_${animeId}`);
    } catch {}
  } else {
    // Add new vote
    if (starRating === 1) v1 += 1;
    if (starRating === 2) v2 += 1;
    if (starRating === 3) v3 += 1;
    if (starRating === 4) v4 += 1;
    if (starRating === 5) v5 += 1;
    userVotesCache[`${userId}_${animeId}`] = starRating;
    try {
      localStorage.setItem(`kh_user_vote_${userId}_${animeId}`, starRating.toString());
    } catch {}
  }

  const newVotes: VoteData = { v5, v4, v3, v2, v1 };
  ratingsCache[animeId] = newVotes;
  try {
    localStorage.setItem(`kh_anime_votes_${animeId}`, JSON.stringify(newVotes));
  } catch {}

  // 3. Persist asynchronously to Firebase Firestore
  if (db) {
    const ratingRef = doc(db, 'anime_ratings', animeId);
    setDoc(ratingRef, { v5, v4, v3, v2, v1, updatedAt: serverTimestamp() }, { merge: true }).catch((err) => {
      console.error('[RatingManager] Error saving rating to Firestore:', err);
    });

    const userVoteRef = doc(db, 'user_anime_votes', `${userId}_${animeId}`);
    if (newRatingValue === null) {
      deleteDoc(userVoteRef).catch((err) => {
        console.error('[RatingManager] Error deleting user vote in Firestore:', err);
      });
    } else {
      setDoc(userVoteRef, {
        userId,
        animeId,
        vote: newRatingValue,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((err) => {
        console.error('[RatingManager] Error saving user vote in Firestore:', err);
      });
    }
  }

  // Trigger local custom event so all components re-render immediately
  window.dispatchEvent(new CustomEvent('kh_rating_updated', { detail: { animeId } }));

  return { stats: getAnimeRatingStats(animeId) };
}
