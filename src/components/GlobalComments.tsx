import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  auth, 
  db,
  comentariosCollection, 
  addDoc, 
  deleteDoc,
  updateDoc,
  doc,
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  signOut,
  CommentItem
} from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { updateUserLastLogin } from '../lib/userListService';
import { 
  MessageSquare, 
  Send, 
  CornerDownRight, 
  LogOut, 
  User as UserIcon, 
  LogIn, 
  Sparkles,
  MessageCircle,
  ShieldCheck,
  X,
  Trash2,
  MoreVertical,
  EyeOff,
  Eye
} from 'lucide-react';
import AuthModal from './AuthModal';

const ADMIN_EMAIL = 'kuzeofc@gmail.com';

// Single global date formatter instance (avoids instantiating Intl inside render loops)
const spanishDateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

const formatDate = (timestamp: any) => {
  if (!timestamp) return 'Reciente';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return spanishDateFormatter.format(date);
  } catch {
    return 'Reciente';
  }
};

interface GlobalCommentsProps {
  animeId?: string;
  animeTitle?: string;
  className?: string;
}

export default function GlobalComments({ animeId, animeTitle, className = '' }: GlobalCommentsProps) {
  const [user, setUser] = useState<User | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Close moderator 3-dots menu when clicking outside
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.comment-admin-menu-container')) {
        setActiveMenuId(null);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // Monitor Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        updateUserLastLogin(currentUser.uid, currentUser.email, currentUser.displayName).catch(() => {});
      }
    });
    return () => unsubscribe();
  }, []);

  // Monitor Real-Time Comments from Firestore collection "comentariosGlobales"
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      const q = query(comentariosCollection, orderBy('createdAt', 'desc'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const items: CommentItem[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          items.push({
            id: doc.id,
            userId: data.userId || 'anon',
            userName: data.userName || 'Usuario',
            userEmail: data.userEmail || '',
            userPhoto: data.userPhoto || '',
            text: data.text || '',
            createdAt: data.createdAt,
            parentId: data.parentId || null,
            animeId: data.animeId || null,
            animeTitle: data.animeTitle || null,
            hidden: Boolean(data.hidden),
          });
        });
        setComments(items);
      }, (err: any) => {
        const errMsg = String(err?.message || err);
        if (err?.code === 'not-found' || errMsg.includes('NOT_FOUND') || err?.code === 'permission-denied') {
          if (unsubscribe) {
            try { unsubscribe(); } catch {}
            unsubscribe = null;
          }
        } else {
          console.warn("Firestore comments listener error:", err);
        }
      });
    } catch (e) {
      // Graceful fallback
    }

    return () => {
      if (unsubscribe) {
        try { unsubscribe(); } catch {}
      }
    };
  }, []);

  const handleNewCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= 200) {
      setNewCommentText(value);
    } else {
      setNewCommentText(value.slice(0, 200));
    }
  };

  const handleReplyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.length <= 200) {
      setReplyText(value);
    } else {
      setReplyText(value.slice(0, 200));
    }
  };

  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      setActiveMenuId(null);
      // Optimistic delete from local state for immediate responsiveness
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
      if (db) {
        await deleteDoc(doc(db, "comentariosGlobales", commentId));
      }
    } catch (err) {
      console.error("Error al eliminar comentario de Firestore:", err);
    }
  }, []);

  const handleToggleHideComment = useCallback(async (commentId: string, currentHidden: boolean) => {
    try {
      const nextHidden = !currentHidden;
      setActiveMenuId(null);
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, hidden: nextHidden } : c));
      if (db) {
        await updateDoc(doc(db, "comentariosGlobales", commentId), { hidden: nextHidden });
      }
    } catch (err) {
      console.error("Error al cambiar estado de comentario:", err);
    }
  }, []);

  const handlePostComment = useCallback(async (parentId: string | null = null, textToSubmit: string) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    if (!textToSubmit.trim()) return;

    setSubmitting(true);
    try {
      await addDoc(comentariosCollection, {
        userId: user.uid,
        userName: user.displayName || user.email?.split('@')[0] || 'Usuario',
        userEmail: user.email || '',
        userPhoto: user.photoURL || '',
        text: textToSubmit.trim(),
        createdAt: serverTimestamp(),
        parentId: parentId || null,
        animeId: animeId || null,
        animeTitle: animeTitle || null,
      });

      if (parentId) {
        setReplyToId(null);
        setReplyText('');
      } else {
        setNewCommentText('');
      }
    } catch (err) {
      console.error("Error al publicar comentario:", err);
    } finally {
      setSubmitting(false);
    }
  }, [user, animeId, animeTitle]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
    }
  }, []);

  const checkIsAdmin = useCallback((comment: CommentItem) => {
    if (comment.userEmail && comment.userEmail.toLowerCase().trim() === ADMIN_EMAIL) {
      return true;
    }
    if (user && user.email?.toLowerCase().trim() === ADMIN_EMAIL && comment.userId === user.uid) {
      return true;
    }
    if (comment.userName && (comment.userName.toLowerCase().includes('kuzeofc') || comment.userName.toLowerCase() === 'kuze')) {
      return true;
    }
    return false;
  }, [user]);

  const isCurrentUserAdmin = user && user.email?.toLowerCase().trim() === ADMIN_EMAIL;

  // Group top-level comments and replies filtered by animeId in a single pass O(N) pass
  const { filteredComments, topLevelComments, repliesByParentId } = useMemo(() => {
    // Normal users never see hidden comments. Admin sees all comments (hidden ones have a visual badge)
    const base = isCurrentUserAdmin ? comments : comments.filter((c) => !c.hidden);
    const filtered = animeId
      ? base.filter((c) => c.animeId === animeId || (c.parentId && base.some(p => p.id === c.parentId && p.animeId === animeId)))
      : base;

    const topLevel: CommentItem[] = [];
    const repliesMap = new Map<string, CommentItem[]>();

    for (let i = 0; i < filtered.length; i++) {
      const c = filtered[i];
      if (!c.parentId) {
        topLevel.push(c);
      } else {
        const existing = repliesMap.get(c.parentId);
        if (existing) {
          existing.push(c);
        } else {
          repliesMap.set(c.parentId, [c]);
        }
      }
    }

    return { filteredComments: filtered, topLevelComments: topLevel, repliesByParentId: repliesMap };
  }, [comments, animeId, isCurrentUserAdmin]);

  return (
    <div className={`bg-[#0d0714] border border-purple-900/40 rounded-2xl p-4 sm:p-5 shadow-2xl ${className} transform-gpu`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-purple-900/30 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-900/30 text-purple-400 border border-purple-800/40">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-white text-base flex items-center gap-2">
              <span>Comentarios</span>
              <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800/40">
                {filteredComments.length}
              </span>
            </h3>
          </div>
        </div>

        {/* User auth state */}
        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2 bg-[#170e24] border border-purple-900/50 rounded-xl p-1.5 pl-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Avatar" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="flex items-center gap-1.5 hidden sm:flex">
                <span className="text-xs font-medium text-neutral-200 max-w-[120px] truncate">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                {isCurrentUserAdmin && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-r from-amber-500 via-purple-600 to-pink-500 text-white shadow-md shadow-amber-500/20 border border-amber-300/40 uppercase tracking-wider shrink-0">
                    <ShieldCheck className="w-3 h-3 text-amber-200" />
                    Admin
                  </span>
                )}
              </div>
              <button
                onClick={handleSignOut}
                title="Cerrar Sesión"
                className="p-1 text-neutral-400 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs rounded-xl transition-all cursor-pointer shadow-md shadow-purple-950"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Iniciar Sesión</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Post Input */}
      <div className="mb-6">
        <div className="relative bg-[#140b21] border border-purple-900/40 rounded-xl p-3 focus-within:border-purple-500 transition-all">
          <textarea
            rows={2}
            maxLength={200}
            value={newCommentText}
            onChange={handleNewCommentChange}
            placeholder={
              user
                ? "¿Qué opinas? Escribe un comentario (máx 200 caracteres)..."
                : "Inicia sesión para compartir tu comentario con la comunidad..."
            }
            onClick={() => {
              if (!user) setIsAuthModalOpen(true);
            }}
            className="w-full bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none resize-none"
          />
          <div className="flex items-center justify-between pt-2 border-t border-purple-900/20">
            <span
              className={`text-[11px] font-mono transition-colors ${
                newCommentText.length >= 200
                  ? 'text-red-400 font-bold'
                  : newCommentText.length >= 180
                  ? 'text-amber-400'
                  : 'text-neutral-500'
              }`}
            >
              {newCommentText.length} / 200
            </span>
            <button
              onClick={() => handlePostComment(null, newCommentText)}
              disabled={submitting || !newCommentText.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-md"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Publicar</span>
            </button>
          </div>
        </div>
      </div>

      {/* List of Comments with smooth GPU hardware acceleration */}
      <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-900/60 scrollbar-track-transparent transform-gpu touch-pan-y overscroll-contain">
        {topLevelComments.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-purple-900/30 rounded-xl">
            <MessageCircle className="h-8 w-8 text-neutral-600 mx-auto mb-2" />
            <p className="text-xs text-neutral-400 font-mono">No hay comentarios aún.</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">¡Sé el primero en iniciar la conversación!</p>
          </div>
        ) : (
          topLevelComments.map((comment) => {
            const replies = repliesByParentId.get(comment.id) || [];
            const isReplying = replyToId === comment.id;
            const isAdmin = checkIsAdmin(comment);
            const isAuthor = Boolean(user && (
              comment.userId === user.uid ||
              (comment.userEmail && user.email && comment.userEmail.toLowerCase().trim() === user.email.toLowerCase().trim())
            ));

            return (
              <div
                key={comment.id}
                className={`border rounded-xl p-3.5 space-y-3 transform-gpu transition-colors ${
                  comment.hidden ? 'opacity-75 bg-[#0f0819] border-red-900/40' :
                  isAdmin ? 'bg-gradient-to-b from-[#180e29] to-[#120a1f] border-amber-500/40 shadow-lg shadow-amber-900/10' : 
                  'bg-[#120a1f] border-purple-900/30'
                }`}
              >
                {/* Main Comment Content */}
                <div className="flex items-start gap-3">
                  {comment.userPhoto ? (
                    <img
                      src={comment.userPhoto}
                      alt={comment.userName}
                      referrerPolicy="no-referrer"
                      className={`w-9 h-9 rounded-full object-cover shrink-0 mt-0.5 ${
                        isAdmin ? 'border-2 border-amber-400 shadow-md shadow-amber-500/30' : 'border border-purple-500/40'
                      }`}
                    />
                  ) : (
                    <div className={`w-9 h-9 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                      isAdmin ? 'bg-gradient-to-tr from-amber-600 to-purple-600 border-2 border-amber-400 shadow-md shadow-amber-500/30' : 'bg-purple-800 border border-purple-600/40'
                    }`}>
                      {(comment.userName || 'U')[0].toUpperCase()}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-semibold text-xs text-white truncate">
                          {comment.userName}
                        </span>
                        {isAdmin && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-r from-amber-500 via-purple-600 to-pink-500 text-white shadow-md shadow-amber-500/20 border border-amber-300/40 uppercase tracking-wider shrink-0">
                            <ShieldCheck className="w-3 h-3 text-amber-200" />
                            Admin
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {comment.hidden && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-800/50">
                            Oculto
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-neutral-500">
                          {formatDate(comment.createdAt)}
                        </span>

                        {/* Admin 3-dots menu button */}
                        {isCurrentUserAdmin && (
                          <div className="relative comment-admin-menu-container">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === comment.id ? null : comment.id);
                              }}
                              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-purple-900/40 transition-colors cursor-pointer"
                              title="Opciones de moderador"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>

                            {activeMenuId === comment.id && (
                              <div 
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1 z-30 w-44 bg-[#1a1226] border border-purple-800/80 rounded-xl shadow-2xl p-1 text-left backdrop-blur-md"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleToggleHideComment(comment.id, !!comment.hidden)}
                                  className="w-full px-2.5 py-1.5 text-left text-xs text-neutral-200 hover:text-white hover:bg-purple-900/50 rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  {comment.hidden ? (
                                    <>
                                      <Eye className="h-3.5 w-3.5 text-purple-400" />
                                      <span>Mostrar comentario</span>
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="h-3.5 w-3.5 text-amber-400" />
                                      <span>Ocultar comentario</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(comment.id)}
                                  className="w-full px-2.5 py-1.5 text-left text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                                  <span>Eliminar comentario</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-neutral-200 leading-relaxed break-words whitespace-pre-wrap">
                      {comment.text}
                    </p>

                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (!user) {
                            setIsAuthModalOpen(true);
                            return;
                          }
                          setReplyToId(isReplying ? null : comment.id);
                          setReplyText('');
                        }}
                        className="text-[11px] font-medium text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <CornerDownRight className="h-3 w-3" />
                        <span>Responder</span>
                      </button>

                      {/* Author delete button for regular users (when not admin) */}
                      {isAuthor && !isCurrentUserAdmin && (
                        <button
                          onClick={() => handleDeleteComment(comment.id)}
                          className="text-[11px] font-medium text-neutral-400 hover:text-red-400 flex items-center gap-1 cursor-pointer transition-colors"
                          title="Eliminar mi comentario"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Eliminar</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Reply Form */}
                {isReplying && (
                  <div className="ml-8 pt-2 border-t border-purple-900/30">
                    <div className="flex items-center gap-2 bg-[#180f28] border border-purple-800/50 rounded-lg p-2">
                      <input
                        type="text"
                        maxLength={200}
                        value={replyText}
                        onChange={handleReplyChange}
                        placeholder={`Responder a ${comment.userName}...`}
                        className="flex-1 bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handlePostComment(comment.id, replyText);
                          }
                        }}
                      />
                      <span className={`text-[10px] font-mono shrink-0 ${
                        replyText.length >= 200 ? 'text-red-400 font-bold' : 'text-neutral-500'
                      }`}>
                        {replyText.length} / 200
                      </span>
                      <button
                        onClick={() => setReplyToId(null)}
                        className="p-1 text-neutral-400 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handlePostComment(comment.id, replyText)}
                        disabled={submitting || !replyText.trim()}
                        className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-[11px] font-semibold rounded transition-all cursor-pointer"
                      >
                        Enviar
                      </button>
                    </div>
                  </div>
                )}

                {/* Nested Replies */}
                {replies.length > 0 && (
                  <div className="ml-6 sm:ml-8 pl-3 border-l-2 border-purple-900/40 space-y-2.5 pt-2">
                    {replies.map((reply) => {
                      const isReplyAdmin = checkIsAdmin(reply);
                      const isReplyAuthor = Boolean(user && (
                        reply.userId === user.uid ||
                        (reply.userEmail && user.email && reply.userEmail.toLowerCase().trim() === user.email.toLowerCase().trim())
                      ));

                      return (
                        <div key={reply.id} className="flex items-start gap-2.5">
                          {reply.userPhoto ? (
                            <img
                              src={reply.userPhoto}
                              alt={reply.userName}
                              className={`w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 ${
                                isReplyAdmin ? 'border-2 border-amber-400 shadow-md shadow-amber-500/30' : 'border border-purple-500/30'
                              }`}
                            />
                          ) : (
                            <div className={`w-7 h-7 rounded-full text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5 ${
                              isReplyAdmin ? 'bg-gradient-to-tr from-amber-600 to-purple-600 border border-amber-400' : 'bg-purple-900/80 border border-purple-700/30'
                            }`}>
                              {(reply.userName || 'U')[0].toUpperCase()}
                            </div>
                          )}

                          <div className={`flex-1 min-w-0 border rounded-lg p-2 ${
                            reply.hidden ? 'opacity-75 bg-[#140b21] border-red-900/40' :
                            isReplyAdmin ? 'bg-[#1e1133] border-amber-500/40' : 
                            'bg-[#160d26] border-purple-900/20'
                          }`}>
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="font-semibold text-[11px] text-purple-200 truncate">
                                  {reply.userName}
                                </span>
                                {isReplyAdmin && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-gradient-to-r from-amber-500 via-purple-600 to-pink-500 text-white shadow-sm shadow-amber-500/20 border border-amber-300/40 uppercase tracking-wider shrink-0">
                                    <ShieldCheck className="w-2.5 h-2.5 text-amber-200" />
                                    Admin
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {reply.hidden && (
                                  <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-red-950/80 text-red-300 border border-red-800/50">
                                    Oculto
                                  </span>
                                )}
                                <span className="font-mono text-[9px] text-neutral-500">
                                  {formatDate(reply.createdAt)}
                                </span>

                                {/* Admin 3-dots menu button for reply */}
                                {isCurrentUserAdmin && (
                                  <div className="relative comment-admin-menu-container">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveMenuId(activeMenuId === reply.id ? null : reply.id);
                                      }}
                                      className="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-purple-900/40 transition-colors cursor-pointer"
                                      title="Opciones de moderador"
                                    >
                                      <MoreVertical className="h-3 w-3" />
                                    </button>

                                    {activeMenuId === reply.id && (
                                      <div 
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute right-0 top-full mt-1 z-30 w-40 bg-[#1a1226] border border-purple-800/80 rounded-xl shadow-2xl p-1 text-left backdrop-blur-md"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => handleToggleHideComment(reply.id, !!reply.hidden)}
                                          className="w-full px-2 py-1 text-left text-[11px] text-neutral-200 hover:text-white hover:bg-purple-900/50 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                                        >
                                          {reply.hidden ? (
                                            <>
                                              <Eye className="h-3 w-3 text-purple-400" />
                                              <span>Mostrar</span>
                                            </>
                                          ) : (
                                            <>
                                              <EyeOff className="h-3 w-3 text-amber-400" />
                                              <span>Ocultar</span>
                                            </>
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteComment(reply.id)}
                                          className="w-full px-2 py-1 text-left text-[11px] text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                                        >
                                          <Trash2 className="h-3 w-3 text-red-400" />
                                          <span>Eliminar</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Author delete button for reply (when not admin) */}
                                {isReplyAuthor && !isCurrentUserAdmin && (
                                  <button
                                    onClick={() => handleDeleteComment(reply.id)}
                                    className="text-[10px] font-medium text-neutral-400 hover:text-red-400 flex items-center gap-0.5 transition-colors cursor-pointer ml-0.5"
                                    title="Eliminar mi respuesta"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                    <span>Eliminar</span>
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-[11px] text-neutral-300 leading-normal break-words">
                              {reply.text}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
}

