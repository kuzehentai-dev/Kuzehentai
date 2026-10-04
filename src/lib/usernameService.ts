import { 
  db, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  collection, 
  getDocs, 
  query, 
  where, 
  serverTimestamp 
} from './firebase';

/**
 * Checks if a given username is already taken by another user.
 * Performs a case-insensitive check against both the 'usernames' reservation index
 * and the 'users' collection.
 * 
 * @param rawName The requested username
 * @param currentUserId Optional UID of the current user (to allow keeping own name)
 * @returns boolean true if taken by someone else, false if available
 */
export async function isUsernameTaken(rawName: string, currentUserId?: string | null): Promise<boolean> {
  if (!db) return false;
  const cleanName = rawName.trim();
  const normalized = cleanName.toLowerCase();
  
  if (!normalized) return false;

  try {
    // 1. Check reservation document in 'usernames' collection
    const usernameDocRef = doc(db, 'usernames', normalized);
    const usernameDocSnap = await getDoc(usernameDocRef);

    if (usernameDocSnap.exists()) {
      const data = usernameDocSnap.data();
      if (currentUserId && data?.uid === currentUserId) {
        // Owned by the current user
        return false;
      }
      return true; // Taken by another user
    }

    // 2. Check 'users' collection by displayNameLower
    const lowerQuery = query(
      collection(db, 'users'),
      where('displayNameLower', '==', normalized)
    );
    const lowerSnap = await getDocs(lowerQuery);
    for (const d of lowerSnap.docs) {
      if (d.id !== currentUserId) {
        return true;
      }
    }

    // 3. Check 'users' collection by exact displayName (for older documents)
    const exactQuery = query(
      collection(db, 'users'),
      where('displayName', '==', cleanName)
    );
    const exactSnap = await getDocs(exactQuery);
    for (const d of exactSnap.docs) {
      if (d.id !== currentUserId) {
        return true;
      }
    }

    // 4. Fallback in-memory scan for legacy docs with different casing (e.g., 'User' vs 'user')
    try {
      const allUsersSnap = await getDocs(collection(db, 'users'));
      for (const d of allUsersSnap.docs) {
        if (d.id !== currentUserId) {
          const name = d.data()?.displayName;
          if (typeof name === 'string' && name.trim().toLowerCase() === normalized) {
            return true;
          }
        }
      }
    } catch {
      // Ignore if list query fails due to local constraints
    }

    return false;
  } catch (err) {
    console.warn('[isUsernameTaken] Verification check error:', err);
    // If there is a transient network error, allow proceeding or return false safely
    return false;
  }
}

/**
 * Reserves a username in the 'usernames' collection and updates the user's document.
 * Cleans up any previous username reservation if it changed.
 */
export async function reserveUsername(
  rawName: string, 
  uid: string, 
  previousRawName?: string | null
): Promise<void> {
  if (!db || !uid) return;
  const cleanName = rawName.trim();
  const normalized = cleanName.toLowerCase();

  if (!normalized) return;

  try {
    // 1. Delete previous reservation if name changed
    if (previousRawName) {
      const prevNorm = previousRawName.trim().toLowerCase();
      if (prevNorm && prevNorm !== normalized) {
        try {
          const prevRef = doc(db, 'usernames', prevNorm);
          const prevSnap = await getDoc(prevRef);
          if (prevSnap.exists() && prevSnap.data()?.uid === uid) {
            await deleteDoc(prevRef);
          }
        } catch (delErr) {
          console.warn('[reserveUsername] Could not delete old username reservation:', delErr);
        }
      }
    }

    // 2. Create/update reservation in 'usernames'
    await setDoc(doc(db, 'usernames', normalized), {
      uid,
      displayName: cleanName,
      displayNameLower: normalized,
      updatedAt: serverTimestamp()
    });

    // 3. Keep 'users/{uid}' document synchronized
    await setDoc(doc(db, 'users', uid), {
      displayName: cleanName,
      displayNameLower: normalized,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error('[reserveUsername] Error reserving username:', err);
  }
}
