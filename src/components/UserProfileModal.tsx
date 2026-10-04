import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Bookmark, LogOut, Check, User as UserIcon, Edit3, AlertCircle, Palette, Moon, Sparkles } from 'lucide-react';
import { User } from 'firebase/auth';
import { auth, updateProfile, db, doc, setDoc, serverTimestamp } from '../lib/firebase';
import { isUsernameTaken, reserveUsername } from '../lib/usernameService';
import { useAppTheme, AppTheme } from '../lib/theme';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  myListCount: number;
  onOpenMyList: () => void;
  onLogout: () => Promise<void>;
  onUserUpdated?: () => void;
}

export default function UserProfileModal({
  isOpen,
  onClose,
  currentUser,
  myListCount,
  onOpenMyList,
  onLogout,
  onUserUpdated
}: UserProfileModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [appTheme, setAppTheme] = useAppTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.displayName || currentUser.email?.split('@')[0] || '');
      setSuccessMsg(null);
      setErrorMsg(null);
      setImgError(false);
    }
  }, [currentUser, isOpen]);

  if (!isOpen || !currentUser) return null;

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = displayName.trim();

    if (!cleanName) {
      setErrorMsg('El nombre no puede estar vacío');
      inputRef.current?.focus();
      return;
    }

    if (cleanName.length > 10) {
      setErrorMsg('El nombre no puede superar los 10 caracteres');
      inputRef.current?.focus();
      return;
    }

    if (cleanName.length < 2) {
      setErrorMsg('El nombre debe tener al menos 2 caracteres');
      inputRef.current?.focus();
      return;
    }

    const currentName = (currentUser?.displayName || currentUser?.email?.split('@')[0] || '').trim();

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Check if another user already has this same name (case-insensitive)
      if (cleanName.toLowerCase() !== currentName.toLowerCase()) {
        const taken = await isUsernameTaken(cleanName, currentUser.uid);
        if (taken) {
          setErrorMsg('Este nombre ya está en uso por otro usuario. Elige uno diferente.');
          inputRef.current?.focus();
          setSaving(false);
          return;
        }
      }

      if (auth.currentUser) {
        // Update Firebase Auth profile
        await updateProfile(auth.currentUser, { displayName: cleanName });

        // Update reservation and sync Firestore user
        await reserveUsername(cleanName, auth.currentUser.uid, currentName);

        setSuccessMsg('¡Nombre actualizado correctamente!');
        if (onUserUpdated) {
          onUserUpdated();
        }

        setTimeout(() => {
          setSuccessMsg(null);
        }, 2500);
      }
    } catch (err: any) {
      console.error('[Update Profile Error]', err);
      setErrorMsg('No se pudo actualizar el nombre. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    const cleanName = displayName.trim();
    const currentName = (currentUser?.displayName || currentUser?.email?.split('@')[0] || '').trim();

    // Focus input so virtual keyboard opens immediately
    inputRef.current?.focus();

    // If text hasn't changed or is empty, select text ready to write a new one
    if (cleanName === currentName || !cleanName) {
      inputRef.current?.select();
      e.preventDefault();
    }
  };

  const modalUI = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 sm:p-6 h-screen h-[100dvh] w-screen w-[100dvw] overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-0"
        />

        {/* Modal Content */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative z-10 w-full max-w-sm bg-[#120b1c] border border-purple-900/50 rounded-2xl p-5 shadow-2xl overflow-y-auto max-h-[90vh] max-h-[90dvh] scrollbar-thin scrollbar-thumb-purple-900/50"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-purple-900/30">
            <h3 className="font-display font-semibold text-base text-white flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-purple-400" />
              <span>Mi Perfil</span>
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              title="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Section: Selector de Temas (Ultra compacto, colocado de primero por encima de la cuenta) */}
          <div className="mt-3 p-1.5 sm:p-2 bg-[#160d24] border border-purple-900/40 rounded-xl flex items-center justify-between gap-2 kh-theme-section">
            <div className="flex items-center gap-1.5 shrink-0 pl-1">
              <Palette className="h-3.5 w-3.5 text-purple-400 kh-theme-icon" />
              <span className="text-[11px] font-mono font-medium text-purple-200">Tema:</span>
            </div>

            <div className="flex items-center gap-1 bg-[#0b0614] p-1 rounded-lg border border-purple-950/80">
              {/* Opción 1: Violeta oscuro */}
              <button
                type="button"
                onClick={async () => {
                  setAppTheme('default', currentUser?.uid);
                  if (currentUser?.uid) {
                    try {
                      await setDoc(doc(db, 'users', currentUser.uid), {
                        theme: 'default',
                        updatedAt: serverTimestamp()
                      }, { merge: true });
                    } catch (e) {
                      console.warn('Error saving theme:', e);
                    }
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  appTheme === 'default'
                    ? 'bg-purple-900/60 text-white font-semibold ring-1 ring-purple-500/50 shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
                title="Tema Violeta oscuro"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-[#bd42f5] to-purple-400 shrink-0 inline-block border border-purple-300/40" />
                <span>Violeta</span>
              </button>

              {/* Opción 2: Negro */}
              <button
                type="button"
                onClick={async () => {
                  setAppTheme('black', currentUser?.uid);
                  if (currentUser?.uid) {
                    try {
                      await setDoc(doc(db, 'users', currentUser.uid), {
                        theme: 'black',
                        updatedAt: serverTimestamp()
                      }, { merge: true });
                    } catch (e) {
                      console.warn('Error saving theme:', e);
                    }
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  appTheme === 'black'
                    ? 'bg-neutral-800 text-white font-semibold ring-1 ring-white/40 shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
                title="Tema Negro"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-black shrink-0 inline-block border border-neutral-600" />
                <span>Negro</span>
              </button>
            </div>
          </div>

          {/* User Info Header Card with small indicator logout button beside it */}
          <div className="mt-3 p-3 bg-[#180e26] border border-purple-900/40 rounded-xl flex items-center gap-3.5">
            <div className="relative shrink-0">
              {currentUser.photoURL && !imgError ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || 'Foto de perfil'}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-full object-cover shadow-md"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-purple-800 to-brand-red text-white font-bold text-2xl flex items-center justify-center shadow-md">
                  {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold text-sm truncate font-mono">
                {currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario'}
              </p>
              <p className="text-xs text-neutral-400 truncate font-mono" title={currentUser.email || ''}>
                {currentUser.email || 'Cuenta de usuario'}
              </p>
            </div>

            {/* Small exit / logout indicator button as in the screenshot */}
            <div className="pl-2 border-l border-purple-900/60 shrink-0 flex items-center">
              <button
                type="button"
                onClick={async () => {
                  onClose();
                  await onLogout();
                }}
                className="flex flex-col items-center justify-center p-1 text-[#ff7799] hover:text-[#ff4477] transition-colors group cursor-pointer active:scale-95"
                title="Cerrar sesión"
              >
                <LogOut className="h-4 w-4 stroke-[2.2] group-hover:translate-x-0.5 transition-transform" />
                <span className="text-[10px] font-sans font-medium text-neutral-300 group-hover:text-white mt-0.5">
                  Salir
                </span>
              </button>
            </div>
          </div>

          {/* Custom Short Profile Name Form with update button at the side of the name bubble */}
          <form onSubmit={handleSaveName} className="mt-3.5 space-y-2.5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-mono text-purple-200 flex items-center gap-1.5">
                  <Edit3 className="h-3.5 w-3.5 text-purple-400" />
                  <span>Nombre personalizado</span>
                </label>
                <span className={`text-[10px] font-mono ${displayName.length > 10 ? 'text-red-400' : 'text-neutral-400'}`}>
                  {displayName.length}/10
                </span>
              </div>

              {/* Name bubble with Update button directly to its side, matching the Exit button style */}
              <div className="p-2 pl-3 bg-[#0c0614] border border-purple-900/60 focus-within:border-purple-500 rounded-xl flex items-center gap-2 transition-all">
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={10}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Tu nombre (máx 10 letras)"
                  className="flex-1 min-w-0 bg-transparent text-white text-xs font-mono outline-none placeholder:text-neutral-500"
                />

                <div className="pl-2 border-l border-purple-900/60 shrink-0 flex items-center">
                  <button
                    type="submit"
                    onClick={handleButtonClick}
                    disabled={saving}
                    className="flex flex-col items-center justify-center p-1 text-purple-400 hover:text-purple-200 disabled:opacity-40 transition-colors group cursor-pointer active:scale-95"
                    title="Actualizar nombre"
                  >
                    <Edit3 className="h-4 w-4 stroke-[2.2] group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-sans font-medium text-neutral-300 group-hover:text-white mt-0.5">
                      {saving ? 'Guardando' : 'Actualizar'}
                    </span>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-neutral-400 mt-1">
                Máximo 10 caracteres.
              </p>
            </div>

            {errorMsg && (
              <div className="p-2 bg-red-950/60 border border-red-800/60 rounded-lg text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 bg-emerald-950/60 border border-emerald-800/60 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>{successMsg}</span>
              </div>
            )}
          </form>

          {/* Section: Mi Lista */}
          <div className="mt-4 pt-3 border-t border-purple-900/30">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenMyList();
              }}
              className="w-full p-2.5 bg-[#180e26] hover:bg-[#221337] border border-purple-900/50 hover:border-purple-600 rounded-xl transition-all duration-200 flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-brand-red/10 text-[#ff5588] group-hover:bg-[#ff5588] group-hover:text-white transition-colors">
                  <Bookmark className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-white group-hover:text-purple-200 transition-colors">
                    Mi Lista
                  </p>
                  <p className="text-[10px] text-neutral-400 font-mono">
                    Tus animes y episodios guardados
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 bg-[#ff5588]/20 border border-[#ff5588]/40 text-[#ff5588] rounded-full text-[10px] font-mono font-bold">
                {myListCount}
              </span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modalUI, document.body) : null;
}
