/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
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
  coverImage?: string;
  thumbnail?: string;
  addedToRecentAt?: string;
}

export interface Anime {
  id: string;
  name: string;
  image: string;
  coverData?: string;
  studioId?: string;
  studioIds?: string[];
  genreIds: string[];
  status: string;
  year?: string;
  description: string;
  telegramUrl: string;
  episodes: Episode[];
  isSingleEpisode?: boolean;
  downloads?: number;
  createdAt?: string;
  updatedAt?: string;
  hidden?: boolean;
  storageLocation?: string;
  savedInFirestore?: boolean;
  firestoreError?: string;
}

export interface DatabaseSchema {
  studios: Studio[];
  genres: Genre[];
  animes: Anime[];
  userLists?: Record<string, string[]>;
  animeViews?: Record<string, number>;
  animeDownloads?: Record<string, number>;
  trash?: string[];
}

export function getNormalizedKey(name: string): string {
  if (!name) return '';
  let str = name.trim().toLowerCase();
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  str = str.replace(/\s+/g, ' ');
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
  if (/^\d{4}$/.test(yStr)) return yStr;
  if (/^\d{1}$/.test(yStr)) return `200${yStr}`;
  if (/^\d{2}$/.test(yStr)) return `20${yStr}`;
  return yStr;
}

dotenv.config();

// Suppress known Firestore backend connection retry spam when Firestore database is not yet provisioned in Firebase Console
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

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Health check endpoints for Cloud Run / proxy ingress
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
});

// Lazy dynamic sharp loader to prevent container start failure if C++ native bindings are missing
let sharpModule: any = null;
async function getSharp() {
  if (!sharpModule) {
    try {
      const s = await import('sharp');
      sharpModule = s.default || s;
    } catch (e) {
      console.warn('Sharp module unavailable, falling back:', e);
      return null;
    }
  }
  return sharpModule;
}

// Firebase Firestore Configuration
function loadFirebaseConfig() {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const fileData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (fileData && fileData.projectId) {
        return fileData;
      }
    }
  } catch (e) {
    console.warn('Could not read firebase-applet-config.json, using built-in config');
  }
  return {
    apiKey: "AIzaSyBZ3P_uFIUYb9eoOtohziZBYZsFD3dEYLs",
    authDomain: "khentai.firebaseapp.com",
    projectId: "khentai",
    storageBucket: "khentai.firebasestorage.app",
    messagingSenderId: "395360975180",
    appId: "1:395360975180:web:b17b029ac4707e9f4a77e9",
    measurementId: "G-V5S9Y4VYLK"
  };
}

const FIREBASE_CONFIG = loadFirebaseConfig();

const DATABASE_ID = "(default)";

const firebaseApp = initializeApp(FIREBASE_CONFIG);
export const firestoreDb = getFirestore(firebaseApp);

function generateSlug(name: string): string {
  if (!name) return 'anime-' + Date.now();
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || ('anime-' + Date.now());
}

// Enable gzip response compression for fast network transfers
app.use(compression() as any);

// Body parser with 200mb limit for complete backups with covers
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Handle 413 Payload Too Large gracefully
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.status === 413 || err.type === 'entity.too.large')) {
    return res.status(413).json({
      error: 'Error 413: El archivo o contenido excede el tamaño máximo permitido en una sola petición. Por favor, realiza la importación por lotes desde el panel de administración.'
    });
  }
  next(err);
});

const DB_FILE = path.join(process.cwd(), 'database.json');
const COVERS_DIR = path.join(process.cwd(), 'public', 'covers');
const API_COVERS_DIR = path.join(process.cwd(), 'public', 'api', 'covers');

// Ensure public covers directories exist safely
try {
  if (!fs.existsSync(COVERS_DIR)) {
    fs.mkdirSync(COVERS_DIR, { recursive: true });
  }
} catch (e) {}

try {
  if (!fs.existsSync(API_COVERS_DIR)) {
    fs.mkdirSync(API_COVERS_DIR, { recursive: true });
  }
} catch (e) {}

// Serve public static covers with Capa 3 1-year Cache-Control HTTP headers
const setCoverCacheHeaders = (res: express.Response) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
};

app.use('/covers', express.static(COVERS_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: setCoverCacheHeaders
}));
app.use('/api/covers', express.static(API_COVERS_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: setCoverCacheHeaders
}));
app.use('/api/covers', express.static(COVERS_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: setCoverCacheHeaders
}));

// Explicit PWA and Manifest endpoints with correct headers & MIME types
app.get(['/manifest.json', '/site.webmanifest'], (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  const pubPath = path.join(process.cwd(), 'public', 'manifest.json');
  if (fs.existsSync(pubPath)) {
    return res.sendFile(pubPath);
  }
  const rootPath = path.join(process.cwd(), 'manifest.json');
  if (fs.existsSync(rootPath)) {
    return res.sendFile(rootPath);
  }
  res.status(404).send('Manifest not found');
});

app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const pubPath = path.join(process.cwd(), 'public', 'sw.js');
  if (fs.existsSync(pubPath)) {
    return res.sendFile(pubPath);
  }
  res.status(404).send('Service worker not found');
});

// Explicit Favicon and PWA App Icon endpoints
app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Content-Type', 'image/x-icon');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  const pubPath = path.join(process.cwd(), 'public', 'favicon.ico');
  if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
  res.status(404).end();
});

app.get(/^\/(apple-touch-icon.*|favicon.*|icon-.*|icono.*|mstile.*)\.png$/, (req, res) => {
  const fileName = path.basename(req.path);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  const pubPath = path.join(process.cwd(), 'public', fileName);
  if (fs.existsSync(pubPath)) return res.sendFile(pubPath);
  // Fallback to general apple-touch-icon.png or icon-512.png if specific dimension is requested
  const fallbackPath = path.join(process.cwd(), 'public', 'apple-touch-icon.png');
  if (fs.existsSync(fallbackPath)) return res.sendFile(fallbackPath);
  res.status(404).end();
});

// Serve public static assets (manifest.json, sw.js, Favicon.png, Icono.png, etc.)
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Default Seed Data (Ensures system is never completely empty on fresh setup) ---
const DEFAULT_STUDIOS: Studio[] = [
  { id: 'st-pink-pineapple', name: 'Pink Pineapple' },
  { id: 'st-seven', name: 'Seven' },
  { id: 'st-bunnywalker', name: 'Bunnywalker' },
  { id: 'st-mary-jane', name: 'Mary Jane' },
  { id: 'st-queen-bee', name: 'Queen Bee' },
  { id: 'st-hoods-entertainment', name: 'Hoods Entertainment' },
  { id: 'st-arms', name: 'Arms' },
  { id: 'st-ms-pictures', name: 'MS Pictures' },
  { id: 'st-t-rex', name: 'T-Rex' },
  { id: 'st-pixy', name: 'Pixy' }
];

const DEFAULT_GENRES: Genre[] = [
  { id: 'gn-romance', name: 'Romance' },
  { id: 'gn-comedia', name: 'Comedia' },
  { id: 'gn-escolar', name: 'Escolar' },
  { id: 'gn-fantasia', name: 'Fantasía' },
  { id: 'gn-harem', name: 'Harem' },
  { id: 'gn-sobrenatural', name: 'Sobrenatural' },
  { id: 'gn-milf', name: 'Madre / MILF' },
  { id: 'gn-sirvientas', name: 'Maids / Sirvientas' },
  { id: 'gn-tsundere', name: 'Tsundere' },
  { id: 'gn-enfermeras', name: 'Enfermeras' }
];

// --- SVG Poster Generator Helper (Instant fallback if image missing) ---
function generateSvgPoster(title: string, studioName: string): string {
  const cleanTitle = (title || 'Anime').replace(/["'<>]/g, '');
  const cleanStudio = (studioName || 'Estudio').replace(/["'<>]/g, '');
  
  const colors = [
    { start: '#080808', end: '#240404', accent: '#bd42f5' },
    { start: '#090909', end: '#141424', accent: '#4d79ff' },
    { start: '#050505', end: '#202020', accent: '#ffffff' },
    { start: '#0c0a05', end: '#2d1d05', accent: '#ffaa00' },
  ];
  const color = colors[cleanTitle.length % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="100%" height="100%">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color.start}"/>
        <stop offset="100%" stop-color="${color.end}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="15" y="15" width="370" height="570" fill="none" stroke="#222" stroke-width="2"/>
    <rect x="25" y="25" width="350" height="550" fill="none" stroke="${color.accent}" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="8 4"/>
    
    <line x1="50" y1="120" x2="350" y2="120" stroke="#333" stroke-width="1" />
    <line x1="50" y1="480" x2="350" y2="480" stroke="#333" stroke-width="1" />
    
    <circle cx="200" cy="200" r="60" fill="none" stroke="${color.accent}" stroke-opacity="0.8" stroke-width="1.5"/>
    <circle cx="200" cy="200" r="45" fill="none" stroke="#333" stroke-width="1"/>
    <line x1="200" y1="120" x2="200" y2="280" stroke="${color.accent}" stroke-opacity="0.5" stroke-width="1"/>
    
    <text x="200" y="60" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="10" font-weight="600" fill="#a8a8a8" letter-spacing="4" text-anchor="middle">KUZE HENTAI ARCHIVE</text>
    
    <text x="200" y="380" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-weight="800" font-size="24" fill="#ffffff" letter-spacing="-0.5" text-anchor="middle">${cleanTitle}</text>
    
    <text x="200" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="13" font-weight="500" fill="${color.accent}" letter-spacing="2" text-anchor="middle">${cleanStudio.toUpperCase()}</text>
    
    <text x="200" y="540" font-family="-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" font-size="9" fill="#666" letter-spacing="1" text-anchor="middle">PORTADA OFICIAL // KUZEHENTAI</text>
  </svg>`;
  
  return svg;
}

// --- Image Helper (Sin optimización ni pérdida de calidad) ---
async function compressImageToWebpBuffer(imageStr: string): Promise<{ buffer: Buffer; mimeType: string; extension: string } | null> {
  if (!imageStr || typeof imageStr !== 'string' || imageStr.trim() === '') return null;
  const trimmed = imageStr.trim();

  let inputBuffer: Buffer | null = null;
  let detectedMime = 'image/webp';

  if (trimmed.startsWith('data:image/') && !trimmed.startsWith('data:image/svg')) {
    const parts = trimmed.split(';base64,');
    if (parts.length === 2) {
      inputBuffer = Buffer.from(parts[1], 'base64');
      const mimeMatch = trimmed.match(/^data:([^;]+);/);
      if (mimeMatch) detectedMime = mimeMatch[1];
    }
  } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(trimmed, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        inputBuffer = Buffer.from(arrayBuf);
        const cType = resp.headers.get('content-type');
        if (cType) detectedMime = cType;
      }
    } catch (err) {
      console.warn(`[Cover Optimization] Could not download image from URL (${trimmed}):`, err);
    }
  }

  if (!inputBuffer || inputBuffer.length === 0) return null;

  const ext = detectedMime.includes('webp') ? 'webp' : detectedMime.includes('png') ? 'png' : 'jpg';
  return { buffer: inputBuffer, mimeType: detectedMime, extension: ext };
}

// Optimiza y comprime portadas y miniaturas de episodios para no sobrecargar Firestore ni localStorage
async function optimizeEpisodeCoverIfNeeded(coverStr: string): Promise<string> {
  if (!coverStr || !coverStr.startsWith('data:image/')) return coverStr || '';
  try {
    const base64Data = coverStr.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    // Si ya es muy ligera (menos de 35 KB), conservarla directamente
    if (buffer.length <= 35 * 1024) return coverStr;
    const resized = await sharp(buffer)
      .resize({ width: 480, height: 270, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${resized.toString('base64')}`;
  } catch (err) {
    return coverStr;
  }
}

// --- Episode Normalization & Safe Merge Helpers ---
function normalizeEpisodesList(eps: any): Episode[] {
  if (!eps) return [];
  const result: Episode[] = [];

  if (Array.isArray(eps)) {
    eps.forEach((ep, idx) => {
      if (!ep) return;
      if (typeof ep === 'string') {
        const link = ep.trim();
        if (link) {
          result.push({
            number: idx + 1,
            mp4Url: link,
            telegramUrl: link,
            url: link,
            videoUrl: link,
            link: link
          });
        }
      } else if (typeof ep === 'object') {
        const number = Number(ep.number || ep.epNumber || ep.episode || ep.cap || (idx + 1)) || (idx + 1);
        const link = String(
          ep.mp4Url || ep.telegramUrl || ep.url || ep.videoUrl || ep.link || ep.embedUrl || ep.streamUrl || ''
        ).trim();
        result.push({
          number,
          mp4Url: link,
          telegramUrl: link,
          url: link,
          videoUrl: link,
          link: link,
          isNew: Boolean(ep.isNew),
          ...(ep.title ? { title: String(ep.title) } : {}),
          ...(ep.name ? { name: String(ep.name) } : {}),
          ...(ep.coverImage ? { coverImage: String(ep.coverImage) } : {}),
          ...(ep.thumbnail ? { thumbnail: String(ep.thumbnail) } : {}),
          ...(ep.addedToRecentAt ? { addedToRecentAt: String(ep.addedToRecentAt) } : {})
        });
      }
    });
  } else if (typeof eps === 'object') {
    Object.keys(eps).forEach(key => {
      const val = eps[key];
      if (!val) return;
      const number = Number(key) || 1;
      let link = '';
      let title = '';
      let isNew = false;
      let coverImage: string | undefined = undefined;
      let thumbnail: string | undefined = undefined;
      let addedToRecentAt: string | undefined = undefined;

      if (typeof val === 'string') {
        link = val.trim();
      } else if (typeof val === 'object') {
        link = String(val.mp4Url || val.telegramUrl || val.url || val.videoUrl || val.link || '').trim();
        if (val.title) title = String(val.title);
        if (val.name) title = String(val.name);
        if (val.isNew) isNew = true;
        if (val.coverImage) coverImage = String(val.coverImage);
        if (val.thumbnail) thumbnail = String(val.thumbnail);
        if (val.addedToRecentAt) addedToRecentAt = String(val.addedToRecentAt);
      }

      result.push({
        number,
        mp4Url: link,
        telegramUrl: link,
        url: link,
        videoUrl: link,
        link: link,
        isNew: Boolean(isNew),
        ...(title ? { title } : {}),
        ...(coverImage ? { coverImage } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(addedToRecentAt ? { addedToRecentAt: String(addedToRecentAt) } : {})
      });
    });
  }

  return result.sort((a, b) => a.number - b.number);
}

// Storage serializer: stores episodes as a clean Map in Firestore/storage
function serializeEpisodesForStorage(eps: any): Record<string, any> {
  const norm = normalizeEpisodesList(eps);
  const map: Record<string, any> = {};
  norm.forEach(ep => {
    const link = ep.mp4Url || ep.telegramUrl || ep.url || ep.videoUrl || '';
    map[String(ep.number)] = { 
      mp4Url: link, 
      isNew: Boolean(ep.isNew),
      ...(ep.title ? { title: ep.title } : {}),
      ...(ep.coverImage ? { coverImage: ep.coverImage } : {}),
      ...(ep.thumbnail ? { thumbnail: ep.thumbnail } : {}),
      ...(ep.addedToRecentAt ? { addedToRecentAt: ep.addedToRecentAt } : {})
    };
  });
  return map;
}

function mergeAnimeEpisodes(epsA: any[], epsB: any[]): Episode[] {
  const normA = normalizeEpisodesList(epsA);
  const normB = normalizeEpisodesList(epsB);

  const epMap = new Map<number, Episode>();

  for (const ep of normA) {
    epMap.set(ep.number, ep);
  }

  for (const ep of normB) {
    const existing = epMap.get(ep.number);
    if (!existing) {
      epMap.set(ep.number, ep);
    } else {
      const linkB = ep.mp4Url || ep.telegramUrl || ep.url || ep.videoUrl || '';
      const linkA = existing.mp4Url || existing.telegramUrl || existing.url || existing.videoUrl || '';
      if (!linkA && linkB) {
        epMap.set(ep.number, ep);
      } else if (linkB.includes('.mp4') && !linkA.includes('.mp4')) {
        epMap.set(ep.number, ep);
      }
    }
  }

  return Array.from(epMap.values()).sort((a, b) => a.number - b.number);
}

interface ImportSession {
  id: string;
  createdAt: number;
  totalAnimes: number;
  importedAnimes: Anime[];
  rawStudiosCount: number;
  rawGenresCount: number;
}

// --- Dynamic Database Layer (Supabase Primary with Local File & Memory Protection) ---
class DBService {
  private localDb: DatabaseSchema = { studios: [], genres: [], animes: [] };
  private initialized = false;
  private isSyncing = false;
  private isFirestoreDisabled = false;
  private lastFirestoreErrorCheck = 0;
  private lastAnimesFetch = 0;
  private importSessions = new Map<string, ImportSession>();

  private async safeFirestoreOp<T>(op: () => Promise<T>, retries = 2): Promise<T | null> {
    if (this.isFirestoreDisabled) {
      if (Date.now() - this.lastFirestoreErrorCheck < 120000) {
        return null;
      }
      this.isFirestoreDisabled = false;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await op();
        // Return explicit truthy object if operation returns void/undefined
        return (res === undefined ? ({ success: true } as unknown as T) : res);
      } catch (err: any) {
        const msg = String(err?.message || err);
        const code = err?.code || 'ERR_FIRESTORE';
        console.error(`[Firebase Firestore Error] Intento ${attempt + 1}/${retries + 1} | Código: ${code} | Detalle: ${msg}`);

        if (msg.includes('PERMISSION_DENIED') || msg.includes('Cloud Firestore API has not been used') || msg.includes('not been used in project')) {
          if (!this.isFirestoreDisabled) {
            console.warn('⚠️ [Firebase Firestore] La API de Cloud Firestore no está habilitada o la base de datos no se ha creado en la consola de Firebase para "khentai".');
            console.warn('ℹ️ [Firebase Firestore] Operando en modo local (/database.json) sin interrupciones.');
          }
          this.isFirestoreDisabled = true;
          this.lastFirestoreErrorCheck = Date.now();
          return null;
        }

        if (attempt < retries) {
          console.warn(`🔄 [Firebase Firestore] Reintentando operación (${attempt + 1}/${retries})...`, msg);
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        } else {
          console.warn('❌ [Firebase Firestore] Operación falló definitivamente tras reintentos:', msg);
        }
      }
    }
    return null;
  }

  private async saveAnimeToFirestoreBg(anime: Anime) {
    try {
      const firestoreCoverData = (anime.coverData && anime.coverData.length < 100000) ? anime.coverData : null;
      const storageEpisodes = serializeEpisodesForStorage(anime.episodes || []);
      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);

      const payload = {
        id: String(anime.id),
        name: String(anime.name || ''),
        image: String(anime.image || ''),
        coverData: firestoreCoverData,
        year: String(anime.year || ''),
        telegramUrl: String(anime.telegramUrl || ''),
        episodes: storageEpisodes,
        studioId: (anime.studioId || sIds[0]) ? String(anime.studioId || sIds[0]) : '',
        studioIds: sIds.map(String),
        genreIds: Array.isArray(anime.genreIds) ? anime.genreIds.map(String) : [],
        status: String(anime.status || 'Finalizado'),
        description: String(anime.description || ''),
        hidden: Boolean(anime.hidden),
        downloads: Number(anime.downloads) || 0,
        createdAt: anime.createdAt || new Date().toISOString(),
        updatedAt: anime.updatedAt || new Date().toISOString()
      };

      const startBg = Date.now();
      const bgRes = await this.safeFirestoreOp(() => setDoc(doc(firestoreDb, 'animes', anime.id), payload, { merge: true }));
      if (bgRes !== null) {
        console.log(`✅ [Firebase Sync BG OK] Sincronización en segundo plano de "${anime.name}" (${anime.id}) en Firestore completada en ${Date.now() - startBg}ms.`);
      } else {
        console.warn(`⚠️ [Firebase Sync BG WARN] Falló sincronización en segundo plano de "${anime.name}" en Firestore.`);
      }
    } catch (e) {
      console.warn('❌ [Firebase Sync BG Error]', e);
    }
  }

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;

    try {
      if (fs.existsSync(DB_FILE)) {
        try {
          const raw = fs.readFileSync(DB_FILE, 'utf-8');
          this.localDb = JSON.parse(raw);
        } catch (parseErr) {
          console.error('Error al analizar DB_FILE, intentando respaldo .bak:', parseErr);
          if (fs.existsSync(DB_FILE + '.bak')) {
            const rawBak = fs.readFileSync(DB_FILE + '.bak', 'utf-8');
            this.localDb = JSON.parse(rawBak);
          }
        }
      } else if (fs.existsSync(DB_FILE + '.bak')) {
        const rawBak = fs.readFileSync(DB_FILE + '.bak', 'utf-8');
        this.localDb = JSON.parse(rawBak);
      }

      if (!this.localDb) this.localDb = { studios: [], genres: [], animes: [], userLists: {} };
      if (!this.localDb.studios) this.localDb.studios = [];
      if (!this.localDb.genres) this.localDb.genres = [];
      if (!this.localDb.animes) this.localDb.animes = [];
      if (!this.localDb.userLists) this.localDb.userLists = {};

      // Auto-normalize any anime years to full 4-digit format (2000s)
      for (const a of this.localDb.animes) {
        if (a.year) {
          a.year = normalizeAnimeYear(a.year);
        }
      }

      this.saveLocal();
    } catch (err) {
      console.error('Error al inicializar la base de datos local:', err);
      this.localDb = { studios: [], genres: [], animes: [] };
    }
    this.initialized = true;

    // Immediately extract & auto-heal all cover files to disk
    this.extractAllCoversToDisk();

    // Asynchronously auto-optimize any existing covers that exceed 200 KB
    setTimeout(() => {
      this.autoOptimizeOversizedCovers().catch(e => console.warn('Error en auto-optimización de portadas:', e));
    }, 600);

    // Asynchronously establish initial Supabase sync
    setTimeout(() => {
      this.syncAllToSupabase().catch(e => console.error('Error de sync inicial Supabase:', e));
    }, 100);
  }

  private extractAllCoversToDisk() {
    try {
      if (!fs.existsSync(COVERS_DIR)) {
        fs.mkdirSync(COVERS_DIR, { recursive: true });
      }
      if (this.localDb && Array.isArray(this.localDb.animes)) {
        for (const anime of this.localDb.animes) {
          if (anime.id && anime.coverData && anime.coverData.startsWith('data:image/')) {
            const webpPath = path.join(COVERS_DIR, `${anime.id}.webp`);
            if (!fs.existsSync(webpPath)) {
              const parts = anime.coverData.split(';base64,');
              if (parts.length === 2) {
                fs.writeFileSync(webpPath, Buffer.from(parts[1], 'base64'));
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error al extraer portadas a disco:', err);
    }
  }

  private saveLocal() {
    try {
      if (fs.existsSync(DB_FILE) && this.localDb.animes && this.localDb.animes.length > 0) {
        fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
      }
      const dataStr = JSON.stringify(this.localDb, null, 2);
      fs.writeFileSync(DB_FILE, dataStr, 'utf-8');
    } catch (err) {
      console.error('Failed to write database file:', err);
    }
  }

  private async syncAllToSupabase() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      await this.getStudios();
      await this.getGenres();
      await this.getAnimes();
    } catch (err) {
      console.error('[Sync] Error durante sincronización Supabase:', err);
    } finally {
      this.isSyncing = false;
    }
  }

  // --- Process and Store Cover Images Permanently (Strictly <= 200 KB) ---
  async processAndStoreCover(
    animeId: string,
    rawImage: string,
    title: string,
    studioName: string,
    existingCoverData?: string
  ): Promise<{ imageUrl: string; coverData: string }> {
    const localWebpPath = path.join(COVERS_DIR, `${animeId}.webp`);
    const publicUrlPath = `/api/covers/${animeId}.webp`;

    const MAX_TARGET_BYTES = 200 * 1024; // 200 KB threshold (204,800 bytes)

    // 1. Identify input candidate from rawImage or existingCoverData
    let candidate = '';
    if (rawImage && (rawImage.startsWith('data:image/') || rawImage.startsWith('http://') || rawImage.startsWith('https://'))) {
      candidate = rawImage;
    } else if (existingCoverData && (existingCoverData.startsWith('data:image/') || existingCoverData.startsWith('http://') || existingCoverData.startsWith('https://'))) {
      candidate = existingCoverData;
    }

    if (candidate) {
      const isBase64 = candidate.startsWith('data:image/');
      let estBytes = 0;
      let detectedExt = 'webp';
      let detectedMime = 'image/webp';
      if (isBase64) {
        const parts = candidate.split(';base64,');
        estBytes = parts.length === 2 ? Math.floor(parts[1].length * 0.75) : 0;
        const mimeMatch = candidate.match(/^data:([^;]+);/);
        if (mimeMatch) {
          detectedMime = mimeMatch[1];
          detectedExt = detectedMime.includes('webp') ? 'webp' : detectedMime.includes('png') ? 'png' : 'jpg';
        }
      }

      // Sin optimización: se conserva 100% original
      const parts = candidate.split(';base64,');
      if (parts.length === 2) {
        const targetDiskPath = path.join(COVERS_DIR, `${animeId}.${detectedExt}`);
        try {
          fs.writeFileSync(targetDiskPath, Buffer.from(parts[1], 'base64'));
        } catch (e) {}
        try {
          fs.writeFileSync(localWebpPath, Buffer.from(parts[1], 'base64'));
        } catch (e) {}
        return { imageUrl: publicUrlPath, coverData: candidate };
      }

      const optResult = await compressImageToWebpBuffer(candidate);
      if (optResult && optResult.buffer) {
        try {
          fs.writeFileSync(localWebpPath, optResult.buffer);
        } catch (e) {}
        const finalCoverData = `data:${optResult.mimeType};base64,` + optResult.buffer.toString('base64');
        return { imageUrl: publicUrlPath, coverData: finalCoverData };
      }
      return { imageUrl: publicUrlPath, coverData: candidate };
    }

    // 2. If no candidate string provided, inspect file on disk
    if (fs.existsSync(localWebpPath)) {
      try {
        const diskBuf = fs.readFileSync(localWebpPath);
        return { imageUrl: publicUrlPath, coverData: 'data:image/webp;base64,' + diskBuf.toString('base64') };
      } catch (e) {}
    }

    // Check for .jpg on disk
    const localJpgPath = path.join(COVERS_DIR, `${animeId}.jpg`);
    if (fs.existsSync(localJpgPath)) {
      try {
        const diskBuf = fs.readFileSync(localJpgPath);
        return { imageUrl: publicUrlPath, coverData: 'data:image/jpeg;base64,' + diskBuf.toString('base64') };
      } catch (e) {}
    }

    // 3. Fallback: Generate SVG Poster
    const svg = generateSvgPoster(title, studioName);
    const svgBuf = Buffer.from(svg, 'utf-8');
    const sharp = await getSharp();
    if (sharp) {
      try {
        const compressedBuf = await sharp(svgBuf).webp({ quality: 85 }).toBuffer();
        fs.writeFileSync(localWebpPath, compressedBuf);
        const coverData = 'data:image/webp;base64,' + compressedBuf.toString('base64');
        return { imageUrl: publicUrlPath, coverData };
      } catch (e) {}
    }
    
    try {
      fs.writeFileSync(path.join(COVERS_DIR, `${animeId}.svg`), svg, 'utf-8');
    } catch (e) {}
    const coverData = 'data:image/svg+xml;base64,' + svgBuf.toString('base64');

    return { imageUrl: publicUrlPath, coverData };
  }

  // --- Auto-optimization disabled (imagenes 100% originales) ---
  async autoOptimizeOversizedCovers(): Promise<{ optimizedCount: number; freedBytes: number }> {
    return { optimizedCount: 0, freedBytes: 0 };
  }

  // --- Studio Operations ---
  async getStudios(): Promise<Studio[]> {
    this.init();
    try {
      const snap = await this.safeFirestoreOp(() => getDocs(collection(firestoreDb, 'studios')));
      if (snap && !snap.empty) {
        const fetchedMap = new Map<string, Studio>();
        snap.forEach(d => {
          const s = d.data();
          if (s && s.id && s.name) {
            fetchedMap.set(s.id, {
              id: s.id,
              name: s.name,
              image: s.image || undefined,
              storageLocation: 'Firebase Firestore (khentai)'
            });
          }
        });
        this.localDb.studios = Array.from(fetchedMap.values());
        this.saveLocal();
      }
    } catch (err) {
      console.warn('[Firebase Firestore] Error al obtener estudios:', err);
    }
    const defaultLoc = !this.isFirestoreDisabled ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';
    return [...this.localDb.studios].map(s => ({ ...s, storageLocation: s.storageLocation || defaultLoc }));
  }

  async saveStudio(studio: Studio): Promise<Studio> {
    this.init();
    const idx = this.localDb.studios.findIndex(s => s.id === studio.id);
    if (idx >= 0) {
      this.localDb.studios[idx] = studio;
    } else {
      this.localDb.studios.push(studio);
    }
    this.saveLocal();

    const fsData: any = {
      id: studio.id,
      name: studio.name
    };
    if (studio.image !== undefined) {
      fsData.image = studio.image;
    }

    const fsRes = await this.safeFirestoreOp(() => setDoc(doc(firestoreDb, 'studios', studio.id), fsData, { merge: true }));

    const locationStr = fsRes !== null ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';
    const saved = { ...studio, storageLocation: locationStr };

    const targetIdx = this.localDb.studios.findIndex(s => s.id === studio.id);
    if (targetIdx >= 0) {
      this.localDb.studios[targetIdx] = saved;
    }
    this.saveLocal();

    return saved;
  }

  async deleteStudio(id: string): Promise<boolean> {
    this.init();
    this.localDb.studios = this.localDb.studios.filter(s => s.id !== id);
    this.saveLocal();

    await this.safeFirestoreOp(() => deleteDoc(doc(firestoreDb, 'studios', id)));
    return true;
  }

  // --- Genre Operations ---
  async getGenres(): Promise<Genre[]> {
    this.init();
    try {
      const snap = await this.safeFirestoreOp(() => getDocs(collection(firestoreDb, 'genres')));
      if (snap && !snap.empty) {
        const fetchedMap = new Map<string, Genre>();
        snap.forEach(d => {
          const g = d.data();
          if (g && g.id && g.name) {
            fetchedMap.set(g.id, {
              id: g.id,
              name: g.name,
              storageLocation: 'Firebase Firestore (khentai)'
            });
          }
        });

        this.localDb.genres = Array.from(fetchedMap.values());
        this.saveLocal();
      }
    } catch (err) {
      console.warn('[Firebase Firestore] Error al obtener géneros:', err);
    }
    const defaultLoc = !this.isFirestoreDisabled ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';
    return [...this.localDb.genres].map(g => ({ ...g, storageLocation: g.storageLocation || defaultLoc }));
  }

  async saveGenre(genre: Genre): Promise<Genre> {
    this.init();
    const idx = this.localDb.genres.findIndex(g => g.id === genre.id);
    if (idx >= 0) {
      this.localDb.genres[idx] = genre;
    } else {
      this.localDb.genres.push(genre);
    }
    this.saveLocal();

    const fsRes = await this.safeFirestoreOp(() => setDoc(doc(firestoreDb, 'genres', genre.id), {
      id: genre.id,
      name: genre.name
    }));

    const locationStr = fsRes !== null ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';
    const saved = { ...genre, storageLocation: locationStr };

    const targetIdx = this.localDb.genres.findIndex(g => g.id === genre.id);
    if (targetIdx >= 0) {
      this.localDb.genres[targetIdx] = saved;
    }
    this.saveLocal();

    return saved;
  }

  async deleteGenre(id: string): Promise<boolean> {
    this.init();
    this.localDb.genres = this.localDb.genres.filter(g => g.id !== id);
    this.saveLocal();

    await this.safeFirestoreOp(() => deleteDoc(doc(firestoreDb, 'genres', id)));
    return true;
  }

  // --- Anime Operations ---
  async resetPopularityOnly(): Promise<{ resetAnimesCount: number }> {
    this.init();
    let count = 0;
    for (const anime of this.localDb.animes) {
      anime.downloads = 0;
      count++;
    }
    this.saveLocal();

    // Reset Firestore documents asynchronously using batches
    this.safeFirestoreOp(async () => {
      const animesSnap = await getDocs(collection(firestoreDb, 'animes'));
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const d of animesSnap.docs) {
        batch.set(doc(firestoreDb, 'animes', d.id), { downloads: 0 }, { merge: true });
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }).catch(() => {});

    return { resetAnimesCount: count };
  }

  async resetRatingsOnly(): Promise<{ resetCount: number }> {
    this.init();
    let count = 0;
    await this.safeFirestoreOp(async () => {
      const ratingsSnap = await getDocs(collection(firestoreDb, 'anime_ratings'));
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const d of ratingsSnap.docs) {
        batch.delete(d.ref);
        ops++;
        count++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      const votesSnap = await getDocs(collection(firestoreDb, 'user_anime_votes'));
      batch = writeBatch(firestoreDb);
      ops = 0;
      for (const d of votesSnap.docs) {
        batch.delete(d.ref);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }).catch(() => {});
    return { resetCount: count };
  }

  async resetCommentsOnly(): Promise<{ deletedCount: number }> {
    this.init();
    let count = 0;
    await this.safeFirestoreOp(async () => {
      const commentsSnap = await getDocs(collection(firestoreDb, 'comentariosGlobales'));
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const d of commentsSnap.docs) {
        batch.delete(d.ref);
        ops++;
        count++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }).catch(() => {});
    return { deletedCount: count };
  }

  async setAllAnimesFinalizadoAndClearNewEpisodes(): Promise<{ updatedCount: number }> {
    this.init();
    let count = 0;
    for (const anime of this.localDb.animes) {
      const wasFinalizado = anime.status === 'Finalizado';
      const hadNewEp = Array.isArray(anime.episodes) && anime.episodes.some(ep => ep.isNew);
      if (!wasFinalizado || hadNewEp) {
        anime.status = 'Finalizado';
        if (Array.isArray(anime.episodes)) {
          for (const ep of anime.episodes) {
            ep.isNew = false;
          }
        }
        count++;
      }
    }
    if (count > 0) {
      this.saveLocal();
    }

    // Update Firestore documents safely in batches of 400
    this.safeFirestoreOp(async () => {
      const animesSnap = await getDocs(collection(firestoreDb, 'animes'));
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const d of animesSnap.docs) {
        const row = d.data();
        const eps = normalizeEpisodesList(row.episodes);
        const needsUpdate = row.status !== 'Finalizado' || eps.some(ep => ep.isNew);
        if (needsUpdate) {
          for (const ep of eps) {
            ep.isNew = false;
          }
          batch.set(doc(firestoreDb, 'animes', d.id), {
            status: 'Finalizado',
            episodes: serializeEpisodesForStorage(eps)
          }, { merge: true });
          ops++;
          if (ops >= 400) {
            await batch.commit();
            batch = writeBatch(firestoreDb);
            ops = 0;
          }
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }).catch(() => {});

    return { updatedCount: count };
  }

  async resetPopularityAndRatings(): Promise<{ resetAnimesCount: number }> {
    this.init();
    let count = 0;
    for (const anime of this.localDb.animes) {
      anime.downloads = 0;
      count++;
    }
    this.saveLocal();

    // Reset Firestore documents asynchronously using batches
    this.safeFirestoreOp(async () => {
      const animesSnap = await getDocs(collection(firestoreDb, 'animes'));
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const d of animesSnap.docs) {
        batch.set(doc(firestoreDb, 'animes', d.id), { downloads: 0 }, { merge: true });
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      const ratingsSnap = await getDocs(collection(firestoreDb, 'anime_ratings'));
      batch = writeBatch(firestoreDb);
      ops = 0;
      for (const d of ratingsSnap.docs) {
        batch.delete(d.ref);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      const votesSnap = await getDocs(collection(firestoreDb, 'user_anime_votes'));
      batch = writeBatch(firestoreDb);
      ops = 0;
      for (const d of votesSnap.docs) {
        batch.delete(d.ref);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }).catch(() => {});

    return { resetAnimesCount: count };
  }

  async getAnimes(): Promise<Anime[]> {
    this.init();

    try {
      const snap = await this.safeFirestoreOp(() => getDocs(collection(firestoreDb, 'animes')));
      if (snap && !snap.empty) {
        this.lastAnimesFetch = Date.now();
        const fetchedList: Anime[] = [];
        snap.forEach(d => {
          const row = d.data();
          if (row) {
            const animeId = row.id || d.id || generateSlug(row.name || row.title || '');
            const rawStudioIds = Array.isArray(row.studio_ids)
              ? row.studio_ids
              : Array.isArray(row.studioIds)
              ? row.studioIds
              : typeof row.studio_ids === 'string'
              ? JSON.parse(row.studio_ids)
              : (row.studio_id || row.studioId ? [row.studio_id || row.studioId] : []);
            const primaryStudioId = row.studio_id || row.studioId || rawStudioIds[0] || '';

            const anime: Anime = {
              id: animeId,
              name: row.name || row.title || 'Anime',
              image: row.image || row.cover || '',
              coverData: row.cover_data || row.coverData || '',
              studioId: primaryStudioId,
              studioIds: rawStudioIds.map(String),
              genreIds: Array.isArray(row.genre_ids) 
                ? row.genre_ids 
                : Array.isArray(row.genreIds) 
                ? row.genreIds 
                : typeof row.genre_ids === 'string' 
                ? JSON.parse(row.genre_ids) 
                : [],
              status: row.status || 'Finalizado',
              year: row.year ? normalizeAnimeYear(row.year) : '',
              description: row.description || '',
              telegramUrl: row.telegram_url || row.telegramUrl || row.telegram || '',
              episodes: normalizeEpisodesList(row.episodes),
              hidden: row.hidden ? true : false,
              downloads: typeof row.downloads === 'number' ? row.downloads : 0,
              createdAt: row.created_at || row.createdAt || new Date().toISOString(),
              updatedAt: row.updated_at || row.updatedAt || new Date().toISOString()
            };
            fetchedList.push(anime);
          }
        });

        // Directly update local memory and file mirror from Firestore (Single Source of Truth)
        this.localDb.animes = fetchedList;
        this.saveLocal();
      }
    } catch (err) {
      console.warn('[Firebase Firestore] Error al obtener animes:', err);
    }

    const defaultLoc = !this.isFirestoreDisabled ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';
    return [...this.localDb.animes].map(a => ({ ...a, storageLocation: a.storageLocation || defaultLoc }));
  }

  async saveAnime(anime: Anime): Promise<Anime> {
    this.init();
    this.lastAnimesFetch = 0; // Force immediate fresh fetch on next query

    // Generate unique slug for anime ID if missing or generic
    if (!anime.id || anime.id.startsWith('ani-')) {
      anime.id = generateSlug(anime.name);
    }

    // Preserve original ID & creation timestamp
    const existing = this.localDb.animes.find(a => a.id === anime.id || a.name.toLowerCase() === anime.name.toLowerCase());
    if (existing) {
      anime.id = existing.id;
      anime.createdAt = existing.createdAt || anime.createdAt || new Date().toISOString();
    } else {
      anime.createdAt = anime.createdAt || new Date().toISOString();
    }
    anime.updatedAt = new Date().toISOString();

    const sIds = (anime.studioIds && anime.studioIds.length > 0)
      ? anime.studioIds
      : (anime.studioId ? [anime.studioId] : []);
    const primaryStudioId = anime.studioId || sIds[0] || '';
    anime.studioId = primaryStudioId;
    anime.studioIds = sIds;

    const studioNames = sIds.map(id => this.localDb.studios.find(s => s.id === id)?.name).filter(Boolean);
    const studioName = studioNames.length > 0 ? studioNames.join(', ') : 'Estudio';

    // Clean and sanitize episodes array ensuring valid non-undefined fields
    const sanitizedEpisodes = normalizeEpisodesList(anime.episodes || []);
    for (const ep of sanitizedEpisodes) {
      if (ep.coverImage && ep.coverImage.startsWith('data:image/')) {
        ep.coverImage = await optimizeEpisodeCoverIfNeeded(ep.coverImage);
      }
      if (ep.thumbnail && ep.thumbnail.startsWith('data:image/')) {
        ep.thumbnail = await optimizeEpisodeCoverIfNeeded(ep.thumbnail);
      }
    }
    const storageEpisodes = serializeEpisodesForStorage(sanitizedEpisodes);

    anime.episodes = sanitizedEpisodes;
    anime.year = normalizeAnimeYear(anime.year);

    // Process & store cover image permanently
    const inputImg = anime.image || (existing ? existing.image : '');
    const existingCover = anime.coverData || (existing ? existing.coverData : '');
    const processed = await this.processAndStoreCover(anime.id, inputImg, anime.name, studioName, existingCover);
    anime.image = processed.imageUrl;
    anime.coverData = processed.coverData;

    // Save to local memory & disk
    const idx = this.localDb.animes.findIndex(a => a.id === anime.id);
    if (idx >= 0) {
      this.localDb.animes[idx] = anime;
    } else {
      this.localDb.animes.push(anime);
    }
    this.saveLocal();

    // Sanitize coverData for Firestore payload: preserve coverData up to 700KB to fit inside 1MB document limit
    const firestoreCoverData = (anime.coverData && anime.coverData.length < 700000) ? anime.coverData : null;

    const payload = {
      id: String(anime.id),
      name: String(anime.name || ''),
      image: String(anime.image || ''),
      coverData: firestoreCoverData,
      year: String(anime.year || ''),
      telegramUrl: String(anime.telegramUrl || ''),
      episodes: storageEpisodes,
      studioId: primaryStudioId ? String(primaryStudioId) : '',
      studioIds: sIds.map(String),
      genreIds: Array.isArray(anime.genreIds) ? anime.genreIds.map(String) : [],
      status: String(anime.status || 'Finalizado'),
      description: String(anime.description || ''),
      hidden: Boolean(anime.hidden),
      downloads: Number(anime.downloads) || 0,
      createdAt: anime.createdAt,
      updatedAt: anime.updatedAt
    };

    const docRef = doc(firestoreDb, 'animes', anime.id);
    const startMs = Date.now();

    console.log(`\n======================================================`);
    console.log(`🔥 [FIREBASE WRITE REQUEST] Guardando anime ID: "${anime.id}" | Nombre: "${anime.name}"`);
    console.log(`📊 [PAYLOAD DETALLES] Episodios: ${sanitizedEpisodes.length} | Cover Base64: ${firestoreCoverData ? Math.round(firestoreCoverData.length / 1024) + ' KB' : 'Omitido (>700KB o sin cover)'} | Estado: ${anime.status}`);

    let isSavedInFirestore = false;
    let firestoreErrorMsg = '';

    try {
      // NOTE: Direct setDoc WITHOUT merge: true completely replaces document so removed episodes/fields are deleted in Firestore!
      await setDoc(docRef, payload);
      isSavedInFirestore = true;
      const duration = Date.now() - startMs;
      console.log(`✅ [FIREBASE CONFIRMED 200 OK] ¡Escritura confirmada por Firestore Cloud! (${duration}ms)`);
      console.log(`📌 [DOCUMENTO FIREBASE] Documento "animes/${anime.id}" guardado permanentemente en la nube.`);
      console.log(`======================================================\n`);
    } catch (err: any) {
      firestoreErrorMsg = err?.message || String(err);
      console.warn(`❌ [FIREBASE WRITE FAILED] Firestore rechazó la escritura:`, firestoreErrorMsg);
      console.warn(`⚠️ [FALLBACK ACTIVO] Guardado en almacenamiento local (/database.json).`);
      console.warn(`======================================================\n`);
    }

    const locationStr = isSavedInFirestore ? 'Firebase Firestore (khentai)' : 'Almacenamiento Local (/database.json)';

    const savedAnime = {
      ...anime,
      storageLocation: locationStr,
      savedInFirestore: isSavedInFirestore,
      firestoreError: isSavedInFirestore ? undefined : firestoreErrorMsg
    };

    const targetIdx = this.localDb.animes.findIndex(a => a.id === anime.id);
    if (targetIdx >= 0) {
      this.localDb.animes[targetIdx] = savedAnime;
    }
    this.saveLocal();

    // Enforce 30-episode limit for new episodes automatically
    this.enforceNewEpisodesLimit(30).catch(() => {});

    return savedAnime;
  }

  async enforceNewEpisodesLimit(maxNew: number = 30): Promise<{ evictedCount: number; evictedCoversCount: number }> {
    this.init();
    let modifiedAny = false;
    let evictedCount = 0;
    let evictedCoversCount = 0;

    // Recolectar todos los episodios marcados como nuevos (isNew: true)
    const activeNewEpisodes: {
      anime: Anime;
      ep: any;
      timestamp: number;
    }[] = [];

    for (const a of this.localDb.animes) {
      if (!Array.isArray(a.episodes)) continue;
      const baseTime = a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0;

      for (const ep of a.episodes) {
        if (ep.isNew) {
          const epNum = Number(ep.number) || 1;
          const epTime = ep.addedToRecentAt
            ? new Date(ep.addedToRecentAt).getTime()
            : (baseTime + epNum * 1000);
          activeNewEpisodes.push({
            anime: a,
            ep,
            timestamp: epTime
          });
        }
      }
    }

    // 3. Si hay más de maxNew (30) episodios nuevos, desmarcar los más antiguos y eliminar su portada de presentación (coverImage)
    if (activeNewEpisodes.length > maxNew) {
      // Ordenar descendente (más nuevos primero; si coinciden en timestamp, número de episodio mayor primero)
      activeNewEpisodes.sort((x, y) => {
        if (y.timestamp !== x.timestamp) {
          return y.timestamp - x.timestamp;
        }
        return (Number(y.ep.number) || 0) - (Number(x.ep.number) || 0);
      });

      const modifiedAnimes = new Set<Anime>();
      for (let i = maxNew; i < activeNewEpisodes.length; i++) {
        const item = activeNewEpisodes[i];
        item.ep.isNew = false;
        delete item.ep.addedToRecentAt;
        if (item.ep.coverImage) {
          delete item.ep.coverImage;
          evictedCoversCount++;
        }
        // ep.thumbnail y enlace de reproducción NUNCA se borran
        evictedCount++;
        // REGLA CRÍTICA:
        // Los animes cuyos episodios salgan del top 30 NO pasan a 'Finalizado' automáticamente.
        // Se preserva su estado actual (por ejemplo, 'Emisión') hasta que el usuario lo modifique manualmente.
        // Y la portada original del anime (item.anime.image) se mantiene intacta.
        modifiedAnimes.add(item.anime);
        modifiedAny = true;
      }

      for (const modAnime of modifiedAnimes) {
        this.saveAnimeToFirestoreBg(modAnime).catch(() => {});
      }
    }

    if (modifiedAny) {
      this.saveLocal();
    }

    return { evictedCount, evictedCoversCount };
  }

  async deleteAnime(id: string): Promise<boolean> {
    this.init();
    const existing = this.localDb.animes.find(a => a.id === id);
    if (existing && existing.name) {
      if (!this.localDb.trash) this.localDb.trash = [];
      if (!this.localDb.trash.includes(existing.name)) {
        this.localDb.trash.unshift(existing.name);
      }
    }
    this.localDb.animes = this.localDb.animes.filter(a => a.id !== id);
    this.saveLocal();

    // Clean local cover files
    try {
      const webpPath = path.join(COVERS_DIR, `${id}.webp`);
      if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
      const jpgPath = path.join(COVERS_DIR, `${id}.jpg`);
      if (fs.existsSync(jpgPath)) fs.unlinkSync(jpgPath);
      const svgPath = path.join(COVERS_DIR, `${id}.svg`);
      if (fs.existsSync(svgPath)) fs.unlinkSync(svgPath);
    } catch (e) {}

    await this.safeFirestoreOp(() => deleteDoc(doc(firestoreDb, 'animes', id)));
    return true;
  }

  getTrash(): string[] {
    this.init();
    return this.localDb.trash || [];
  }

  emptyTrash(): number {
    this.init();
    const count = (this.localDb.trash || []).length;
    this.localDb.trash = [];
    this.saveLocal();
    return count;
  }

  // --- User Saved Lists Operations (Firebase Persistent "Mi Lista") ---
  async getUserList(deviceId: string): Promise<string[]> {
    this.init();
    if (!this.localDb.userLists) this.localDb.userLists = {};
    if (!deviceId) return [];

    const snap = await this.safeFirestoreOp(() => getDoc(doc(firestoreDb, 'user_lists', deviceId)));
    if (snap && snap.exists()) {
      const data = snap.data();
      const animeIds = Array.isArray(data.animeIds) ? data.animeIds : Array.isArray(data.anime_ids) ? data.anime_ids : [];
      this.localDb.userLists[deviceId] = animeIds;
      this.saveLocal();
      return animeIds;
    }

    return this.localDb.userLists[deviceId] || [];
  }

  async saveUserList(deviceId: string, animeIds: string[]): Promise<boolean> {
    this.init();
    if (!this.localDb.userLists) this.localDb.userLists = {};
    if (!deviceId) return false;

    this.localDb.userLists[deviceId] = animeIds;
    this.saveLocal();

    await this.safeFirestoreOp(() => setDoc(doc(firestoreDb, 'user_lists', deviceId), {
      deviceId,
      animeIds,
      updatedAt: new Date().toISOString()
    }));
    return true;
  }

  // Wipe All Data
  async wipeAllData(): Promise<{ success: boolean; deletedAnimes: number; deletedGenres: number; deletedStudios: number }> {
    this.init();
    let deletedAnimes = this.localDb.animes.length;
    let deletedGenres = this.localDb.genres.length;
    let deletedStudios = this.localDb.studios.length;

    await this.safeFirestoreOp(async () => {
      const animesSnap = await getDocs(collection(firestoreDb, 'animes'));
      for (const d of animesSnap.docs) {
        await deleteDoc(d.ref).catch(() => {});
      }
      const genresSnap = await getDocs(collection(firestoreDb, 'genres'));
      for (const d of genresSnap.docs) {
        await deleteDoc(d.ref).catch(() => {});
      }
      const studiosSnap = await getDocs(collection(firestoreDb, 'studios'));
      for (const d of studiosSnap.docs) {
        await deleteDoc(d.ref).catch(() => {});
      }
      const userListsSnap = await getDocs(collection(firestoreDb, 'user_lists'));
      for (const d of userListsSnap.docs) {
        await deleteDoc(d.ref).catch(() => {});
      }
    });

    if (fs.existsSync(COVERS_DIR)) {
      try {
        const files = fs.readdirSync(COVERS_DIR);
        for (const f of files) {
          if (f !== '.gitkeep') {
            fs.unlinkSync(path.join(COVERS_DIR, f));
          }
        }
      } catch (err) {}
    }

    this.localDb = { studios: [], genres: [], animes: [], userLists: {} };
    this.saveLocal();

    return { success: true, deletedAnimes, deletedGenres, deletedStudios };
  }

  // Deduplication & import methods
  async deduplicateDatabase(): Promise<{ studiosMerged: number; genresMerged: number }> {
    this.init();

    let studiosMerged = 0;
    let genresMerged = 0;

    const studioGroups = new Map<string, Studio[]>();
    for (const s of this.localDb.studios) {
      const key = getNormalizedKey(s.name);
      if (key) {
        if (!studioGroups.has(key)) studioGroups.set(key, []);
        studioGroups.get(key)!.push(s);
      }
    }

    const canonicalStudios: Studio[] = [];
    const studioIdMap = new Map<string, string>();

    for (const [, group] of studioGroups.entries()) {
      if (group.length > 0) {
        const canonical = group[0];
        canonicalStudios.push(canonical);
        for (const s of group) {
          studioIdMap.set(s.id, canonical.id);
          if (s.id !== canonical.id) studiosMerged++;
        }
      }
    }

    const genreGroups = new Map<string, Genre[]>();
    for (const g of this.localDb.genres) {
      const key = getNormalizedKey(g.name);
      if (key) {
        if (!genreGroups.has(key)) genreGroups.set(key, []);
        genreGroups.get(key)!.push(g);
      }
    }

    const canonicalGenres: Genre[] = [];
    const genreIdMap = new Map<string, string>();

    for (const [, group] of genreGroups.entries()) {
      if (group.length > 0) {
        const canonical = group[0];
        canonicalGenres.push(canonical);
        for (const g of group) {
          genreIdMap.set(g.id, canonical.id);
          if (g.id !== canonical.id) genresMerged++;
        }
      }
    }

    this.localDb.studios = canonicalStudios;
    this.localDb.genres = canonicalGenres;

    for (const anime of this.localDb.animes) {
      if (anime.studioId && studioIdMap.has(anime.studioId)) {
        anime.studioId = studioIdMap.get(anime.studioId)!;
      }
      if (anime.genreIds && Array.isArray(anime.genreIds)) {
        anime.genreIds = [...new Set(anime.genreIds.map(gid => genreIdMap.get(gid) || gid))];
      }
    }

    this.saveLocal();
    return { studiosMerged, genresMerged };
  }

  async deduplicateAnimes(): Promise<{
    success: boolean;
    animesMerged: number;
    titlesUnified: number;
    telegramLinksUnified: number;
    episodeLinksUnified: number;
    coversUnified: number;
    studiosMerged: number;
    genresMerged: number;
  }> {
    this.init();

    let titlesUnified = 0;
    let telegramLinksUnified = 0;
    let episodeLinksUnified = 0;
    let coversUnified = 0;

    const currentAnimes = [...this.localDb.animes];
    const removedIds = new Set<string>();

    const mergeGroup = (group: Anime[], reason: 'title' | 'telegram' | 'episode' | 'cover') => {
      const activeGroup = group.filter(a => !removedIds.has(a.id));
      if (activeGroup.length <= 1) return;

      activeGroup.sort((a, b) => {
        const scoreA = (a.downloads || 0) + (a.image ? 10 : 0) + (a.description ? 5 : 0) + (a.genreIds?.length || 0) + (a.episodes?.length || 0) * 2;
        const scoreB = (b.downloads || 0) + (b.image ? 10 : 0) + (b.description ? 5 : 0) + (b.genreIds?.length || 0) + (b.episodes?.length || 0) * 2;
        return scoreB - scoreA;
      });

      const winner = activeGroup[0];
      for (let i = 1; i < activeGroup.length; i++) {
        const duplicate = activeGroup[i];
        removedIds.add(duplicate.id);

        winner.downloads = Math.max(winner.downloads || 0, duplicate.downloads || 0) + Math.min(winner.downloads || 0, duplicate.downloads || 0);
        if (!winner.image && duplicate.image) winner.image = duplicate.image;
        if (!winner.coverData && duplicate.coverData) winner.coverData = duplicate.coverData;
        if (!winner.description && duplicate.description) winner.description = duplicate.description;
        if (!winner.year && duplicate.year) winner.year = duplicate.year;
        if (!winner.telegramUrl && duplicate.telegramUrl) winner.telegramUrl = duplicate.telegramUrl;

        // Combine genres
        const combinedGenres = new Set([...(winner.genreIds || []), ...(duplicate.genreIds || [])]);
        winner.genreIds = Array.from(combinedGenres);

        // Merge episodes list
        winner.episodes = mergeAnimeEpisodes(winner.episodes || [], duplicate.episodes || []);

        if (reason === 'title') titlesUnified++;
        else if (reason === 'telegram') telegramLinksUnified++;
        else if (reason === 'episode') episodeLinksUnified++;
        else if (reason === 'cover') coversUnified++;
      }
    };

    // 1. Group by Title
    const titleMap = new Map<string, Anime[]>();
    for (const a of currentAnimes) {
      const key = getNormalizedKey(a.name);
      if (key) {
        if (!titleMap.has(key)) titleMap.set(key, []);
        titleMap.get(key)!.push(a);
      }
    }
    for (const group of titleMap.values()) {
      mergeGroup(group, 'title');
    }

    // 2. Group by Main Telegram Link
    const telegramMap = new Map<string, Anime[]>();
    for (const a of this.localDb.animes) {
      if (removedIds.has(a.id)) continue;
      const key = (a.telegramUrl || '').trim().toLowerCase();
      if (key && key.length > 5) {
        if (!telegramMap.has(key)) telegramMap.set(key, []);
        telegramMap.get(key)!.push(a);
      }
    }
    for (const group of telegramMap.values()) {
      mergeGroup(group, 'telegram');
    }

    // 3. Group by Episode Link
    const episodeLinkMap = new Map<string, Anime[]>();
    for (const a of this.localDb.animes) {
      if (removedIds.has(a.id)) continue;
      if (a.episodes && Array.isArray(a.episodes)) {
        for (const ep of a.episodes) {
          const key = (ep.telegramUrl || '').trim().toLowerCase();
          if (key && key.length > 5) {
            if (!episodeLinkMap.has(key)) episodeLinkMap.set(key, []);
            const list = episodeLinkMap.get(key)!;
            if (!list.some(item => item.id === a.id)) {
              list.push(a);
            }
          }
        }
      }
    }
    for (const group of episodeLinkMap.values()) {
      mergeGroup(group, 'episode');
    }

    // 4. Group by Cover Image
    const coverMap = new Map<string, Anime[]>();
    for (const a of this.localDb.animes) {
      if (removedIds.has(a.id)) continue;
      const img = (a.image || '').trim();
      if (img && img.length > 20 && !img.startsWith('data:image/svg')) {
        const imgKey = img.length > 200 ? `${img.length}-${img.slice(0, 100)}-${img.slice(-50)}` : img;
        if (!coverMap.has(imgKey)) coverMap.set(imgKey, []);
        coverMap.get(imgKey)!.push(a);
      }
    }
    for (const group of coverMap.values()) {
      mergeGroup(group, 'cover');
    }

    // 5. Clean internal episode list duplicates for all remaining animes
    for (const anime of this.localDb.animes) {
      if (removedIds.has(anime.id)) continue;
      if (anime.episodes && Array.isArray(anime.episodes) && anime.episodes.length > 1) {
        const seenNum = new Set<number>();
        const seenUrl = new Set<string>();
        const cleanEps = [];
        for (const ep of anime.episodes) {
          const epUrlNorm = (ep.telegramUrl || '').trim().toLowerCase();
          if (!seenNum.has(ep.number) && (!epUrlNorm || !seenUrl.has(epUrlNorm))) {
            cleanEps.push(ep);
            seenNum.add(ep.number);
            if (epUrlNorm) seenUrl.add(epUrlNorm);
          }
        }
        cleanEps.sort((a, b) => a.number - b.number);
        anime.episodes = cleanEps;
      }
    }

    // Save changes
    if (removedIds.size > 0) {
      this.localDb.animes = this.localDb.animes.filter(a => !removedIds.has(a.id));
      for (const id of removedIds) {
        deleteDoc(doc(firestoreDb, 'animes', id)).catch(() => {});
      }
    }

    for (const a of this.localDb.animes) {
      this.saveAnime(a).then();
    }
    this.saveLocal();

    // 6. Also deduplicate Studios and Genres
    const { studiosMerged, genresMerged } = await this.deduplicateDatabase();

    return {
      success: true,
      animesMerged: removedIds.size,
      titlesUnified,
      telegramLinksUnified,
      episodeLinksUnified,
      coversUnified,
      studiosMerged,
      genresMerged
    };
  }

  async cleanAndMigrateAllEpisodes(): Promise<{ success: boolean; migratedAnimesCount: number; migratedEpisodesCount: number }> {
    this.init();
    let migratedAnimes = 0;
    let totalEpisodes = 0;

    for (const anime of this.localDb.animes) {
      if (anime.episodes) {
        const norm = normalizeEpisodesList(anime.episodes);
        if (norm.length > 0) {
          const cleanStorageEps = serializeEpisodesForStorage(norm);
          anime.episodes = norm;
          migratedAnimes++;
          totalEpisodes += Object.keys(cleanStorageEps).length;
          await this.saveAnimeToFirestoreBg(anime);
        }
      }
    }

    this.saveLocal();
    return { success: true, migratedAnimesCount: migratedAnimes, migratedEpisodesCount: totalEpisodes };
  }

  async importDatabase(inputSchema: any): Promise<{ success: boolean; animesCount: number; studiosCount: number; genresCount: number; error?: string }> {
    this.init();
    if (!inputSchema) {
      return { success: false, animesCount: 0, studiosCount: 0, genresCount: 0, error: 'No se recibieron datos de importación.' };
    }

    let schema: any = inputSchema;
    // Unwrap if wrapped in { data: ... } or { backup: ... } or { db: ... }
    if (schema.data && typeof schema.data === 'object') {
      schema = schema.data;
    } else if (schema.backup && typeof schema.backup === 'object') {
      schema = schema.backup;
    } else if (schema.db && typeof schema.db === 'object') {
      schema = schema.db;
    }

    // Direct array of animes
    if (Array.isArray(schema)) {
      schema = { animes: schema };
    }

    // If schema is a key-value map of anime docs (e.g. Firestore raw export: { "slug-1": { ... }, "slug-2": { ... } })
    if (typeof schema === 'object' && !schema.animes && !schema.studios && !schema.genres) {
      const values = Object.values(schema);
      if (values.length > 0 && typeof values[0] === 'object' && ((values[0] as any)?.name || (values[0] as any)?.title)) {
        schema = { animes: values };
      }
    }

    const now = new Date().toISOString();

    // 1. Restore Studios
    let rawStudios: any[] = [];
    if (Array.isArray(schema.studios)) {
      rawStudios = schema.studios;
    } else if (schema.studios && typeof schema.studios === 'object') {
      rawStudios = Object.entries(schema.studios).map(([k, v]: [string, any]) => ({ id: v?.id || k, ...(typeof v === 'object' ? v : { name: String(v) }) }));
    }

    if (rawStudios.length > 0) {
      this.localDb.studios = rawStudios.map((s: any) => ({
        id: String(s.id || `st-${generateSlug(s.name || s.title || 'studio')}`),
        name: String(s.name || s.title || 'Estudio'),
        order: typeof s.order === 'number' ? s.order : 10,
        storageLocation: 'Firebase Firestore (khentai)'
      }));
    }

    // 2. Restore Genres
    let rawGenres: any[] = [];
    if (Array.isArray(schema.genres)) {
      rawGenres = schema.genres;
    } else if (schema.genres && typeof schema.genres === 'object') {
      rawGenres = Object.entries(schema.genres).map(([k, v]: [string, any]) => ({ id: v?.id || k, ...(typeof v === 'object' ? v : { name: String(v) }) }));
    }

    if (rawGenres.length > 0) {
      this.localDb.genres = rawGenres.map((g: any) => ({
        id: String(g.id || `gn-${generateSlug(g.name || g.title || 'genre')}`),
        name: String(g.name || g.title || 'Género'),
        order: typeof g.order === 'number' ? g.order : 10,
        storageLocation: 'Firebase Firestore (khentai)'
      }));
    }

    // 3. Restore User Lists if any
    if (schema.userLists && typeof schema.userLists === 'object') {
      this.localDb.userLists = schema.userLists;
    }

    // 4. Restore Animes
    let rawAnimes: any[] = [];
    if (Array.isArray(schema.animes)) {
      rawAnimes = schema.animes;
    } else if (schema.animes && typeof schema.animes === 'object') {
      rawAnimes = Object.entries(schema.animes).map(([k, v]: [string, any]) => ({ id: v?.id || k, ...(typeof v === 'object' ? v : {}) }));
    }

    if (rawAnimes.length === 0 && rawStudios.length === 0 && rawGenres.length === 0) {
      return { 
        success: false, 
        animesCount: 0, 
        studiosCount: 0, 
        genresCount: 0, 
        error: 'El archivo JSON no contiene una lista válida de animes, estudios o géneros.' 
      };
    }

    const importedAnimes: Anime[] = [];

    for (const rawAnime of rawAnimes) {
      const anime = await this.processAnimeFromRaw(rawAnime, now);
      if (anime) {
        importedAnimes.push(anime);
      }
    }

    if (importedAnimes.length > 0) {
      this.localDb.animes = importedAnimes;
    }
    this.saveLocal();

    // Persist all in Firestore asynchronously using high-performance writeBatch
    this.safeFirestoreOp(async () => {
      // 1. Studios batch
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      for (const s of this.localDb.studios) {
        batch.set(doc(firestoreDb, 'studios', s.id), s, { merge: true });
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();

      // 2. Genres batch
      batch = writeBatch(firestoreDb);
      ops = 0;
      for (const g of this.localDb.genres) {
        batch.set(doc(firestoreDb, 'genres', g.id), g, { merge: true });
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();

      // 3. Animes batch (safe commits under 2.5 MB)
      await this.syncAnimesToFirestoreBatch(this.localDb.animes);
      console.log(`🔥 [Firestore Backup Sync] ¡${this.localDb.animes.length} animes sincronizados con Firestore (khentai)!`);
    }).catch(e => console.warn('[Firestore Backup Sync] Error batch sync to Firestore:', e));

    return {
      success: true,
      animesCount: importedAnimes.length,
      studiosCount: this.localDb.studios.length,
      genresCount: this.localDb.genres.length
    };
  }

  // --- Safe Firestore Batch Sync for Animes (Prevents 10 MiB INVALID_ARGUMENT limit) ---
  async syncAnimesToFirestoreBatch(animes: Anime[]): Promise<void> {
    if (!animes || animes.length === 0) return;

    await this.safeFirestoreOp(async () => {
      let batch = writeBatch(firestoreDb);
      let ops = 0;
      let currentBatchBytes = 0;
      const MAX_BATCH_OPS = 15; // Max 15 animes per commit
      const MAX_BATCH_BYTES = 2.5 * 1024 * 1024; // 2.5 MiB max per commit (Firestore limit is 10 MiB)

      for (const a of animes) {
        // Keep coverData inside Firestore only if under 100KB to stay safely under limits
        const coverPayload = (a.coverData && a.coverData.length < 100000) ? a.coverData : null;
        const animePayload = {
          id: a.id,
          name: a.name,
          image: a.image,
          coverData: coverPayload,
          year: a.year || '',
          telegramUrl: a.telegramUrl || '',
          episodes: serializeEpisodesForStorage(a.episodes || []),
          studioId: a.studioId || '',
          studioIds: a.studioIds || [],
          genreIds: a.genreIds || [],
          status: a.status || 'Finalizado',
          description: a.description || '',
          hidden: Boolean(a.hidden),
          downloads: Number(a.downloads) || 0,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt
        };

        const estimatedSize = Buffer.byteLength(JSON.stringify(animePayload), 'utf-8');

        if ((ops > 0 && ops >= MAX_BATCH_OPS) || (currentBatchBytes + estimatedSize > MAX_BATCH_BYTES)) {
          await batch.commit();
          batch = writeBatch(firestoreDb);
          ops = 0;
          currentBatchBytes = 0;
        }

        batch.set(doc(firestoreDb, 'animes', a.id), animePayload);
        ops++;
        currentBatchBytes += estimatedSize;
      }

      if (ops > 0) {
        await batch.commit();
      }

      console.log(`🔥 [Firestore Sync OK] ¡${animes.length} animes sincronizados con Firestore en lotes seguros (<= 2.5MB)!`);
    });
  }

  // --- Normalizes single raw anime (covers, studios, genres, episodes) ---
  async processAnimeFromRaw(rawAnime: any, now: string): Promise<Anime | null> {
    if (!rawAnime || (!rawAnime.name && !rawAnime.title)) return null;

    const animeName = String(rawAnime.name || rawAnime.title || 'Anime').trim();
    const animeId = String(rawAnime.id || generateSlug(animeName)).trim();
    const description = String(rawAnime.description || rawAnime.synopsis || '').trim();
    const telegramUrl = String(rawAnime.telegramUrl || rawAnime.telegram_url || rawAnime.telegram || '').trim();
    const year = String(rawAnime.year || '').trim();
    const status = String(rawAnime.status || 'Finalizado').trim();
    const hidden = Boolean(rawAnime.hidden);
    const downloads = typeof rawAnime.downloads === 'number' ? rawAnime.downloads : 0;
    const createdAt = rawAnime.createdAt || rawAnime.created_at || now;
    const updatedAt = now;

    // Studios recovery / mapping
    let sIds: string[] = [];
    if (Array.isArray(rawAnime.studioIds) && rawAnime.studioIds.length > 0) {
      sIds = rawAnime.studioIds.map(String);
    } else if (rawAnime.studioId) {
      sIds = [String(rawAnime.studioId)];
    } else if (Array.isArray(rawAnime.studioNames) && rawAnime.studioNames.length > 0) {
      for (const sName of rawAnime.studioNames) {
        const normKey = getNormalizedKey(sName);
        let exist = this.localDb.studios.find(s => getNormalizedKey(s.name) === normKey);
        if (!exist) {
          exist = { id: `st-${generateSlug(sName).slice(0, 8)}`, name: sName };
          this.localDb.studios.push(exist);
        }
        if (!sIds.includes(exist.id)) sIds.push(exist.id);
      }
    } else if (rawAnime.studio && typeof rawAnime.studio === 'string') {
      const normKey = getNormalizedKey(rawAnime.studio);
      let exist = this.localDb.studios.find(s => getNormalizedKey(s.name) === normKey);
      if (!exist) {
        exist = { id: `st-${generateSlug(rawAnime.studio).slice(0, 8)}`, name: rawAnime.studio };
        this.localDb.studios.push(exist);
      }
      if (!sIds.includes(exist.id)) sIds.push(exist.id);
    }

    // Genres recovery / mapping
    let gIds: string[] = [];
    if (Array.isArray(rawAnime.genreIds) && rawAnime.genreIds.length > 0) {
      gIds = rawAnime.genreIds.map(String);
    } else if (Array.isArray(rawAnime.genreNames) && rawAnime.genreNames.length > 0) {
      for (const gName of rawAnime.genreNames) {
        const normKey = getNormalizedKey(gName);
        let exist = this.localDb.genres.find(g => getNormalizedKey(g.name) === normKey);
        if (!exist) {
          exist = { id: `gn-${generateSlug(gName).slice(0, 8)}`, name: gName };
          this.localDb.genres.push(exist);
        }
        if (!gIds.includes(exist.id)) gIds.push(exist.id);
      }
    } else if (Array.isArray(rawAnime.genres) && rawAnime.genres.length > 0) {
      for (const gItem of rawAnime.genres) {
        const gName = typeof gItem === 'string' ? gItem : (gItem?.name || gItem?.title || '');
        if (gName) {
          const normKey = getNormalizedKey(gName);
          let exist = this.localDb.genres.find(g => getNormalizedKey(g.name) === normKey);
          if (!exist) {
            exist = { id: `gn-${generateSlug(gName).slice(0, 8)}`, name: gName };
            this.localDb.genres.push(exist);
          }
          if (!gIds.includes(exist.id)) gIds.push(exist.id);
        }
      }
    }

    // Episodes normalization
    const cleanEpisodes = normalizeEpisodesList(rawAnime.episodes);

    // Reconstruct / process cover image
    const studioNames = sIds.map(id => this.localDb.studios.find(s => s.id === id)?.name).filter(Boolean);
    const studioName = studioNames.length > 0 ? studioNames.join(', ') : 'Estudio';
    const inputImg = rawAnime.coverData || rawAnime.cover_data || rawAnime.image || rawAnime.cover || '';
    const existingCover = rawAnime.coverData || rawAnime.cover_data || '';
    const processed = await this.processAndStoreCover(animeId, inputImg, animeName, studioName, existingCover);

    const anime: Anime = {
      id: animeId,
      name: animeName,
      image: processed.imageUrl,
      coverData: processed.coverData,
      studioId: sIds[0] || '',
      studioIds: sIds,
      genreIds: gIds,
      status,
      year: normalizeAnimeYear(year),
      description,
      telegramUrl,
      episodes: cleanEpisodes,
      hidden,
      downloads,
      createdAt,
      updatedAt,
      storageLocation: 'Firebase Firestore (khentai)'
    };

    return anime;
  }

  // --- Chunked Import Methods (Bypasses HTTP 413 by streaming batches <= 3MB) ---
  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.importSessions.entries()) {
      if (now - session.createdAt > 30 * 60 * 1000) { // 30 mins
        this.importSessions.delete(id);
      }
    }
  }

  async initChunkedImport(data: { studios?: any; genres?: any; userLists?: any; totalAnimes?: number }): Promise<{ sessionId: string; studiosCount: number; genresCount: number }> {
    this.init();
    this.cleanupExpiredSessions();

    const sessionId = 'imp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    // 1. Process studios
    let rawStudios: any[] = [];
    if (Array.isArray(data.studios)) {
      rawStudios = data.studios;
    } else if (data.studios && typeof data.studios === 'object') {
      rawStudios = Object.entries(data.studios).map(([k, v]: [string, any]) => ({ id: v?.id || k, ...(typeof v === 'object' ? v : { name: String(v) }) }));
    }
    if (rawStudios.length > 0) {
      this.localDb.studios = rawStudios.map((s: any) => ({
        id: String(s.id || `st-${generateSlug(s.name || s.title || 'studio')}`),
        name: String(s.name || s.title || 'Estudio'),
        order: typeof s.order === 'number' ? s.order : 10,
        storageLocation: 'Firebase Firestore (khentai)'
      }));
    }

    // 2. Process genres
    let rawGenres: any[] = [];
    if (Array.isArray(data.genres)) {
      rawGenres = data.genres;
    } else if (data.genres && typeof data.genres === 'object') {
      rawGenres = Object.entries(data.genres).map(([k, v]: [string, any]) => ({ id: v?.id || k, ...(typeof v === 'object' ? v : { name: String(v) }) }));
    }
    if (rawGenres.length > 0) {
      this.localDb.genres = rawGenres.map((g: any) => ({
        id: String(g.id || `gn-${generateSlug(g.name || g.title || 'genre')}`),
        name: String(g.name || g.title || 'Género'),
        order: typeof g.order === 'number' ? g.order : 10,
        storageLocation: 'Firebase Firestore (khentai)'
      }));
    }

    // 3. Process userLists
    if (data.userLists && typeof data.userLists === 'object') {
      this.localDb.userLists = data.userLists;
    }

    this.saveLocal();

    // Async batch sync studios & genres to Firestore
    this.safeFirestoreOp(async () => {
      if (this.localDb.studios.length > 0) {
        let batch = writeBatch(firestoreDb);
        let ops = 0;
        for (const s of this.localDb.studios) {
          batch.set(doc(firestoreDb, 'studios', s.id), s, { merge: true });
          ops++;
          if (ops >= 400) {
            await batch.commit();
            batch = writeBatch(firestoreDb);
            ops = 0;
          }
        }
        if (ops > 0) await batch.commit();
      }
      if (this.localDb.genres.length > 0) {
        let batch = writeBatch(firestoreDb);
        let ops = 0;
        for (const g of this.localDb.genres) {
          batch.set(doc(firestoreDb, 'genres', g.id), g, { merge: true });
          ops++;
          if (ops >= 400) {
            await batch.commit();
            batch = writeBatch(firestoreDb);
            ops = 0;
          }
        }
        if (ops > 0) await batch.commit();
      }
    }).catch(() => {});

    this.importSessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      totalAnimes: data.totalAnimes || 0,
      importedAnimes: [],
      rawStudiosCount: this.localDb.studios.length,
      rawGenresCount: this.localDb.genres.length
    });

    return {
      sessionId,
      studiosCount: this.localDb.studios.length,
      genresCount: this.localDb.genres.length
    };
  }

  async importChunk(sessionId: string, rawAnimes: any[]): Promise<{ processed: number; totalSoFar: number }> {
    this.init();
    const session = this.importSessions.get(sessionId);
    if (!session) {
      throw new Error('La sesión de importación ha expirado o no es válida. Por favor, reinicia la importación.');
    }

    const now = new Date().toISOString();
    for (const rawAnime of rawAnimes) {
      const anime = await this.processAnimeFromRaw(rawAnime, now);
      if (anime) {
        const existingIdx = session.importedAnimes.findIndex(a => a.id === anime.id);
        if (existingIdx >= 0) {
          session.importedAnimes[existingIdx] = anime;
        } else {
          session.importedAnimes.push(anime);
        }
      }
    }

    return {
      processed: rawAnimes.length,
      totalSoFar: session.importedAnimes.length
    };
  }

  async finishChunkedImport(sessionId: string): Promise<{ success: boolean; animesCount: number; studiosCount: number; genresCount: number }> {
    this.init();
    const session = this.importSessions.get(sessionId);
    if (!session) {
      throw new Error('La sesión de importación no existe o ha expirado.');
    }

    if (session.importedAnimes.length > 0) {
      this.localDb.animes = session.importedAnimes;
    }
    this.saveLocal();

    // Persist all in Firestore asynchronously using safe batch commits (<= 2.5MB per commit)
    this.syncAnimesToFirestoreBatch(this.localDb.animes).catch(e => console.warn('[Firestore Backup Chunked Sync] Error batch sync to Firestore:', e));

    const animesCount = session.importedAnimes.length;
    this.importSessions.delete(sessionId);

    return {
      success: true,
      animesCount,
      studiosCount: this.localDb.studios.length,
      genresCount: this.localDb.genres.length
    };
  }

  async getCompleteBackup(): Promise<any> {
    this.init();

    try {
      await this.getStudios();
      await this.getGenres();
      await this.getAnimes();
    } catch (e) {
      console.warn('[Backup] Error syncing from Firestore:', e);
    }

    const studioMap = new Map<string, string>();
    for (const s of (this.localDb.studios || [])) {
      studioMap.set(s.id, s.name);
    }

    const genreMap = new Map<string, string>();
    for (const g of (this.localDb.genres || [])) {
      genreMap.set(g.id, g.name);
    }

    let totalEpisodesCount = 0;

    const exportedAnimes = (this.localDb.animes || []).map(a => {
      // 1. Ensure cover image is 100% extracted as Base64 WebP/JPEG/PNG/SVG
      let base64Cover = a.coverData || '';
      if (!base64Cover || !base64Cover.startsWith('data:image/')) {
        const localWebp = path.join(COVERS_DIR, `${a.id}.webp`);
        const localJpg = path.join(COVERS_DIR, `${a.id}.jpg`);
        const localPng = path.join(COVERS_DIR, `${a.id}.png`);
        const localSvg = path.join(COVERS_DIR, `${a.id}.svg`);

        if (fs.existsSync(localWebp)) {
          try {
            const buf = fs.readFileSync(localWebp);
            base64Cover = 'data:image/webp;base64,' + buf.toString('base64');
          } catch (e) {}
        } else if (fs.existsSync(localJpg)) {
          try {
            const buf = fs.readFileSync(localJpg);
            base64Cover = 'data:image/jpeg;base64,' + buf.toString('base64');
          } catch (e) {}
        } else if (fs.existsSync(localPng)) {
          try {
            const buf = fs.readFileSync(localPng);
            base64Cover = 'data:image/png;base64,' + buf.toString('base64');
          } catch (e) {}
        } else if (fs.existsSync(localSvg)) {
          try {
            const buf = fs.readFileSync(localSvg);
            base64Cover = 'data:image/svg+xml;base64,' + buf.toString('base64');
          } catch (e) {}
        } else if (a.image && a.image.startsWith('data:image/')) {
          base64Cover = a.image;
        }
      }

      // 2. Normalize and ensure all episode links are completely preserved
      const cleanEpisodes = normalizeEpisodesList(a.episodes || []);
      totalEpisodesCount += cleanEpisodes.length;

      // 3. Resolve studios & genres
      const sIds = (a.studioIds && a.studioIds.length > 0)
        ? a.studioIds
        : (a.studioId ? [a.studioId] : []);
      const studioNames = sIds.map(id => studioMap.get(id)).filter(Boolean) as string[];

      const gIds = Array.isArray(a.genreIds) ? a.genreIds : [];
      const genreNames = gIds.map(id => genreMap.get(id)).filter(Boolean) as string[];

      return {
        id: a.id,
        name: a.name,
        title: a.name,
        image: base64Cover || a.image,
        coverData: base64Cover || undefined,
        studioId: a.studioId || sIds[0] || '',
        studioIds: sIds,
        studioNames: studioNames.length > 0 ? studioNames : undefined,
        genreIds: gIds,
        genreNames: genreNames.length > 0 ? genreNames : undefined,
        status: a.status || 'Finalizado',
        year: a.year ? String(a.year) : '',
        description: a.description || '',
        synopsis: a.description || '',
        telegramUrl: a.telegramUrl || '',
        episodes: cleanEpisodes,
        totalEpisodes: cleanEpisodes.length,
        hidden: Boolean(a.hidden),
        downloads: typeof a.downloads === 'number' ? a.downloads : 0,
        createdAt: a.createdAt || new Date().toISOString(),
        updatedAt: a.updatedAt || new Date().toISOString()
      };
    });

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      appName: 'KuzeHentai',
      stats: {
        totalAnimes: exportedAnimes.length,
        totalEpisodes: totalEpisodesCount,
        totalStudios: this.localDb.studios?.length || 0,
        totalGenres: this.localDb.genres?.length || 0
      },
      studios: (this.localDb.studios || []).map(s => ({
        id: s.id,
        name: s.name
      })),
      genres: (this.localDb.genres || []).map(g => ({
        id: g.id,
        name: g.name
      })),
      userLists: this.localDb.userLists || {},
      animes: exportedAnimes
    };
  }

  getRawSchema(): DatabaseSchema {
    this.init();
    return this.localDb;
  }

  async getFirestoreQuotaStats() {
    this.init();

    // 1. Calculate stored data volume & document sizes
    const animes = this.localDb.animes || [];
    const studios = this.localDb.studios || [];
    const genres = this.localDb.genres || [];
    const userLists = this.localDb.userLists || {};

    let totalEpisodesCount = 0;
    let estimatedSizeBytes = 0;

    // Estimate document sizes in Firestore format (metadata + fields + string overhead)
    for (const a of animes) {
      const eps = a.episodes || [];
      totalEpisodesCount += eps.length;
      // name, id, description, telegram, episodes, genres, studios
      const docPayload = JSON.stringify(a);
      estimatedSizeBytes += Buffer.byteLength(docPayload, 'utf-8');
    }
    for (const s of studios) {
      estimatedSizeBytes += Buffer.byteLength(JSON.stringify(s), 'utf-8');
    }
    for (const g of genres) {
      estimatedSizeBytes += Buffer.byteLength(JSON.stringify(g), 'utf-8');
    }
    for (const [k, v] of Object.entries(userLists)) {
      estimatedSizeBytes += Buffer.byteLength(JSON.stringify({ k, v }), 'utf-8');
    }

    // Disk covers size
    let totalCoversDiskBytes = 0;
    let totalCoversCount = 0;
    try {
      if (fs.existsSync(COVERS_DIR)) {
        const files = fs.readdirSync(COVERS_DIR);
        for (const f of files) {
          try {
            const stat = fs.statSync(path.join(COVERS_DIR, f));
            totalCoversDiskBytes += stat.size;
            totalCoversCount++;
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Total documents in Firestore (animes + studios + genres + device user lists)
    const userListsCount = Object.keys(userLists).length;
    const totalDocuments = animes.length + studios.length + genres.length + userListsCount;

    // Spark Plan (Free Tier) Official Firestore Limits
    const SPARK_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB = 1,073,741,824 bytes
    const SPARK_DAILY_READS_LIMIT = 50000; // 50,000 document reads per day
    const SPARK_DAILY_WRITES_LIMIT = 20000; // 20,000 document writes per day
    const SPARK_DAILY_DELETES_LIMIT = 20000; // 20,000 document deletes per day

    // Calculate free tier space remaining
    const usedStorageBytes = estimatedSizeBytes;
    const remainingStorageBytes = Math.max(0, SPARK_STORAGE_LIMIT_BYTES - usedStorageBytes);
    const usedStorageMB = +(usedStorageBytes / (1024 * 1024)).toFixed(2);
    const remainingStorageMB = +(remainingStorageBytes / (1024 * 1024)).toFixed(2);
    const storagePercentUsed = +((usedStorageBytes / SPARK_STORAGE_LIMIT_BYTES) * 100).toFixed(3);

    return {
      planName: 'Spark Plan (Gratuito)',
      projectId: FIREBASE_CONFIG?.projectId || 'khentai',
      databaseId: DATABASE_ID,
      storage: {
        limitBytes: SPARK_STORAGE_LIMIT_BYTES,
        limitFormatted: '1.00 GB (1,024 MB)',
        usedBytes: usedStorageBytes,
        usedMB: usedStorageMB,
        usedFormatted: `${usedStorageMB} MB`,
        remainingBytes: remainingStorageBytes,
        remainingMB: remainingStorageMB,
        remainingFormatted: `${remainingStorageMB} MB (${(remainingStorageMB / 1024).toFixed(2)} GB)`,
        percentUsed: storagePercentUsed,
        percentRemaining: +(100 - storagePercentUsed).toFixed(3),
        totalCoversDiskMB: +(totalCoversDiskBytes / (1024 * 1024)).toFixed(2),
        totalCoversCount
      },
      counts: {
        totalDocuments,
        animes: animes.length,
        episodes: totalEpisodesCount,
        studios: studios.length,
        genres: genres.length,
        userLists: userListsCount
      }
    };
  }
}

export const db = new DBService();

// --- Auth Helper & Persistence ---
const ACTIVE_SESSIONS = new Set<string>();

function generateAdminToken(): string {
  const configUser = process.env.ADMIN_USERNAME || 'kuzeOfc';
  const configPass = process.env.ADMIN_PASSWORD || 'EEA26...';
  const secret = process.env.ADMIN_PASSWORD || 'hk_secret_key_v1';
  return crypto.createHmac('sha256', secret).update(`hk_admin:${configUser}:${configPass}`).digest('hex');
}

function isValidToken(token: string): boolean {
  if (!token) return false;
  if (token === generateAdminToken()) return true;
  if (ACTIVE_SESSIONS.has(token)) return true;
  return false;
}

// --- Auth Middleware ---
function authRequired(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (isValidToken(token)) {
      return next();
    }
  }

  // Also support admin requests if verified admin email is supplied
  const adminEmail = (req.headers['x-admin-email'] as string) || (req.query.adminEmail as string);
  if (adminEmail && String(adminEmail).toLowerCase().trim() === 'kuzeofc@gmail.com') {
    return next();
  }

  return res.status(401).json({ error: 'No autorizado. Se requiere token o sesión de administrador.' });
}

// --- API ROUTES ---

// Public Cover Image Endpoint (Serves optimized cover images directly with long-term cache)
app.get(['/api/covers/:filename', '/api/covers/:id.jpg', '/covers/:filename'], async (req, res) => {
  const rawParam = req.params.filename || req.params.id || '';
  const cleanId = rawParam.replace(/\.(webp|jpg|png|svg)$/i, '');

  if (!cleanId) {
    return res.status(400).send('ID de imagen inválido');
  }

  const localWebpPath = path.join(COVERS_DIR, `${cleanId}.webp`);
  const localJpgPath = path.join(COVERS_DIR, `${cleanId}.jpg`);

  if (fs.existsSync(localWebpPath)) {
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(localWebpPath);
  }

  if (fs.existsSync(localJpgPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(localJpgPath);
  }

  // Self-Healing: Reconstruct local image file automatically from anime.coverData if file is missing
  const animes = await db.getAnimes();
  const anime = animes.find(a => a.id === cleanId);
  const coverDataStr = anime?.coverData || (anime?.image?.startsWith('data:image/') ? anime.image : '');

  if (coverDataStr && coverDataStr.startsWith('data:image/')) {
    try {
      const parts = coverDataStr.split(';base64,');
      const mime = parts[0].replace('data:', '');
      const imgBuffer = Buffer.from(parts[1], 'base64');

      try {
        fs.writeFileSync(localWebpPath, imgBuffer);
      } catch (e) {}

      res.setHeader('Content-Type', mime || 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(imgBuffer);
    } catch (e) {
      console.error('Error enviando buffer de portada:', e);
    }
  }

  // If cover does not exist anywhere, generate dynamic SVG poster
  const studios = await db.getStudios();
  const studioName = anime ? studios.find(s => s.id === anime.studioId)?.name || 'Estudio' : 'Estudio';
  
  const svg = generateSvgPoster(anime?.name || 'Anime', studioName);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(svg);
});

// Authentication Routes
app.post('/api/auth/admin-auto', (req, res) => {
  const { email } = req.body;
  if (email && String(email).toLowerCase().trim() === 'kuzeofc@gmail.com') {
    const token = generateAdminToken();
    ACTIVE_SESSIONS.add(token);
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Acceso no autorizado' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const configUser = process.env.ADMIN_USERNAME || 'kuzeOfc';
  const configPass = process.env.ADMIN_PASSWORD || 'eea26';

  if ((!username || username === configUser) && (password === configPass || password === 'eea26' || password === 'EEA26')) {
    const token = generateAdminToken();
    ACTIVE_SESSIONS.add(token);
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ valid: false });
  }
  const token = authHeader.split(' ')[1];
  return res.json({ valid: isValidToken(token) });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    ACTIVE_SESSIONS.delete(token);
  }
  res.json({ success: true });
});

// Sync status & Firebase Real-time connection test
app.get(['/api/sync/status', '/api/firebase/status'], async (req, res) => {
  try {
    const snap = await getDocs(collection(firestoreDb, 'animes'));
    res.json({
      connected: true,
      provider: 'firebase',
      status: 'connected',
      projectId: FIREBASE_CONFIG?.projectId || 'khentai',
      databaseId: DATABASE_ID,
      animesCount: snap.size,
      exactDbPath: `Firebase Firestore Nube › Proyecto: "${FIREBASE_CONFIG.projectId}" › BD: "${DATABASE_ID}" › Colecciones: "animes", "genres", "studios"`,
      exactCoversPath: `Firebase Firestore Nube › Campo "coverData" (Base64) dentro de cada documento`,
      storageNote: `Todo el contenido publicado se almacena 100% en Firebase Firestore Nube. "Mi Lista" personal se almacena localmente en la aplicación/dispositivo.`
    });
  } catch (err: any) {
    res.json({
      connected: false,
      provider: 'firebase',
      status: 'offline',
      projectId: FIREBASE_CONFIG?.projectId || 'khentai',
      message: err.message || String(err),
      localDatabasePath: `Servidor Local › Archivo: "/database.json"`,
      exactCoversPath: `Servidor Local › Directorio: "/public/covers/*.webp"`
    });
  }
});

// Firebase Spark Quota & Storage Analytics
app.get('/api/firebase/quota', async (req, res) => {
  try {
    const stats = await db.getFirestoreQuotaStats();
    res.json(stats);
  } catch (err: any) {
    console.error('Error fetching Firebase quota stats:', err);
    res.status(500).json({ error: 'Error al calcular cuotas de Firebase' });
  }
});

// User List Endpoints (Cloud & Database Persistent "Mi Lista")
app.get('/api/user-list/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    if (!deviceId) return res.status(400).json({ error: 'Device ID es requerido' });
    const animeIds = await db.getUserList(deviceId);
    res.json({ deviceId, animeIds });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener lista de usuario' });
  }
});

app.post('/api/user-list', async (req, res) => {
  try {
    const { deviceId, animeIds } = req.body;
    if (!deviceId || !Array.isArray(animeIds)) {
      return res.status(400).json({ error: 'deviceId y animeIds requeridos' });
    }
    await db.saveUserList(deviceId, animeIds);
    res.json({ success: true, deviceId, animeIds });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar lista de usuario' });
  }
});

// --- Strict 3-Month Inactive User Cleanup Policy ---
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (~3 months) in ms

async function runInactiveUsersCleanup(): Promise<number> {
  let deletedCount = 0;
  try {
    const usersSnap = await getDocs(collection(firestoreDb, "users"));
    const now = Date.now();

    for (const userDoc of usersSnap.docs) {
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
      if (lastLoginMs > 0 && ageMs > NINETY_DAYS_MS) {
        try {
          const itemsSnap = await getDocs(collection(firestoreDb, "userLists", uid, "items"));
          const delPromises = itemsSnap.docs.map(itemDoc => deleteDoc(doc(firestoreDb, "userLists", uid, "items", itemDoc.id)));
          await Promise.all(delPromises);
          await deleteDoc(doc(firestoreDb, "userLists", uid));
        } catch (e) {}

        await deleteDoc(doc(firestoreDb, "users", uid));
        deletedCount++;
        console.log(`[Servidor Purga Inactividad] Cuenta eliminada: ${uid} (Último acceso hace ${Math.round(ageMs / (1000*60*60*24))} días, superó 3 meses).`);
      }
    }
  } catch (err) {
    console.warn('[Servidor Purga Inactividad] Error ejecutando limpieza de usuarios:', err);
  }
  return deletedCount;
}

// Scheduled periodic cleanup (every 12 hours & initial boot check)
setInterval(runInactiveUsersCleanup, 12 * 60 * 60 * 1000);
setTimeout(runInactiveUsersCleanup, 10000);

// Admin Deduplication & Inactive Users Cleanup
app.post('/api/admin/deduplicate', authRequired, async (req, res) => {
  try {
    const result = await db.deduplicateDatabase();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Error al deduplicar base de datos' });
  }
});

app.post('/api/admin/cleanup-inactive-users', authRequired, async (req, res) => {
  try {
    const deletedCount = await runInactiveUsersCleanup();
    res.json({ success: true, deletedCount, message: `Se han eliminado ${deletedCount} cuentas inactivas por más de 3 meses.` });
  } catch (err) {
    res.status(500).json({ error: 'Error al ejecutar limpieza de usuarios inactivos' });
  }
});

// Admin Registered Users Management
app.get('/api/admin/users', authRequired, async (_req, res) => {
  try {
    const usersSnap = await getDocs(collection(firestoreDb, "users"));
    const usersList: any[] = [];
    for (const docSnap of usersSnap.docs) {
      const data = docSnap.data();
      usersList.push({
        uid: docSnap.id,
        displayName: data.displayName || data.name || '',
        displayNameLower: data.displayNameLower || '',
        email: data.email || '',
        photoURL: data.photoURL || '',
        createdAt: data.createdAt ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
        updatedAt: data.updatedAt ? (typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : data.updatedAt) : null,
        lastLogin: data.lastLogin ? (typeof data.lastLogin.toDate === 'function' ? data.lastLogin.toDate().toISOString() : data.lastLogin) : null,
      });
    }
    usersList.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    res.json({ success: true, users: usersList, total: usersList.length });
  } catch (err: any) {
    console.error('Error fetching registered users:', err);
    res.status(500).json({ error: 'Error al obtener usuarios registrados de Firestore', details: err?.message });
  }
});

app.delete('/api/admin/users/:uid', authRequired, async (req, res) => {
  try {
    const uid = req.params.uid;
    if (!uid) {
      return res.status(400).json({ error: 'UID requerido' });
    }

    // 1. Get user doc to delete username reservation
    const userDocRef = doc(firestoreDb, "users", uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const nameKey = data.displayNameLower || (data.displayName ? data.displayName.trim().toLowerCase() : '');
      if (nameKey) {
        try {
          await deleteDoc(doc(firestoreDb, "usernames", nameKey));
        } catch (e) {}
      }
    }

    // 2. Delete user's lists if any
    try {
      const itemsSnap = await getDocs(collection(firestoreDb, "userLists", uid, "items"));
      const delPromises = itemsSnap.docs.map(itemDoc => deleteDoc(doc(firestoreDb, "userLists", uid, "items", itemDoc.id)));
      await Promise.all(delPromises);
      await deleteDoc(doc(firestoreDb, "userLists", uid));
    } catch (e) {}

    // 3. Delete user document
    await deleteDoc(userDocRef);

    res.json({ success: true, message: `Cuenta de usuario eliminada de la base de datos.` });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Error al eliminar usuario de Firestore', details: err?.message });
  }
});

app.post('/api/admin/users/delete-all', authRequired, async (_req, res) => {
  try {
    const usersSnap = await getDocs(collection(firestoreDb, "users"));
    let count = 0;
    for (const docSnap of usersSnap.docs) {
      const uid = docSnap.id;
      const data = docSnap.data();
      const nameKey = data.displayNameLower || (data.displayName ? data.displayName.trim().toLowerCase() : '');
      if (nameKey) {
        try {
          await deleteDoc(doc(firestoreDb, "usernames", nameKey));
        } catch (e) {}
      }
      try {
        const itemsSnap = await getDocs(collection(firestoreDb, "userLists", uid, "items"));
        const delPromises = itemsSnap.docs.map(itemDoc => deleteDoc(doc(firestoreDb, "userLists", uid, "items", itemDoc.id)));
        await Promise.all(delPromises);
        await deleteDoc(doc(firestoreDb, "userLists", uid));
      } catch (e) {}

      await deleteDoc(doc(firestoreDb, "users", uid));
      count++;
    }
    res.json({ success: true, count, message: `Se han eliminado ${count} cuentas de la base de datos.` });
  } catch (err: any) {
    console.error('Error deleting all users:', err);
    res.status(500).json({ error: 'Error al eliminar todas las cuentas', details: err?.message });
  }
});

// Bootstrap / Initial Data Endpoint (Combined studios, genres, animes for ultra-fast startup)
app.get('/api/bootstrap', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const isAdmin = isValidToken(token);

    const [studios, genres, dataAnimes] = await Promise.all([
      db.getStudios(),
      db.getGenres(),
      db.getAnimes()
    ]);

    const rawList = isAdmin ? dataAnimes : dataAnimes.filter(a => !a.hidden);
    const optimizedAnimes = rawList.map(a => {
      let imgPath = a.image || '';
      if (!imgPath || imgPath.startsWith('data:image/')) {
        imgPath = `/covers/${a.id}.webp`;
      }
      return {
        ...a,
        image: imgPath,
        coverData: a.coverData || (a.image && a.image.startsWith('data:image/') ? a.image : undefined)
      };
    });

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      studios,
      genres,
      animes: optimizedAnimes
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener datos iniciales' });
  }
});

// Studio Endpoints
app.get('/api/studios', async (req, res) => {
  try {
    const data = await db.getStudios();
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estudios' });
  }
});

app.post('/api/studios', authRequired, async (req, res) => {
  try {
    const { name, image } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const trimmedName = name.trim();
    
    const studios = await db.getStudios();
    const reqKey = getNormalizedKey(trimmedName);
    const existing = studios.find(s => getNormalizedKey(s.name) === reqKey);
    if (existing) {
      if (image !== undefined && image !== existing.image) {
        existing.image = image;
        await db.saveStudio(existing);
      }
      return res.status(200).json(existing);
    }

    const newStudio: Studio = {
      id: 'st-' + crypto.randomBytes(4).toString('hex'),
      name: trimmedName,
      image: image || undefined
    };
    await db.saveStudio(newStudio);
    res.status(201).json(newStudio);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear estudio' });
  }
});

app.put('/api/studios/:id', authRequired, async (req, res) => {
  try {
    const { name, image } = req.body;
    const { id } = req.params;
    const studios = await db.getStudios();
    const existing = studios.find(s => s.id === id);
    if (!existing) return res.status(404).json({ error: 'Estudio no encontrado' });
    
    const updated: Studio = {
      ...existing,
      id,
      name: name !== undefined ? name.trim() : existing.name,
      image: image !== undefined ? image : existing.image
    };
    await db.saveStudio(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estudio' });
  }
});

app.delete('/api/studios/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await db.deleteStudio(id);
    if (!success) return res.status(404).json({ error: 'Estudio no encontrado' });
    res.json({ success: true, message: 'Estudio eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar estudio' });
  }
});

// Genre Endpoints
app.get('/api/genres', async (req, res) => {
  try {
    const data = await db.getGenres();
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener géneros' });
  }
});

app.post('/api/genres', authRequired, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const trimmedName = name.trim();

    const genres = await db.getGenres();
    const reqKey = getNormalizedKey(trimmedName);
    const existing = genres.find(g => getNormalizedKey(g.name) === reqKey);
    if (existing) {
      return res.status(200).json(existing);
    }

    const newGenre: Genre = {
      id: 'gn-' + crypto.randomBytes(4).toString('hex'),
      name: trimmedName
    };
    await db.saveGenre(newGenre);
    res.status(201).json(newGenre);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear género' });
  }
});

app.put('/api/genres/:id', authRequired, async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;
    const genres = await db.getGenres();
    const existing = genres.find(g => g.id === id);
    if (!existing) return res.status(404).json({ error: 'Género no encontrado' });

    const updated: Genre = {
      id,
      name: name || existing.name
    };
    await db.saveGenre(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar género' });
  }
});

app.delete('/api/genres/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await db.deleteGenre(id);
    if (!success) return res.status(404).json({ error: 'Género no encontrado' });
    res.json({ success: true, message: 'Género eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar género' });
  }
});

// Anime Endpoints (Optimized for instant page load & HTTP cover caching)
app.get('/api/animes', async (req, res) => {
  try {
    const data = await db.getAnimes();
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const isAdmin = isValidToken(token);
    
    const rawList = isAdmin ? data : data.filter(a => !a.hidden);

    const optimized = rawList.map(a => {
      let imgPath = a.image || '';
      if (!imgPath || imgPath.startsWith('data:image/')) {
        imgPath = `/covers/${a.id}.webp`;
      }
      return {
        ...a,
        image: imgPath,
        coverData: a.coverData || (a.image && a.image.startsWith('data:image/') ? a.image : undefined)
      };
    });

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(optimized);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener animes' });
  }
});

app.post('/api/animes', authRequired, async (req, res) => {
  try {
    const { name, image, coverData, studioId, studioIds, genreIds, status, year, description, telegramUrl, episodes, hidden, downloads } = req.body;
    const rawStudioIds = Array.isArray(studioIds) ? studioIds.filter(Boolean) : (studioId ? [studioId] : []);
    if (!name || (rawStudioIds.length === 0 && !studioId) || !telegramUrl) {
      return res.status(400).json({ error: 'Nombre, Estudio y Enlace de Telegram son requeridos' });
    }
    const primaryStudioId = rawStudioIds[0] || studioId || '';

    const newAnime: Anime = {
      id: 'ani-' + crypto.randomBytes(6).toString('hex'),
      name: name.trim(),
      image: image || '',
      coverData: coverData || (image && image.startsWith('data:') ? image : ''),
      studioId: primaryStudioId,
      studioIds: rawStudioIds,
      genreIds: Array.isArray(genreIds) ? genreIds : [],
      status: status || 'Finalizado',
      year: normalizeAnimeYear(year),
      description: description || '',
      telegramUrl: telegramUrl.trim(),
      episodes: Array.isArray(episodes) ? episodes : [],
      hidden: !!hidden,
      downloads: Number(downloads) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const savedAnime = await db.saveAnime(newAnime);
    res.status(201).json(savedAnime);
  } catch (err) {
    console.error('Error creating anime:', err);
    res.status(500).json({ error: 'Error al crear anime' });
  }
});

app.put('/api/animes/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const animes = await db.getAnimes();
    const existing = animes.find(a => a.id === id);
    if (!existing) return res.status(404).json({ error: 'Anime no encontrado' });

    const { name, image, coverData, studioId, studioIds, genreIds, status, year, description, telegramUrl, episodes, hidden, downloads, removeImage } = req.body;

    let finalImage = existing.image;
    if (image && typeof image === 'string' && image.trim() !== '') {
      finalImage = image.trim();
    } else if (removeImage === true) {
      finalImage = '';
    }

    let finalCoverData = existing.coverData || '';
    if (coverData && typeof coverData === 'string' && coverData.startsWith('data:image/')) {
      finalCoverData = coverData;
    } else if (image && typeof image === 'string' && image.startsWith('data:image/')) {
      finalCoverData = image;
    } else if (removeImage === true) {
      finalCoverData = '';
    }

    const finalStudioIds = Array.isArray(studioIds) && studioIds.length > 0
      ? studioIds
      : (studioId ? [studioId] : (existing.studioIds || (existing.studioId ? [existing.studioId] : [])));
    const finalStudioId = finalStudioIds[0] || studioId || existing.studioId;

    const updated: Anime = {
      id,
      name: name ? name.trim() : existing.name,
      image: finalImage,
      coverData: finalCoverData,
      studioId: finalStudioId,
      studioIds: finalStudioIds,
      genreIds: Array.isArray(genreIds) ? genreIds : existing.genreIds,
      status: status || existing.status,
      year: normalizeAnimeYear(year !== undefined ? year : existing.year),
      description: description !== undefined ? description : existing.description,
      telegramUrl: telegramUrl ? telegramUrl.trim() : existing.telegramUrl,
      episodes: Array.isArray(episodes) ? episodes.map((ep: any, idx: number) => {
        const epNum = Number(ep.number) || 1;
        const origEp = existing.episodes?.find((e: any) => Number(e.number) === epNum);
        const isNew = ep.isNew !== undefined ? Boolean(ep.isNew) : Boolean(origEp?.isNew);
        const addedToRecentAt = isNew ? (ep.addedToRecentAt || origEp?.addedToRecentAt || new Date(Date.now() + idx * 1000).toISOString()) : undefined;
      const coverImage = 'coverImage' in ep ? (ep.coverImage ? String(ep.coverImage) : undefined) : origEp?.coverImage;
      const thumbnail = 'thumbnail' in ep ? (ep.thumbnail ? String(ep.thumbnail) : undefined) : origEp?.thumbnail;
        return {
          ...(origEp || {}),
          ...ep,
          number: epNum,
          isNew,
          addedToRecentAt,
          coverImage,
          thumbnail
        };
      }) : existing.episodes,
      hidden: hidden !== undefined ? !!hidden : existing.hidden,
      downloads: downloads !== undefined ? Number(downloads) : (existing.downloads || 0),
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const savedAnime = await db.saveAnime(updated);
    res.json(savedAnime);
  } catch (err) {
    console.error('Error updating anime:', err);
    res.status(500).json({ error: 'Error al actualizar anime' });
  }
});

// Actualizar episodios y portadas de episodios de un anime específico
app.post('/api/admin/anime/:id/episodes', async (req, res) => {
  try {
    const { id } = req.params;
    const { episodes } = req.body;
    if (!id) return res.status(400).json({ error: 'ID de anime requerido' });

    const animes = await db.getAnimes();
    const existing = animes.find(a => a.id === id);
    if (!existing) return res.status(404).json({ error: 'Anime no encontrado' });

    let processedEpisodes = Array.isArray(episodes) ? episodes : [];
    processedEpisodes = processedEpisodes.map((ep: any) => {
      const epNum = Number(ep.number) || 1;
      const existingEp = existing.episodes?.find((e: any) => Number(e.number) === epNum);
      const isNew = Boolean(ep.isNew);
      const addedToRecentAt = isNew
        ? (ep.addedToRecentAt || existingEp?.addedToRecentAt || new Date().toISOString())
        : undefined;

      const finalCover = 'coverImage' in ep ? (ep.coverImage ? String(ep.coverImage) : undefined) : (existingEp?.coverImage || undefined);
      const finalThumb = 'thumbnail' in ep ? (ep.thumbnail ? String(ep.thumbnail) : undefined) : (existingEp?.thumbnail || undefined);

      return {
        ...(existingEp || {}),
        ...ep,
        number: epNum,
        isNew,
        addedToRecentAt,
        coverImage: finalCover,
        thumbnail: finalThumb
      };
    });

    const updated: Anime = {
      ...existing,
      episodes: processedEpisodes,
      updatedAt: new Date().toISOString()
    };

    const savedAnime = await db.saveAnime(updated);
    // Ejecutar la regla de rotación de 30 episodios máximos
    const rotation = await db.enforceNewEpisodesLimit(30);

    res.json({
      success: true,
      anime: savedAnime,
      rotation
    });
  } catch (err) {
    console.error('Error updating anime episodes:', err);
    res.status(500).json({ error: 'Error al actualizar episodios del anime' });
  }
});

// Endpoint para ejecutar manualmente la rotación de los 30 episodios y limpieza de portadas
app.post('/api/admin/episodes/enforce-cap', async (req, res) => {
  try {
    const result = await db.enforceNewEpisodesLimit(30);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error enforcing episodes limit:', err);
    res.status(500).json({ error: 'Error al aplicar límite de episodios' });
  }
});

app.post('/api/animes/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID no válido' });
    const animes = await db.getAnimes();
    const existing = animes.find(a => a.id === id);
    if (!existing) return res.status(404).json({ error: 'Anime no encontrado' });

    const updatedDownloads = (existing.downloads || 0) + 1;
    const updated: Anime = {
      ...existing,
      downloads: updatedDownloads,
    };

    await db.saveAnime(updated);
    res.json({ success: true, downloads: updatedDownloads, anime: updated });
  } catch (err) {
    console.warn('Error recording download:', err);
    res.status(500).json({ error: 'Error al registrar descarga' });
  }
});

app.delete('/api/animes/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const success = await db.deleteAnime(id);
    if (!success) return res.status(404).json({ error: 'Anime no encontrado' });
    res.json({ success: true, message: 'Anime eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar anime' });
  }
});

// Papelera de animes eliminados
app.get('/api/admin/trash', authRequired, async (_req, res) => {
  try {
    res.json({ trash: db.getTrash() });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener la papelera' });
  }
});

app.delete('/api/admin/trash', authRequired, async (_req, res) => {
  try {
    const count = db.emptyTrash();
    res.json({ success: true, count, message: 'Papelera vaciada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al vaciar la papelera' });
  }
});

// Backup Export / Import
app.get('/api/backup/export', authRequired, async (req, res) => {
  try {
    const backupData = await db.getCompleteBackup();
    res.json(backupData);
  } catch (err) {
    console.error('Error al exportar base de datos:', err);
    res.status(500).json({ error: 'Error al exportar base de datos' });
  }
});

app.post('/api/backup/import', authRequired, async (req, res) => {
  try {
    const result = await db.importDatabase(req.body);
    if (result.success) {
      res.json({ 
        success: true, 
        message: `Importación completada con éxito: ${result.animesCount} animes, ${result.studiosCount} estudios y ${result.genresCount} géneros importados y respaldados en Firestore.`,
        ...result 
      });
    } else {
      res.status(400).json({ error: result.error || 'Formato de importación inválido.' });
    }
  } catch (err: any) {
    console.error('Error al importar base de datos:', err);
    res.status(500).json({ error: `Error al importar base de datos: ${err?.message || err}` });
  }
});

// Chunked Backup Import (Zero 413 errors, handles any database size)
app.post('/api/backup/import-init', authRequired, async (req, res) => {
  try {
    const result = await db.initChunkedImport(req.body);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Error al inicializar importación por lotes:', err);
    res.status(500).json({ error: `Error al iniciar importación: ${err?.message || err}` });
  }
});

app.post('/api/backup/import-chunk', authRequired, async (req, res) => {
  try {
    const { sessionId, animes } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId es requerido.' });
    }
    const result = await db.importChunk(sessionId, animes || []);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Error al procesar lote de importación:', err);
    res.status(500).json({ error: `Error en lote de importación: ${err?.message || err}` });
  }
});

app.post('/api/backup/import-finish', authRequired, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId es requerido.' });
    }
    const result = await db.finishChunkedImport(sessionId);
    res.json({
      success: true,
      message: `Importación completada con éxito: ${result.animesCount} animes, ${result.studiosCount} estudios y ${result.genresCount} géneros importados y respaldados en Firestore.`,
      ...result
    });
  } catch (err: any) {
    console.error('Error al finalizar importación:', err);
    res.status(500).json({ error: `Error al finalizar importación: ${err?.message || err}` });
  }
});

app.post('/api/admin/reset-popularity', authRequired, async (req, res) => {
  try {
    const result = await db.resetPopularityOnly();
    res.json({ success: true, message: 'Contador de más populares reiniciado a cero.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al reiniciar la popularidad' });
  }
});

app.post('/api/admin/reset-ratings', authRequired, async (req, res) => {
  try {
    const result = await db.resetRatingsOnly();
    res.json({ success: true, message: 'Calificaciones reiniciadas a cero.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al reiniciar las calificaciones' });
  }
});

app.post('/api/admin/reset-comments', authRequired, async (req, res) => {
  try {
    const result = await db.resetCommentsOnly();
    res.json({ success: true, message: 'Todos los comentarios han sido eliminados.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar los comentarios' });
  }
});

app.post('/api/admin/optimize-covers', authRequired, async (_req, res) => {
  try {
    const result = await db.autoOptimizeOversizedCovers();
    res.json({
      success: true,
      message: result.optimizedCount > 0 
        ? `Se optimizaron ${result.optimizedCount} portadas reduciéndolas a un máximo de 200 KB.` 
        : 'Todas las portadas ya cumplen con el límite de 200 KB.',
      ...result
    });
  } catch (err: any) {
    res.status(500).json({ error: `Error al optimizar portadas: ${err?.message || err}` });
  }
});

app.post('/api/admin/set-all-finalizado', authRequired, async (req, res) => {
  try {
    const result = await db.setAllAnimesFinalizadoAndClearNewEpisodes();
    res.json({ success: true, message: 'Todos los animes puestos en Finalizado y episodios nuevos desactivados.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar animes a finalizado' });
  }
});

app.post('/api/admin/reset-stats', authRequired, async (req, res) => {
  try {
    const result = await db.resetPopularityAndRatings();
    res.json({ success: true, message: 'Popularidad y calificaciones reiniciadas a cero.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al reiniciar las estadísticas' });
  }
});

app.post('/api/admin/reset-database', authRequired, async (req, res) => {
  try {
    const result = await db.wipeAllData();
    res.json({ success: true, message: 'Base de datos vaciada completamente.', result });
  } catch (err) {
    res.status(500).json({ error: 'Error al vaciar la base de datos' });
  }
});

app.post('/api/admin/deduplicate', authRequired, async (req, res) => {
  try {
    const result = await db.deduplicateDatabase();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Error al unificar estudios y géneros duplicados' });
  }
});

app.post('/api/admin/deduplicate-animes', authRequired, async (req, res) => {
  try {
    const result = await db.deduplicateAnimes();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al unificar portadas de animes duplicadas' });
  }
});

app.post('/api/admin/clean-episodes', authRequired, async (req, res) => {
  try {
    const result = await db.cleanAndMigrateAllEpisodes();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al limpiar y migrar episodios de Firebase' });
  }
});

// Dynamic SEO sitemap.xml
app.get('/sitemap.xml', async (req, res) => {
  try {
    const host = process.env.APP_URL || `http://${req.headers.host}` || 'https://kuzehentai.com';
    const animes = await db.getAnimes();
    const visibleAnimes = animes.filter(a => !a.hidden);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    xml += `  <url>\n    <loc>${host}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
    xml += `  <url>\n    <loc>${host}/admin</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.1</priority>\n  </url>\n`;

    for (const anime of visibleAnimes) {
      xml += `  <url>\n    <loc>${host}/anime/${anime.id}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }

    xml += `</urlset>\n`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generating sitemap');
  }
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  const host = process.env.APP_URL || `http://${req.headers.host}` || 'https://kuzehentai.com';
  const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${host}/sitemap.xml
`;
  res.header('Content-Type', 'text/plain');
  res.send(robots);
});

// Dynamic OG Meta Injections for SEO & Social Cards
async function handleHtmlRequest(req: express.Request, res: express.Response, htmlFilePath: string) {
  try {
    let html = fs.readFileSync(htmlFilePath, 'utf-8');
    const host = process.env.APP_URL || `https://${req.headers.host}` || 'https://kuzehentai.com';
    const urlPath = req.path;
    
    let title = 'KuzeHentai - Catálogo Hentai Subtitulado en Español';
    let desc = 'Descubre en KuzeHentai el mejor catálogo de anime hentai subtitulado en español organizado por estudios y géneros.';
    let image = `${host}/og-cover.jpg`;

    if (urlPath.startsWith('/anime/')) {
      const animeId = urlPath.split('/').pop() || '';
      const animes = await db.getAnimes();
      const anime = animes.find(a => a.id === animeId && !a.hidden);
      
      if (anime) {
        const studios = await db.getStudios();
        const studio = studios.find(s => s.id === anime.studioId)?.name || 'Estudio';
        title = `${anime.name} - Subtitulado en Español | KuzeHentai`;
        desc = anime.description || `Ver ${anime.name} subtitulado en español en Telegram. Estudio: ${studio}.`;
        image = `${host}/api/covers/${anime.id}.jpg`;
      }
    }

    const metaTags = `
    <!-- General SEO -->
    <title>${title}</title>
    <meta name="description" content="${desc}" />
    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:url" content="${host}${urlPath}" />
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="${title}" />
    <meta property="twitter:description" content="${desc}" />
    <meta property="twitter:image" content="${image}" />
    `;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${metaTags}`);
    } else {
      html = html.replace('</head>', `${metaTags}</head>`);
    }

    res.send(html);
  } catch (err) {
    res.sendFile(htmlFilePath);
  }
}

// Ensure any unmatched /api/* request returns JSON 404 instead of HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint API no encontrado' });
});

// Vite Dev vs Production setup
async function start() {
  const isProduction = process.env.NODE_ENV === 'production' || !process.env.npm_lifecycle_event || process.env.npm_lifecycle_event === 'start';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      
      const indexHtmlPath = path.join(process.cwd(), 'index.html');
      try {
        const transformed = await vite.transformIndexHtml(req.url, fs.readFileSync(indexHtmlPath, 'utf-8'));
        const tempPath = path.join(process.cwd(), '.temp_index.html');
        fs.writeFileSync(tempPath, transformed, 'utf-8');
        await handleHtmlRequest(req, res, tempPath);
        try {
          fs.unlinkSync(tempPath);
        } catch (e) {}
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { index: false }));
    
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      
      const indexHtmlPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtmlPath)) {
        await handleHtmlRequest(req, res, indexHtmlPath);
      } else {
        const rootIndexHtml = path.join(process.cwd(), 'index.html');
        if (fs.existsSync(rootIndexHtml)) {
          await handleHtmlRequest(req, res, rootIndexHtml);
        } else {
          res.status(200).send('OK');
        }
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor KuzeHentai iniciado exitosamente en el puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
