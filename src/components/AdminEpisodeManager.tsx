/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useDeferredValue } from 'react';
import { Anime, Episode, Studio } from '../types';
import { SmartAnimeCover, getFallbackSvg } from '../utils/imageFallback';
import {
  Search, Film, Trash2, Save, ArrowLeft, Upload, Link as LinkIcon,
  Check, AlertCircle, Image as ImageIcon, X, RefreshCw
} from 'lucide-react';
import {
  normalizeSearchText,
  buildNormalizedAnimeData,
  matchesFuzzySearch,
  calculateRelevanceScore
} from '../utils/searchUtils';

interface AdminEpisodeManagerProps {
  animes: Anime[];
  studios: Studio[];
  onRefresh: () => void;
  showNotification: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

// Sin optimización/compresión: se conserva la imagen 100% original en su tamaño completo
const compressEpisodeCover = (base64Str: string): Promise<string> => {
  return Promise.resolve(base64Str);
};

export const AdminEpisodeManager: React.FC<AdminEpisodeManagerProps> = ({
  animes,
  studios,
  onRefresh,
  showNotification,
}) => {
  // Search query for searching animes in the database with deferred value for lag-free typing
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Selected Anime and specific episode number being edited
  const [selectedAnimeId, setSelectedAnimeId] = useState<string | null>(null);
  const [selectedEpNumber, setSelectedEpNumber] = useState<number | null>(null);

  // Single episode being edited
  const [editingEpisode, setEditingEpisode] = useState<{
    number: number;
    mp4Url: string;
    thumbnail?: string;
    isNew: boolean;
    addedToRecentAt?: string;
    title?: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isCleaningCap, setIsCleaningCap] = useState(false);

  // Quick URL input modal state for episode thumbnail
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [tempImageUrl, setTempImageUrl] = useState('');
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);

  // File input ref for thumbnail uploads
  const thumbFileInputRef = useRef<HTMLInputElement | null>(null);

  // Selected Anime reference
  const selectedAnime = useMemo(() => {
    return animes.find(a => a.id === selectedAnimeId) || null;
  }, [animes, selectedAnimeId]);

  // Fast precomputed studio map for instantaneous O(1) lookups
  const studioMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < studios.length; i++) {
      map.set(studios[i].id, studios[i].name);
    }
    return map;
  }, [studios]);

  const genreMap = useMemo(() => new Map<string, string>(), []);

  // Pre-normalize anime data once for instant fuzzy/typo-tolerant search without DOM freezes
  const normalizedAnimes = useMemo(() => {
    return animes.map(anime => buildNormalizedAnimeData(anime, studioMap, genreMap));
  }, [animes, studioMap, genreMap]);

  // Episodes currently active in the public "Episodios" section
  const activeRecentEpisodes = useMemo(() => {
    const items: {
      id: string;
      anime: Anime;
      episode: Episode;
      episodeNumber: number;
      coverImage?: string;
      mp4Url?: string;
      timestamp: number;
      studioName: string;
    }[] = [];

    animes.forEach(anime => {
      const eps = anime.episodes && anime.episodes.length > 0
        ? anime.episodes
        : (anime.telegramUrl ? [{ number: 1, mp4Url: anime.telegramUrl, isNew: false }] : []);

      const targetEps = eps.filter(ep => Boolean(ep.isNew));

      if (targetEps.length === 0) return;

      const baseTime = anime.createdAt
        ? new Date(anime.createdAt).getTime()
        : (anime.updatedAt ? new Date(anime.updatedAt).getTime() : 0);

      const sIds = (anime.studioIds && anime.studioIds.length > 0)
        ? anime.studioIds
        : (anime.studioId ? [anime.studioId] : []);
      const studioName = sIds.map(id => studios.find(s => s.id === id)?.name || '').filter(Boolean).join(', ') || 'Estudio';

      targetEps.forEach(ep => {
        const epNum = Number(ep.number) || 1;
        const epTimestamp = ep.addedToRecentAt
          ? new Date(ep.addedToRecentAt).getTime()
          : (baseTime + epNum * 1000);

        items.push({
          id: `${anime.id}-ep-${epNum}`,
          anime,
          episode: ep,
          episodeNumber: epNum,
          coverImage: ep.thumbnail || ep.coverImage || anime.coverData || anime.image,
          mp4Url: ep.mp4Url || ep.telegramUrl,
          timestamp: epTimestamp,
          studioName,
        });
      });
    });

    items.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return (b.episodeNumber || 0) - (a.episodeNumber || 0);
    });
    return items.slice(0, 30);
  }, [animes, studios]);

  // Ultra-responsive, fuzzy and typo-tolerant search (same robust engine as catalog and home)
  const searchedAnimes = useMemo(() => {
    const rawQuery = deferredSearchQuery.trim();
    if (!rawQuery) return [];

    const normQuery = normalizeSearchText(rawQuery);
    const normQueryNoSpaces = normQuery.replace(/\s+/g, '');
    const queryTokens = normQuery.split(/\s+/).filter(Boolean);

    const scored: { anime: Anime; score: number }[] = [];

    for (let i = 0; i < normalizedAnimes.length; i++) {
      const item = normalizedAnimes[i];
      if (matchesFuzzySearch(normQuery, normQueryNoSpaces, queryTokens, item)) {
        const score = calculateRelevanceScore(normQuery, normQueryNoSpaces, queryTokens, item);
        scored.push({ anime: item.anime, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    // Cap results to 30 items to keep DOM operations instantaneous and lightweight
    return scored.slice(0, 30).map(s => s.anime);
  }, [deferredSearchQuery, normalizedAnimes]);

  // Select a specific episode of an anime to edit
  const handleSelectEpisode = (anime: Anime, epNumber: number) => {
    setSelectedAnimeId(anime.id);
    setSelectedEpNumber(epNumber);

    const eps: Episode[] = Array.isArray(anime.episodes) ? anime.episodes : [];
    const targetEp = eps.find(e => Number(e.number) === epNumber);

    const defaultLink = targetEp?.mp4Url || targetEp?.telegramUrl || targetEp?.url || (epNumber === 1 ? anime.telegramUrl || '' : '');
    const isNew = Boolean(targetEp?.isNew);

    setEditingEpisode({
      number: epNumber,
      mp4Url: defaultLink,
      thumbnail: targetEp?.thumbnail || targetEp?.coverImage || undefined,
      isNew,
      addedToRecentAt: targetEp?.addedToRecentAt || undefined,
      title: targetEp?.title || targetEp?.name || undefined,
    });
  };

  // Close editor and return to episodes list
  const handleBackToList = () => {
    setSelectedAnimeId(null);
    setSelectedEpNumber(null);
    setEditingEpisode(null);
  };

  // Trigger file upload dialog for thumbnail
  const handleTriggerThumbUpload = () => {
    if (thumbFileInputRef.current) {
      thumbFileInputRef.current.value = '';
      thumbFileInputRef.current.click();
    }
  };

  // Drag and drop handler for episode thumbnail
  const handleThumbDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingThumb(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/') && editingEpisode) {
      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const rawBase64 = event.target?.result as string;
          if (rawBase64) {
            setEditingEpisode(prev => prev ? { ...prev, thumbnail: rawBase64 } : null);
            showNotification(`Miniatura del Episodio #${editingEpisode.number} actualizada.`, 'success');
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        showNotification('Error al leer el archivo de imagen.', 'error');
      }
    }
  };

  // Process uploaded thumbnail image
  const handleThumbFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingEpisode) return;

    if (!file.type.startsWith('image/')) {
      showNotification('Selecciona un archivo de imagen válido.', 'error');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const rawBase64 = event.target?.result as string;
        if (rawBase64) {
          const compressed = await compressEpisodeCover(rawBase64);
          setEditingEpisode(prev => prev ? { ...prev, thumbnail: compressed } : null);
          showNotification(`Miniatura del Episodio #${editingEpisode.number} actualizada.`, 'success');
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.warn('Error reading image file:', err);
      showNotification('Error al leer el archivo de imagen.', 'error');
    }
  };

  // Assign URL image to thumbnail
  const handleSaveUrlThumbnail = () => {
    const trimmed = tempImageUrl.trim();
    if (trimmed && editingEpisode) {
      setEditingEpisode(prev => prev ? { ...prev, thumbnail: trimmed } : null);
      showNotification('Miniatura asignada correctamente.', 'success');
    }
    setShowUrlModal(false);
    setTempImageUrl('');
  };

  // Save the single episode being edited
  const handleSaveCurrentEpisode = async () => {
    if (!selectedAnime || !editingEpisode || selectedEpNumber === null) return;
    setIsSaving(true);

    try {
      const existing: Episode[] = Array.isArray(selectedAnime.episodes) && selectedAnime.episodes.length > 0
        ? [...selectedAnime.episodes]
        : (selectedAnime.telegramUrl ? [{ number: 1, mp4Url: selectedAnime.telegramUrl, telegramUrl: selectedAnime.telegramUrl, isNew: false }] : []);

      const cleanLink = String(editingEpisode.mp4Url || '').trim();
      const targetIdx = existing.findIndex(e => Number(e.number) === selectedEpNumber);
      const existingEp = targetIdx >= 0 ? existing[targetIdx] : null;

      // Cada episodio guardado con 'isNew: true' recibe el timestamp actual para posicionarse de primero en orden de agregación
      const finalAddedToRecentAt = editingEpisode.isNew
        ? (editingEpisode.addedToRecentAt || existingEp?.addedToRecentAt || new Date().toISOString())
        : undefined;

      const thumbVal = editingEpisode.thumbnail ? String(editingEpisode.thumbnail) : undefined;
      const updatedItem: Episode = {
        number: selectedEpNumber,
        mp4Url: cleanLink,
        telegramUrl: cleanLink,
        isNew: Boolean(editingEpisode.isNew),
        addedToRecentAt: finalAddedToRecentAt,
        thumbnail: thumbVal,
        coverImage: thumbVal, // Sincronizado para usar la misma miniatura
        title: editingEpisode.title || existingEp?.title
      };

      if (targetIdx >= 0) {
        existing[targetIdx] = {
          ...existing[targetIdx],
          ...updatedItem,
          coverImage: updatedItem.coverImage,
          thumbnail: updatedItem.thumbnail
        };
      } else {
        existing.push(updatedItem);
      }
      existing.sort((a, b) => Number(a.number) - Number(b.number));

      const res = await fetch(`/api/admin/anime/${selectedAnime.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: existing
        })
      });

      if (!res.ok) throw new Error('Error al guardar el episodio');
      showNotification(`Episodio #${selectedEpNumber} de "${selectedAnime.name}" guardado exitosamente.`, 'success');
      onRefresh();
    } catch (err: any) {
      console.error('Error saving episode:', err);
      showNotification(err.message || 'Error al guardar el episodio', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Enforce rotation of public episodes
  const handleEnforceCap = async () => {
    setIsCleaningCap(true);
    try {
      const res = await fetch('/api/admin/episodes/enforce-cap', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification(
          `Rotación completada. ${data.evictedCount || 0} episodios rotados y portadas antiguas depuradas.`,
          'success'
        );
        onRefresh();
      } else {
        throw new Error('Error en el servidor');
      }
    } catch (err) {
      showNotification('Error al ejecutar la rotación de episodios.', 'error');
    } finally {
      setIsCleaningCap(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input for thumbnail uploads */}
      <input
        type="file"
        ref={thumbFileInputRef}
        onChange={handleThumbFileChange}
        accept="image/*"
        className="hidden"
      />

      {/* URL Input Modal */}
      {showUrlModal && editingEpisode && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#0f0a1c] border border-purple-900/60 rounded-xl max-w-md w-full p-4 space-y-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-purple-950/60">
              <h4 className="font-display font-medium text-sm text-white flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-purple-400" />
                Ingresar URL de Miniatura del Episodio #{editingEpisode.number}
              </h4>
              <button
                onClick={() => { setShowUrlModal(false); setTempImageUrl(''); }}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-neutral-300 font-mono">URL de la imagen:</label>
              <input
                type="url"
                value={tempImageUrl}
                onChange={(e) => setTempImageUrl(e.target.value)}
                placeholder="https://ejemplo.com/miniatura.jpg"
                className="w-full bg-[#07050d] border border-purple-900/60 rounded-lg px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                autoFocus
              />
              {tempImageUrl && (
                <div className="aspect-square w-28 h-28 mx-auto rounded-lg overflow-hidden border border-purple-950/80 bg-black">
                  <img
                    src={tempImageUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowUrlModal(false); setTempImageUrl(''); }}
                className="px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:text-white text-xs font-mono cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveUrlThumbnail}
                disabled={!tempImageUrl.trim()}
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-mono font-bold cursor-pointer"
              >
                Aplicar Miniatura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 1: EPISODES LIST & SEARCH (WHEN NO SPECIFIC EPISODE IS SELECTED) */}
      {!selectedAnime || !editingEpisode ? (
        <div className="space-y-4">
          {/* Search bar and Enforce rotation button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1 py-0.5">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar portada por nombre, estudio, género, año..."
                className="w-full bg-[#08080a] border border-[#23153c] hover:border-purple-700/60 focus:border-purple-500 rounded-full py-2.5 sm:py-3 pl-11 pr-10 text-xs sm:text-sm text-white placeholder-neutral-500 outline-none transition-all duration-300 shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white text-xs font-mono p-1 cursor-pointer"
                  title="Limpiar búsqueda"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={handleEnforceCap}
              disabled={isCleaningCap}
              title="Asegura la rotación automática de episodios y limpia portadas antiguas"
              className="px-4 py-2.5 bg-[#0e0a1a] hover:bg-[#180e2a] border border-purple-800/60 hover:border-purple-500 text-purple-300 rounded-full text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-sm active:scale-95"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isCleaningCap ? 'animate-spin' : ''}`} />
              <span>Verificar Rotación</span>
            </button>
          </div>

          {/* CASE A: USER IS SEARCHING FOR AN ANIME */}
          {searchQuery.trim().length > 0 ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-mono font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  Resultados de búsqueda ({searchedAnimes.length} animes):
                </h3>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-[11px] font-mono text-neutral-400 hover:text-white cursor-pointer"
                >
                  ✕ Volver a Episodios
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {searchedAnimes.map(anime => {
                  const episodesList = Array.isArray(anime.episodes) && anime.episodes.length > 0
                    ? anime.episodes
                    : (anime.telegramUrl ? [{ number: 1, mp4Url: anime.telegramUrl }] : [{ number: 1 }]);

                  return (
                    <div
                      key={anime.id}
                      className="bg-[#0f0a1c] border border-[#23153c] rounded-xl p-3 space-y-2.5 shadow-md"
                    >
                      <div
                        onClick={() => {
                          if (episodesList.length === 1) {
                            handleSelectEpisode(anime, Number(episodesList[0].number) || 1);
                            setSearchQuery('');
                          }
                        }}
                        className={`flex items-center gap-3 ${episodesList.length === 1 ? 'cursor-pointer hover:opacity-90' : ''}`}
                      >
                        <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-black shrink-0 border border-purple-950/60">
                          <SmartAnimeCover
                            anime={anime}
                            studioName="Estudio"
                            alt={anime.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-display font-medium text-xs sm:text-sm text-white truncate">
                            {anime.name}
                          </h4>
                          <p className="text-[10px] font-mono text-neutral-400">
                            {episodesList.length} {episodesList.length === 1 ? 'episodio' : 'episodios'} registrados
                          </p>
                        </div>
                      </div>

                      {/* Episode selection buttons */}
                      <div className="pt-2 border-t border-purple-950/60">
                        <p className="text-[9.5px] font-mono text-purple-300 uppercase tracking-wider mb-1.5">
                          Toca el episodio que deseas editar:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {episodesList.map(ep => {
                            const num = Number(ep.number) || 1;
                            return (
                              <button
                                key={`${anime.id}-ep-${num}`}
                                type="button"
                                onClick={() => {
                                  handleSelectEpisode(anime, num);
                                  setSearchQuery('');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[#180e2a] hover:bg-purple-600 border border-purple-800/60 hover:border-purple-500 text-purple-200 hover:text-white text-xs font-mono font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                              >
                                Episodio {num}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {searchedAnimes.length === 0 && (
                <div className="py-12 text-center border border-dashed border-[#23153c] rounded-xl bg-[#0f0a1c]/40 space-y-2">
                  <AlertCircle className="h-6 w-6 text-purple-400 mx-auto" />
                  <p className="text-xs text-neutral-300 font-mono">No se encontró ningún anime con "{searchQuery}".</p>
                </div>
              )}
            </div>
          ) : (
            /* CASE B: PUBLIC EPISODES SECTION (ONLY ACTIVE EPISODES, RECTANGULAR 16:9, 2 PER ROW) */
            <div className="space-y-3">
              {/* Grid of rectangular episode cards matching anime detail layout (filas de 2) */}
              <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
                {activeRecentEpisodes.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleSelectEpisode(item.anime, item.episodeNumber)}
                    className="group relative aspect-video w-full rounded-xl overflow-hidden cursor-pointer transition-all duration-200 shadow-md select-none active:scale-[0.98] hover:opacity-95 outline-none border-0"
                  >
                    {/* Episode Thumbnail */}
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

                    {/* Subtle dark gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 pointer-events-none" />

                    {/* Compact, rounded and uniform EP badge */}
                    <div className="absolute top-1.5 left-1.5 h-4.5 min-w-[34px] px-1.5 rounded-full bg-black/80 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-sm z-10">
                      <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-white tracking-tight uppercase leading-none">
                        EP {item.episodeNumber}
                      </span>
                    </div>

                    {/* Anime Title overlay at bottom */}
                    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-1.5 sm:p-2 pt-4 pointer-events-none">
                      <p className="font-display text-xs sm:text-[13px] text-white font-medium truncate group-hover:text-purple-300 transition-colors leading-tight">
                        {item.anime.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {activeRecentEpisodes.length === 0 && (
                <div className="py-14 text-center border border-dashed border-[#23153c] rounded-xl bg-[#0f0a1c]/40 space-y-3 max-w-md mx-auto p-6">
                  <Film className="h-8 w-8 text-purple-400 mx-auto" />
                  <h4 className="font-display font-medium text-sm text-white">No hay episodios activos en la sección principal</h4>
                  <p className="font-sans text-xs text-neutral-400">
                    Escribe el nombre de un anime en el buscador de arriba para configurar sus episodios.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* VIEW 2: SINGLE EPISODE EDITOR (SOLO EL NÚMERO DEL EPISODIO QUE SE TOCÓ) */
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Back Button & Anime info */}
          <div className="bg-[#0f0a1c] border border-[#23153c] rounded-xl p-3 sm:p-4 flex items-center justify-between gap-3 shadow-lg">
            <button
              onClick={handleBackToList}
              className="px-3 py-1.5 rounded-lg bg-[#07050d] hover:bg-[#150d27] border border-purple-900/50 text-neutral-300 hover:text-white text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Volver a Episodios</span>
            </button>

            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-12 rounded-lg overflow-hidden bg-black shrink-0 border border-purple-950/80">
                <SmartAnimeCover
                  anime={selectedAnime}
                  studioName="Estudio"
                  alt={selectedAnime.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 text-right">
                <h3 className="font-display font-bold text-xs sm:text-sm text-white truncate">
                  {selectedAnime.name}
                </h3>
                <span className="text-[10px] font-mono text-purple-300">
                  Episodio #{selectedEpNumber}
                </span>
              </div>
            </div>
          </div>

          {/* SINGLE EPISODE CARD */}
          <div className="bg-[#0f0a1c] border border-purple-800/50 rounded-xl p-4 sm:p-6 space-y-5 shadow-xl">
            {/* Header: Episode Number & Visibility toggle */}
            <div className="flex items-center justify-between pb-3 border-b border-purple-950/80">
              <div className="flex items-center gap-2.5">
                <div className="px-3 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-mono font-bold text-sm shadow-md">
                  Episodio #{editingEpisode.number}
                </div>
              </div>

              {/* Visibility switch */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(editingEpisode.isNew)}
                  onChange={(e) => setEditingEpisode(prev => prev ? { ...prev, isNew: e.target.checked } : null)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                <span className={`text-xs font-mono font-semibold ${editingEpisode.isNew ? 'text-purple-300' : 'text-neutral-400'}`}>
                  {editingEpisode.isNew ? 'Visible en Episodios' : 'Oculto en Episodios'}
                </span>
              </label>
            </div>

            {/* Field: Enlace de reproducción */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-purple-200 font-semibold block">
                Enlace de reproducción:
              </label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-400" />
                <input
                  type="text"
                  value={editingEpisode.mp4Url}
                  onChange={(e) => setEditingEpisode(prev => prev ? { ...prev, mp4Url: e.target.value } : null)}
                  placeholder="https://t.me/... o enlace directo .mp4"
                  className="w-full pl-9 pr-3 py-2 bg-[#07050d] border border-purple-900/60 hover:border-purple-700 focus:border-purple-500 rounded-lg text-xs sm:text-sm font-mono text-neutral-200 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Field: Miniatura del Episodio */}
            <div className="space-y-2 pt-2 border-t border-purple-950/80">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono text-purple-200 font-semibold block">
                  Miniatura del Episodio:
                </label>
                <span className="text-[10px] font-mono text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-900/40">
                  Cuadrito (1:1)
                </span>
              </div>

              <div className="bg-[#07050d] border border-purple-950 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
                {/* Thumbnail Preview: cuadrito compacto cuadrado */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingThumb(true); }}
                  onDragLeave={() => setIsDraggingThumb(false)}
                  onDrop={handleThumbDrop}
                  onClick={handleTriggerThumbUpload}
                  className={`aspect-square w-24 h-24 sm:w-28 sm:h-28 rounded-xl border cursor-pointer group bg-black/50 flex flex-col items-center justify-center p-1.5 overflow-hidden relative transition-all duration-300 shrink-0 shadow-lg ${
                    isDraggingThumb
                      ? 'border-purple-500 bg-purple-950/20'
                      : 'border-purple-900/60 hover:border-purple-500/70'
                  }`}
                  title="Haz clic o arrastra una imagen para subir la miniatura del episodio"
                >
                  {editingEpisode.thumbnail ? (
                    <>
                      <img
                        src={editingEpisode.thumbnail}
                        alt="Vista previa miniatura"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                      {editingEpisode.thumbnail.startsWith('data:image/') && (
                        <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/75 backdrop-blur-xs border border-purple-500/40 text-[7.5px] font-mono text-purple-300 z-10 font-bold tracking-tight flex items-center gap-0.5">
                          <span>~{Math.round(editingEpisode.thumbnail.length * 0.75 / 1024)} KB</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-1 z-10">
                        <Upload className="h-5 w-5 text-white animate-bounce" />
                        <span className="font-mono text-[8px] text-white uppercase tracking-wider text-center px-1">
                          Cambiar
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingEpisode(prev => prev ? { ...prev, thumbnail: undefined } : null);
                        }}
                        className="absolute bottom-1 right-1 p-0.5 px-1.5 bg-black/85 hover:bg-brand-red text-white text-[8px] font-mono rounded z-10 transition-colors"
                        title="Quitar miniatura"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <div className="text-center p-2 flex flex-col items-center gap-1.5 text-neutral-500 group-hover:text-purple-300 transition-colors">
                      <Upload className="h-6 w-6 text-purple-600/60 group-hover:text-purple-400 transition-colors" />
                      <span className="font-mono text-[8.5px] uppercase tracking-wider leading-tight text-center">
                        Subir miniatura
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex-1 w-full space-y-2.5">
                  <p className="text-xs text-neutral-300 font-sans">
                    {editingEpisode.thumbnail
                      ? 'Tiene una miniatura personalizada para la sección de episodios, la vista del anime y el reproductor.'
                      : 'Puedes subir una imagen para la miniatura o ingresar una URL. Si no agregas una, se usará la imagen del anime.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTriggerThumbUpload}
                      className="px-3 py-1.5 rounded-lg bg-purple-950/80 hover:bg-purple-900 border border-purple-700/60 text-purple-200 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Subir Miniatura</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowUrlModal(true);
                        setTempImageUrl(editingEpisode.thumbnail || '');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#130c22] hover:bg-[#1a1030] border border-purple-800/40 text-neutral-300 hover:text-white text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      <span>Ingresar URL</span>
                    </button>

                    {editingEpisode.thumbnail && (
                      <button
                        type="button"
                        onClick={() => setEditingEpisode(prev => prev ? { ...prev, thumbnail: undefined } : null)}
                        className="px-2.5 py-1.5 rounded-lg border border-red-900/50 hover:bg-red-950/40 text-red-400 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Quitar miniatura individual"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Quitar Miniatura</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-purple-950/80">
              <button
                type="button"
                onClick={handleBackToList}
                className="px-4 py-2 rounded-lg border border-neutral-700 text-neutral-400 hover:text-white text-xs font-mono cursor-pointer transition-colors"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleSaveCurrentEpisode}
                disabled={isSaving}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-2 shadow-lg shadow-purple-950/60 cursor-pointer transition-all active:scale-95"
              >
                <Save className={`h-4 w-4 ${isSaving ? 'animate-spin' : ''}`} />
                <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEpisodeManager;
