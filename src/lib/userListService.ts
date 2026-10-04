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

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

/**
 * Update user's lastLogin timestamp in Firestore upon authentication
 */
export async function updateUserLastLogin(uid: string, email?: string | null, displayName?: string | null): Promise<void> {
  if (!uid) return;
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, {
      uid,
      email: email || '',
      displayName: displayName || (email ? email.split('@')[0] : 'Usuario'),
      lastLogin: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log(`[Firestore User] Registered lastLogin timestamp for user ${uid}`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("permission") || err?.code === "permission-denied") {
      console.warn("[Firestore User] Nota: Se requieren permisos en Firestore para actualizar 'users'.", msg);
    } else {
      console.warn("[Firestore User] No se pudo actualizar lastLogin:", msg);
    }
  }
}

/**
 * Cleanup inactive user accounts (> 3 months / 90 days inactive) permanently from Firestore
 */
export async function cleanupInactiveUsers(): Promise<number> {
  try {
    const usersRef = collection(db, "users");
    const snapshot = await getDocs(usersRef);
    const now = Date.now();
    let deletedCount = 0;

    for (const userDoc of snapshot.docs) {
      const data = userDoc.data();
      const uid = userDoc.id;
      let lastLoginMs = 0;

      if (data.lastLogin) {
        if (typeof data.lastLogin.toMillis === 'function') {
          lastLoginMs = data.lastLogin.toMillis();
        } else if (data.lastLogin.seconds) {
          lastLoginMs = data.lastLogin.seconds * 1000;
        } else if (typeof data.lastLogin === 'number') {
          lastLoginMs = data.lastLogin;
        }
      } else if (data.updatedAt) {
        if (typeof data.updatedAt.toMillis === 'function') {
          lastLoginMs = data.updatedAt.toMillis();
        } else if (data.updatedAt.seconds) {
          lastLoginMs = data.updatedAt.seconds * 1000;
        }
      }

      const ageMs = now - lastLoginMs;
      // If user has lastLogin record and age exceeds 90 days (3 months)
      if (lastLoginMs > 0 && ageMs > NINETY_DAYS_MS) {
        try {
          const userItemsRef = collection(db, "userLists", uid, "items");
          const itemsSnap = await getDocs(userItemsRef);
          const delPromises = itemsSnap.docs.map(itemDoc => deleteDoc(doc(db, "userLists", uid, "items", itemDoc.id)));
          await Promise.all(delPromises);
          await deleteDoc(doc(db, "userLists", uid));
        } catch (e) {
          console.warn(`Error clearing userList for inactive user ${uid}:`, e);
        }

        await deleteDoc(doc(db, "users", uid));
        deletedCount++;
        console.log(`[Firestore Inactivity Cleanup] Permanently deleted inactive user ${uid} (${data.email || 'no-email'}) - last active ${Math.round(ageMs / (1000 * 60 * 60 * 24))} days ago (> 3 months).`);
      }
    }

    return deletedCount;
  } catch (err: any) {
    console.warn("[Firestore User Cleanup] Omitiendo limpieza de inactivos en cliente:", err?.message || err);
    return 0;
  }
}

/**
 * Add an anime to user list in Firestore with exact timestamp createdAt
 */
export async function addAnimeToUserList(uid: string, animeId: string): Promise<void> {
  if (!uid || !animeId) return;
  try {
    const itemRef = doc(db, "userLists", uid, "items", animeId);
    await setDoc(itemRef, {
      animeId,
      userId: uid,
      createdAt: serverTimestamp()
    }, { merge: true });
  } catch (err: any) {
    console.warn("Could not add anime to Firestore list:", err?.message || err);
  }
}

/**
 * Remove an anime from user list in Firestore
 */
export async function removeAnimeFromUserList(uid: string, animeId: string): Promise<void> {
  if (!uid || !animeId) return;
  try {
    const itemRef = doc(db, "userLists", uid, "items", animeId);
    await deleteDoc(itemRef);
  } catch (err: any) {
    console.warn("Could not remove anime from Firestore list:", err?.message || err);
  }
}

/**
 * Cleanup expired user list items (>90 days old) permanently from Firestore
 */
export async function cleanupExpiredUserListItems(uid: string): Promise<string[]> {
  if (!uid) return [];
  try {
    const listRef = collection(db, "userLists", uid, "items");
    const snapshot = await getDocs(listRef);
    const now = Date.now();
    const validAnimeIds: string[] = [];
    const deletePromises: Promise<void>[] = [];

    snapshot.forEach((document) => {
      const data = document.data();
      const animeId = data.animeId || document.id;
      let createdAtMs = now;

      if (data.createdAt) {
        if (typeof data.createdAt.toMillis === 'function') {
          createdAtMs = data.createdAt.toMillis();
        } else if (data.createdAt.seconds) {
          createdAtMs = data.createdAt.seconds * 1000;
        } else if (typeof data.createdAt === 'number') {
          createdAtMs = data.createdAt;
        }
      }

      const ageMs = now - createdAtMs;

      if (ageMs > NINETY_DAYS_MS) {
        deletePromises.push(deleteDoc(doc(db, "userLists", uid, "items", document.id)));
      } else {
        validAnimeIds.push(animeId);
      }
    });

    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
      console.log(`[Firestore Cleanup] Deleted ${deletePromises.length} expired items (>90 days old) from user ${uid}'s list.`);
    }

    return validAnimeIds;
  } catch (err: any) {
    console.warn("Could not cleanup expired user list items in Firestore:", err?.message || err);
    return [];
  }
}

/**
 * Subscribe to real-time changes in user list with 90-day filtering & automatic cleanup of expired items
 */
export function subscribeToUserList(
  uid: string, 
  onUpdate: (validAnimeIds: string[]) => void
): () => void {
  if (!uid) return () => {};

  const listRef = collection(db, "userLists", uid, "items");

  let unsubscribe: (() => void) | null = null;

  try {
    unsubscribe = onSnapshot(listRef, (snapshot) => {
      const now = Date.now();
      const validAnimeIds: string[] = [];
      const expiredDocIds: string[] = [];

      snapshot.forEach((document) => {
        const data = document.data();
        const animeId = data.animeId || document.id;
        let createdAtMs = now;

        if (data.createdAt) {
          if (typeof data.createdAt.toMillis === 'function') {
            createdAtMs = data.createdAt.toMillis();
          } else if (data.createdAt.seconds) {
            createdAtMs = data.createdAt.seconds * 1000;
          } else if (typeof data.createdAt === 'number') {
            createdAtMs = data.createdAt;
          }
        }

        const ageMs = now - createdAtMs;

        if (ageMs > NINETY_DAYS_MS) {
          expiredDocIds.push(document.id);
        } else {
          validAnimeIds.push(animeId);
        }
      });

      // Delete expired items asynchronously in background to free storage
      if (expiredDocIds.length > 0) {
        expiredDocIds.forEach((docId) => {
          deleteDoc(doc(db, "userLists", uid, "items", docId)).catch(() => {});
        });
      }

      onUpdate(validAnimeIds);
    }, (error: any) => {
      const errMsg = String(error?.message || error);
      if (error?.code === 'not-found' || errMsg.includes('NOT_FOUND') || error?.code === 'permission-denied') {
        if (unsubscribe) {
          try { unsubscribe(); } catch {}
          unsubscribe = null;
        }
      } else {
        console.warn("Firestore user list subscription error:", error);
      }
    });
  } catch (err) {
    // Graceful offline fallback
  }

  return () => {
    if (unsubscribe) {
      try { unsubscribe(); } catch {}
    }
  };
}

/**
 * Optional helper: Sync local list items to Firestore when user logs in
 */
export async function syncLocalItemsToUserList(uid: string, localIds: string[]): Promise<void> {
  if (!uid || !localIds || localIds.length === 0) return;
  try {
    for (const animeId of localIds) {
      await addAnimeToUserList(uid, animeId);
    }
  } catch (err: any) {
    console.warn("Could not sync local items to user list in Firestore:", err?.message || err);
  }
}
