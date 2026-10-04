import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  auth, 
  db,
  configureAuthPersistence,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  googleProvider,
  signInWithPopup,
  updateProfile,
  setDoc,
  doc,
  serverTimestamp
} from '../lib/firebase';
import { isUsernameTaken, reserveUsername } from '../lib/usernameService';
import { X, Mail, Lock, LogIn, UserPlus, AlertCircle, Copy, Check, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isUnauthorizedDomain, setIsUnauthorizedDomain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentDomain = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleCopyDomain = () => {
    if (currentDomain) {
      navigator.clipboard.writeText(currentDomain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    const cleanUsername = username.trim();
    if (isSignUp) {
      if (!cleanUsername) {
        setError('Por favor elige un nombre de usuario.');
        setErrorCode(null);
        return;
      }
      if (cleanUsername.length > 10) {
        setError('El nombre no puede superar los 10 caracteres.');
        setErrorCode(null);
        return;
      }
      if (cleanUsername.length < 2) {
        setError('El nombre debe tener al menos 2 caracteres.');
        setErrorCode(null);
        return;
      }
    }

    if (!email.trim() || !password) {
      setError('Por favor completa todos los campos.');
      setErrorCode(null);
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      setErrorCode(null);
      return;
    }

    setError(null);
    setErrorCode(null);
    setIsUnauthorizedDomain(false);
    setLoading(true);

    try {
      // Guarantee persistence safely
      await configureAuthPersistence().catch(() => {});

      if (isSignUp) {
        // Verify that the requested username is not already taken
        const taken = await isUsernameTaken(cleanUsername, null);
        if (taken) {
          setError('Ese nombre ya está en uso por otro usuario. Por favor elige otro.');
          setLoading(false);
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const createdUser = userCredential.user;

        // Save username in Firebase Authentication profile
        await updateProfile(createdUser, {
          displayName: cleanUsername
        });

        // Reserve username index and sync Firestore user
        await reserveUsername(cleanUsername, createdUser.uid);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      
      onClose();
    } catch (err: any) {
      const code = err?.code || 'auth/unknown';
      const msg = err?.message || String(err);
      console.error("[Auth Email Error] Code:", code, "Message:", msg, err);
      setErrorCode(code);

      if (code === 'auth/unauthorized-domain') {
        setIsUnauthorizedDomain(true);
        setError(`El dominio actual (${currentDomain}) no está autorizado en Firebase Console.`);
      } else if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
        setError('Correo o contraseña incorrectos.');
      } else if (code === 'auth/email-already-in-use') {
        setError('Este correo electrónico ya está registrado. Puedes iniciar sesión con tu cuenta existente.');
      } else if (code === 'auth/weak-password') {
        setError('La contraseña debe tener al menos 6 caracteres.');
      } else if (code === 'auth/network-request-failed' || code === 'auth/internal-error' || msg.toLowerCase().includes('network')) {
        setError('Error de red o conexión con Firebase.');
      } else {
        setError(`Ocurrió un error en la autenticación (${code}).`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setErrorCode(null);
    setIsUnauthorizedDomain(false);
    setLoading(true);

    try {
      await configureAuthPersistence().catch(() => {});
      const result = await signInWithPopup(auth, googleProvider);
      
      // Also save/sync user profile document in Firestore with photoURL
      if (db && result.user) {
        try {
          await setDoc(doc(db, "users", result.user.uid), {
            uid: result.user.uid,
            displayName: result.user.displayName || result.user.email?.split('@')[0] || 'Usuario',
            email: result.user.email || '',
            photoURL: result.user.photoURL || '',
            lastLogin: serverTimestamp()
          }, { merge: true });
        } catch (fsErr) {
          console.warn("[Firestore google user doc error]", fsErr);
        }
      }

      onClose();
    } catch (err: any) {
      const code = err?.code || 'auth/unknown';
      const msg = err?.message || String(err);
      console.error("[Auth Google Error] Code:", code, "Message:", msg, err);

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // Popup was dismissed or cancelled by the user - do not display an error
      } else if (code === 'auth/unauthorized-domain') {
        setIsUnauthorizedDomain(true);
        setError(`El dominio actual (${currentDomain}) no está autorizado en Firebase Console.`);
        setErrorCode(code);
      } else {
        setError(`Error al iniciar sesión con Google (${code}).`);
        setErrorCode(code);
      }
    } finally {
      setLoading(false);
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

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative z-10 w-full max-w-md bg-[#120b1c] border border-purple-900/50 rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[85vh] max-h-[85dvh] overflow-y-auto my-auto scrollbar-thin scrollbar-thumb-purple-900/50"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-purple-900/30">
            <h3 className="font-display font-semibold text-lg text-white">
              {isSignUp ? 'Crear Cuenta' : 'Iniciar Sesión'}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-950/60 border border-red-800/60 rounded-xl text-xs text-red-200 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                  <span>{error}</span>
                </div>
                {errorCode && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-red-900/80 border border-red-700/50 text-red-300 rounded shrink-0">
                    {errorCode}
                  </span>
                )}
              </div>

              {errorCode === 'auth/email-already-in-use' && (
                <div className="mt-1 pt-2 border-t border-red-800/40 flex items-center justify-between">
                  <span className="text-[11px] text-red-300">¿Quieres iniciar sesión con esta cuenta?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(false);
                      setError(null);
                      setErrorCode(null);
                    }}
                    className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer"
                  >
                    Ir a Iniciar Sesión
                  </button>
                </div>
              )}

              {isUnauthorizedDomain && (
                <div className="mt-1 pt-2 border-t border-red-800/40 space-y-2">
                  <p className="text-[11px] text-red-300">
                    Para autorizar este dominio en tu proyecto de Firebase:
                  </p>
                  <ol className="list-decimal list-inside text-[11px] text-neutral-300 space-y-1 pl-1">
                    <li>Abre <strong className="text-white">Firebase Console</strong> → Proyecto <strong className="text-purple-300">khentai</strong></li>
                    <li>Ve a <strong className="text-white">Authentication</strong> → pestaña <strong className="text-white">Settings</strong> → <strong className="text-white">Dominios autorizados</strong></li>
                    <li>Haz clic en <strong className="text-purple-300">Agregar dominio</strong> y pega la siguiente dirección:</li>
                  </ol>

                  <div className="flex items-center justify-between bg-black/50 border border-purple-500/30 rounded-lg p-2 font-mono text-xs text-purple-200">
                    <span className="truncate mr-2">{currentDomain}</span>
                    <button
                      type="button"
                      onClick={handleCopyDomain}
                      className="flex items-center gap-1 px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[10px] font-sans font-medium rounded transition-colors shrink-0 cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-green-300" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? '¡Copiado!' : 'Copiar Dominio'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Google Sign In Button */}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2.5 px-4 bg-white hover:bg-neutral-100 disabled:opacity-50 text-neutral-800 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2.5 cursor-pointer shadow-md active:scale-[0.99]"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>{loading ? 'Conectando...' : 'Continuar con Google'}</span>
            </button>
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-purple-900/40" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-mono">
              <span className="bg-[#120b1c] px-2 text-neutral-400">O con tu correo</span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {isSignUp && (
              <div>
                <label className="block text-xs font-mono text-neutral-400 mb-1">
                  NOMBRE DE USUARIO <span className="text-purple-400">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Escribe tu apodo (máx 10)"
                    className="w-full bg-[#180f26] border border-purple-900/50 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1">
                CORREO ELECTRÓNICO <span className="text-purple-400">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="w-full bg-[#180f26] border border-purple-900/50 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-neutral-400 mb-1">
                CONTRASEÑA <span className="text-purple-400">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-[#180f26] border border-purple-900/50 rounded-xl py-2.5 pl-9 pr-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-purple-900/30"
            >
              {isSignUp ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              <span>{loading ? 'Procesando...' : isSignUp ? 'Registrarse' : 'Iniciar Sesión'}</span>
            </button>
          </form>

          {/* Toggle Sign in / Sign up */}
          <div className="mt-5 pt-4 border-t border-purple-900/30 text-center text-xs text-neutral-400">
            {isSignUp ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta aún?'}
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setErrorCode(null);
              }}
              className="ml-1.5 text-purple-400 hover:text-purple-300 font-semibold underline cursor-pointer"
            >
              {isSignUp ? 'Inicia Sesión' : 'Regístrate aquí'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modalUI, document.body) : null;
}
