/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDocs, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';

/**
 * Add an anime to user's watched list in Firestore
 */
export async function addAnimeToWatched(uid: string, animeId: string): Promise<void> {
  if (!uid || !animeId) return;
  try {
    const itemRef = doc(db, "userWatched", uid, "items", animeId);
    await setDoc(itemRef, {
      animeId,
      userId: uid,
      createdAt: serverTimestamp()
    }, { merge: true });
  } catch (err: any) {
    console.warn("[Firestore Watched] Could not add anime to watched list:", err?.message || err);
  }
}

/**
 * Remove an anime from user's watched list in Firestore
 */
export async function removeAnimeFromWatched(uid: string, animeId: string): Promise<void> {
  if (!uid || !animeId) return;
  try {
    const itemRef = doc(db, "userWatched", uid, "items", animeId);
    await deleteDoc(itemRef);
  } catch (err: any) {
    console.warn("[Firestore Watched] Could not remove anime from watched list:", err?.message || err);
  }
}

/**
 * Subscribe to real-time changes in user watched list in Firestore
 */
export function subscribeToUserWatched(
  uid: string, 
  onUpdate: (animeIds: string[]) => void
): () => void {
  if (!uid) return () => {};

  const listRef = collection(db, "userWatched", uid, "items");
  let unsubscribe: (() => void) | null = null;

  try {
    unsubscribe = onSnapshot(listRef, (snapshot) => {
      const animeIds: string[] = [];
      snapshot.forEach((document) => {
        const data = document.data();
        const animeId = data.animeId || document.id;
        if (animeId) {
          animeIds.push(animeId);
        }
      });
      onUpdate(animeIds);
    }, (err) => {
      console.warn("[Firestore Watched] Snapshot error:", err?.message || err);
    });
  } catch (err) {
    console.warn("[Firestore Watched] Failed to attach listener:", err);
  }

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
}

/**
 * Sync guest watched items into the user's permanent Firestore account
 */
export async function syncLocalWatchedToUser(uid: string, localIds: string[]): Promise<void> {
  if (!uid || !localIds || localIds.length === 0) return;
  try {
    const promises = localIds.map(animeId => addAnimeToWatched(uid, animeId));
    await Promise.all(promises);
  } catch (err) {
    console.warn("[Firestore Watched] Failed to sync local watched items:", err);
  }
}
