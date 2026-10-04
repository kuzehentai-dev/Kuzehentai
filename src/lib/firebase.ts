import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported, Analytics } from "firebase/analytics";
import { 
  getAuth, 
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  signOut, 
  onAuthStateChanged,
  User
} from "firebase/auth";
import { 
  getFirestore, 
  initializeFirestore,
  setLogLevel,
  collection, 
  addDoc, 
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  query, 
  where,
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  Timestamp
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBZ3P_uFIUYb9eoOtohziZBYZsFD3dEYLs",
  authDomain: "khentai.firebaseapp.com",
  projectId: "khentai",
  storageBucket: "khentai.firebasestorage.app",
  messagingSenderId: "395360975180",
  appId: "1:395360975180:web:b17b029ac4707e9f4a77e9",
  measurementId: "G-V5S9Y4VYLK"
};

// Safe initialization of Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Optional Analytics initialization if supported in current browser environment
let analyticsInstance: Analytics | null = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analyticsInstance = getAnalytics(app);
    }
  }).catch(() => {});
}

export const analytics = analyticsInstance;

export const auth = getAuth(app);

let persistencePromise: Promise<void> | null = null;

export const configureAuthPersistence = async () => {
  if (persistencePromise) return persistencePromise;

  persistencePromise = (async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (!errMsg.includes("closing") && !errMsg.includes("hidden")) {
        console.warn("[Firebase Auth] Fallback from local persistence:", err?.code || err);
      }
      try {
        await setPersistence(auth, browserSessionPersistence);
      } catch {
        try {
          await setPersistence(auth, inMemoryPersistence);
        } catch {
          // Graceful fallback for closed/hidden database environments
        }
      }
    }
  })();

  return persistencePromise;
};

// Initialize once safely
configureAuthPersistence().catch(() => {});

// Suppress internal Firestore connection errors when database is not yet created in console
if (typeof window !== 'undefined') {
  const filterFirestoreLog = (orig: (...args: any[]) => void) => (...args: any[]) => {
    const text = args.map(a => typeof a === 'object' ? (a?.message || JSON.stringify(a)) : String(a)).join(' ');
    if (
      text.includes('@firebase/firestore') && 
      (text.includes('NOT_FOUND') || text.includes('Listen') || text.includes('Could not reach Cloud Firestore backend') || text.includes('GrpcConnection'))
    ) {
      return;
    }
    orig.apply(console, args);
  };
  console.warn = filterFirestoreLog(console.warn);
  console.error = filterFirestoreLog(console.error);
}

// Clean & Standard Firestore Initialization with Auto-Detect Long Polling & Resilient Offline Fallback
let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true
  });
  setLogLevel('silent');
} catch (e) {
  try {
    firestoreDb = getFirestore(app);
    setLogLevel('silent');
  } catch (err) {
    try {
      firestoreDb = getFirestore();
      setLogLevel('silent');
    } catch (finalErr) {
      console.warn("[Firebase] Firestore initialization fallback:", finalErr);
    }
  }
}

export const db = firestoreDb;
export const comentariosCollection = collection(db, "comentariosGlobales");

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export {
  collection,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  signOut, 
  onAuthStateChanged,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
};

export interface CommentItem {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string;
  userPhoto?: string;
  text: string;
  createdAt: any;
  parentId?: string | null;
  animeId?: string | null;
  animeTitle?: string | null;
  hidden?: boolean;
}
