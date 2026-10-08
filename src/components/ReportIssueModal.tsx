import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, MessageSquareWarning, RefreshCw, ShieldCheck, Bot, Trash2 } from 'lucide-react';
import { User } from 'firebase/auth';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user' | 'admin';
  text: string;
  timestamp: string;
}

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
}

const DEFAULT_GREETING: ChatMessage = {
  id: 'greeting',
  sender: 'bot',
  text: '¡Hola! 👋 Aquí puedes reportar cualquier problema, video que no reproduzca o enlace caído, y también sugerir nuevos animes o funciones para la página. ¡Cuéntanos qué anime, episodio o idea tienes para que podamos revisarlo y responderte!',
  timestamp: 'Justo ahora'
};

const TELEGRAM_BOT_TOKEN = '8870602337:AAHM2VP4BPE1EHxgJFzjHyFu6fxyu71Cyd4';
const TELEGRAM_CHAT_ID = '8401789540';

interface QuickAction {
  label: string;
  template: string;
  hint: string;
  isSuggestion?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: '⚠️ Video no reproduce',
    template: '⚠️ Video no reproduce / Enlace caído\n• Anime: \n• Episodio: \n• Detalle: ',
    hint: 'Completa el nombre del anime y número de episodio antes de enviar'
  },
  {
    label: '💡 Sugerir un anime',
    template: '💡 Sugerencia de nuevo anime\n• Nombre del anime: \n• Temporada / Detalles: ',
    hint: 'Escribe el nombre del anime que te gustaría que agreguemos',
    isSuggestion: true
  },
  {
    label: '✨ Sugerir función',
    template: '✨ Sugerencia de nueva función\n• Función o mejora: \n• ¿Cómo te gustaría que funcione?: ',
    hint: 'Cuéntanos qué función o mejora te gustaría tener en la web',
    isSuggestion: true
  },
  {
    label: '🔊 Audio / Subtítulos',
    template: '🔊 Problema de audio o subtítulo\n• Anime: \n• Episodio: \n• Detalle del error: ',
    hint: 'Indica el anime, episodio y si falla el audio o subtítulo'
  },
  {
    label: '🐞 Error en la página',
    template: '🐞 Error o fallo en la web\n• Qué sucede: ',
    hint: 'Describe qué parte de la página presentó el error'
  }
];

export default function ReportIssueModal({
  isOpen,
  onClose,
  currentUser
}: ReportIssueModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('kh_report_chat_messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [DEFAULT_GREETING];
  });

  const [inputText, setInputText] = useState('');
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCheckingReplies, setIsCheckingReplies] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Compute effective userId for reply correlation
  const effectiveUserId = currentUser?.uid || (() => {
    let localAnonId = localStorage.getItem('kh_report_anon_id');
    if (!localAnonId) {
      localAnonId = 'anon-' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('kh_report_anon_id', localAnonId);
    }
    return localAnonId;
  })();

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, messages]);

  // Save messages in localStorage
  useEffect(() => {
    try {
      localStorage.setItem('kh_report_chat_messages', JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Check for admin replies from Telegram (Zero Firebase, 100% operational on Vercel)
  const fetchReplies = useCallback(async (manual = false) => {
    if (manual) setIsCheckingReplies(true);
    try {
      const userEmail = currentUser?.email || '';

      // 1. Direct Telegram Bot API getUpdates query (CORS enabled, works seamlessly on Vercel)
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=100`);
        if (tgRes.ok) {
          const tgData = await tgRes.json();
          if (tgData?.ok && Array.isArray(tgData.result)) {
            const matchedReplies: ChatMessage[] = [];

            // Extract user sent report snippets from localStorage for reliable quote matching
            let userReportSnippets: string[] = [];
            try {
              const raw = localStorage.getItem('kh_report_chat_messages');
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                  userReportSnippets = parsed
                    .filter((m: any) => m.sender === 'user' && m.text)
                    .map((m: any) => m.text.trim())
                    .filter((t: string) => t.length > 3);
                }
              }
            } catch {}

            for (const update of tgData.result) {
              const msg = update?.message;
              if (!msg || !msg.text) continue;
              if (msg.from && msg.from.is_bot) continue;

              const replyTo = msg.reply_to_message;
              let isForMe = false;

              if (replyTo) {
                const quotedText = replyTo.text || '';
                // 1. Match by user ID
                if (effectiveUserId && quotedText.includes(effectiveUserId)) {
                  isForMe = true;
                }
                // 2. Match by user email
                else if (userEmail && quotedText.includes(userEmail)) {
                  isForMe = true;
                }
                // 3. Match by user message snippet
                else if (userReportSnippets.some(s => quotedText.includes(s.slice(0, 25)))) {
                  isForMe = true;
                }
              } else {
                // Admin sent message in bot chat without quoting
                const isFromAdminChat =
                  String(msg.chat?.id) === String(TELEGRAM_CHAT_ID) ||
                  String(msg.from?.id) === String(TELEGRAM_CHAT_ID);
                const isNotCommand = !msg.text.startsWith('/');
                if (isFromAdminChat && isNotCommand && userReportSnippets.length > 0) {
                  // Only accept messages from the last 24h
                  const msgTime = (msg.date || 0) * 1000;
                  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
                  if (msgTime > oneDayAgo) {
                    isForMe = true;
                  }
                }
              }

              if (isForMe) {
                const replyId = 'tg-reply-' + (msg.message_id || update.update_id);
                matchedReplies.push({
                  id: replyId,
                  sender: 'admin',
                  text: msg.text,
                  timestamp: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
              }
            }

            if (matchedReplies.length > 0) {
              setMessages(prev => {
                const existingIds = new Set(prev.map(m => m.id));
                const newOnes = matchedReplies.filter(r => !existingIds.has(r.id));
                if (newOnes.length === 0) return prev;
                return [...prev, ...newOnes];
              });
            }
          }
        }
      } catch (tgErr) {
        console.warn('Telegram direct fetch error:', tgErr);
      }

      // 2. Fallback check on local Node endpoint if running with local server
      try {
        const params = new URLSearchParams({
          userId: effectiveUserId,
          email: userEmail
        });
        const res = await fetch(`/api/reports/replies?${params.toString()}`);
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json();
            if (data?.replies && Array.isArray(data.replies) && data.replies.length > 0) {
              setMessages(prev => {
                const existingIds = new Set(prev.map(m => m.id));
                const newReplies = data.replies.filter((r: any) => !existingIds.has(r.id));
                if (newReplies.length === 0) return prev;
                return [
                  ...prev,
                  ...newReplies.map((r: any) => ({
                    id: r.id,
                    sender: 'admin' as const,
                    text: r.text,
                    timestamp: r.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }))
                ];
              });
            }
          }
        }
      } catch {}
    } catch {
      // Ignore polling errors
    } finally {
      if (manual) {
        setTimeout(() => setIsCheckingReplies(false), 500);
      }
    }
  }, [effectiveUserId, currentUser?.email]);

  useEffect(() => {
    if (!isOpen) return;

    fetchReplies(false);
    const interval = setInterval(() => fetchReplies(false), 3000);
    return () => clearInterval(interval);
  }, [isOpen, fetchReplies]);

  if (!isOpen) return null;

  // Clicking a quick action fills the template in the input WITHOUT sending,
  // prompting the user to specify anime and episode.
  const handleSelectQuickAction = (action: QuickAction) => {
    setInputText(action.template);
    setActiveHint(action.hint);
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Position cursor at a convenient spot (after "• Anime: ")
      setTimeout(() => {
        if (textareaRef.current) {
          const animeIdx = action.template.indexOf('• Anime: ');
          if (animeIdx !== -1) {
            const pos = animeIdx + '• Anime: '.length;
            textareaRef.current.setSelectionRange(pos, pos);
          } else {
            const len = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(len, len);
          }
        }
      }, 50);
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsgId = 'user-' + Date.now();
    const newUserMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: timeStr
    };

    const isSuggestion = /sugerencia|sugerir|nueva funci|nuevo anime|idea/i.test(text);

    setMessages(prev => [...prev, newUserMsg]);
    setInputText('');
    setActiveHint(null);
    setIsSending(true);

    try {
      const now = new Date();
      const dateFormatted = now.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const headerTitle = isSuggestion 
        ? `💡 *NUEVA SUGERENCIA DE USUARIO*`
        : `🚨 *REPORTE DE PROBLEMA O FALLO*`;

      const userDisplay = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuario Anónimo';
      const userEmail = currentUser?.email || '';

      const telegramText = 
        `${headerTitle}\n\n` +
        `👤 *Usuario:* ${userDisplay}\n` +
        (userEmail ? `📧 *Correo:* ${userEmail}\n` : '') +
        `🆔 *ID Usuario:* \`${effectiveUserId}\`\n` +
        `💬 *Mensaje:*\n${text}\n\n` +
        `📅 *Fecha:* ${dateFormatted}\n` +
        (typeof navigator !== 'undefined' ? `📱 *Dispositivo:* ${navigator.userAgent.slice(0, 70)}...\n\n` : '\n') +
        `💬 👉 *Para responderle al usuario:* Mantén presionado este mensaje y selecciona *Responder* (Reply) para escribirle tu respuesta.`;

      // 1. Envío DIRECTO a Telegram (Garantizado en Vercel, Netlify o cualquier hosting)
      const directPromise = fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: telegramText,
          parse_mode: 'Markdown'
        })
      }).catch(err => {
        console.warn('Direct Telegram fetch warning:', err);
      });

      // 2. Respaldo a endpoint local /api/reports si corre con Node
      const backendPromise = fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: effectiveUserId,
          userName: userDisplay,
          userEmail,
          message: text,
          deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        })
      }).catch(() => null);

      await Promise.race([directPromise, new Promise(res => setTimeout(res, 2000))]);
    } catch (err) {
      console.warn('Report dispatch error:', err);
    } finally {
      setIsSending(false);
    }

    // Automated friendly bot response
    setTimeout(() => {
      const botMsgId = 'bot-' + Date.now();
      const botResponse: ChatMessage = {
        id: botMsgId,
        sender: 'bot',
        text: isSuggestion
          ? '¡Muchas gracias por tu sugerencia! 💡 La hemos recibido directamente. Te responderemos aquí mismo cuando la revisemos o agreguemos.'
          : '¡Reporte recibido con éxito! ✅ Muchas gracias por tu aviso. El administrador lo está revisando y te responderá aquí mismo cuando quede solucionado.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botResponse]);
    }, 700);
  };

  const handleClearChat = () => {
    setMessages([DEFAULT_GREETING]);
    setActiveHint(null);
    try {
      localStorage.removeItem('kh_report_chat_messages');
    } catch {}
  };

  const modalUI = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000000] flex items-center justify-center p-3 sm:p-4 h-screen h-[100dvh] w-screen w-[100dvw] overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-0"
        />

        {/* Chat Window Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.8 }}
          style={{ willChange: 'transform, opacity' }}
          className="relative z-10 w-full max-w-[450px] h-[570px] max-h-[90vh] max-h-[90dvh] bg-[#110822] border border-purple-900/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-[#160b2d] border-b border-purple-900/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-700 via-amber-500 to-[#ff5588] flex items-center justify-center shadow-md">
                  <MessageSquareWarning className="h-4 w-4 text-white" />
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#160b2d] rounded-full animate-pulse" />
              </div>
              <div>
                <h3 className="font-display font-bold text-xs sm:text-sm text-white tracking-wide flex items-center gap-1.5">
                  <span>Reporte de problemas o sugerencias</span>
                </h3>
                <p className="text-[10px] text-purple-300/80 font-mono flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Soporte y Sugerencias • En línea
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fetchReplies(true)}
                disabled={isCheckingReplies}
                className="p-1.5 text-neutral-400 hover:text-emerald-300 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                title="Comprobar respuestas del administrador"
              >
                <RefreshCw className={`h-3.5 w-3.5 transition-transform ${isCheckingReplies ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleClearChat}
                className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                title="Limpiar mensajes"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Cerrar chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollbar-thin scrollbar-thumb-purple-900/40 bg-[#0e061c]/90">
            {messages.map(msg => {
              const isUser = msg.sender === 'user';
              const isAdmin = msg.sender === 'admin';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {isAdmin && (
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 mb-1 px-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      <span>Respuesta del Administrador:</span>
                    </div>
                  )}
                  {msg.sender === 'bot' && msg.id !== 'greeting' && (
                    <div className="flex items-center gap-1 text-[10px] text-purple-400/80 mb-0.5 px-1">
                      <Bot className="w-3 h-3" />
                      <span>Asistente Automático</span>
                    </div>
                  )}

                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-md ${
                      isUser
                        ? 'bg-gradient-to-r from-purple-700 to-[#e11d48] text-white rounded-br-xs font-sans'
                        : isAdmin
                        ? 'bg-gradient-to-r from-emerald-950/90 to-[#0e2a22] border border-emerald-600/50 text-emerald-100 rounded-bl-xs font-sans shadow-emerald-950/40'
                        : 'bg-[#1b1031] border border-purple-900/50 text-neutral-200 rounded-bl-xs font-sans'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>
                  <span className="text-[9px] font-mono text-neutral-500 mt-1 px-1">
                    {msg.timestamp}
                  </span>
                </div>
              );
            })}

            {isSending && (
              <div className="flex items-center gap-2 text-neutral-400 text-xs font-mono">
                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:0.4s]" />
                <span className="text-[10px] text-purple-300">Enviando mensaje...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions Chips (Click to fill template, does not send immediately) */}
          <div className="px-3 py-2 bg-[#140a28] border-t border-purple-950 flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between text-[10px] font-mono text-purple-300/70">
              <span>Plantillas rápidas (toca para rellenar datos):</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectQuickAction(action)}
                  className={`px-2.5 py-1 text-[10px] font-sans rounded-full shrink-0 transition-all cursor-pointer select-none border flex items-center gap-1 active:scale-95 ${
                    action.isSuggestion
                      ? 'text-amber-200 bg-amber-950/40 border-amber-700/50 hover:bg-amber-800/40'
                      : 'text-purple-200 bg-[#1e1039] border-purple-800/40 hover:bg-purple-800/50'
                  }`}
                  title="Toca para rellenar la plantilla"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active Hint Banner */}
          {activeHint && (
            <div className="px-3 py-1.5 bg-amber-500/10 border-t border-amber-500/20 flex items-center justify-between shrink-0">
              <p className="text-[11px] text-amber-300 font-sans flex items-center gap-1.5">
                <span className="text-xs">✏️</span>
                <span>{activeHint}</span>
              </p>
              <button
                type="button"
                onClick={() => setActiveHint(null)}
                className="text-amber-400/70 hover:text-amber-300 text-[10px] ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-[#160b2d] border-t border-purple-900/40 flex items-end gap-2 shrink-0"
          >
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                placeholder="Escribe el problema o sugerencia (Shift+Enter para salto de línea)..."
                className="w-full bg-[#0c0517] text-white text-xs placeholder:text-neutral-500 rounded-xl px-3.5 py-2.5 pr-3 border border-purple-900/60 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all resize-none font-sans"
              />
            </div>
            <button
              type="submit"
              disabled={!inputText.trim() || isSending}
              className="p-2.5 mb-1 bg-gradient-to-r from-purple-600 via-pink-600 to-[#e11d48] text-white rounded-xl hover:opacity-90 active:scale-95 transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-purple-950/50 shrink-0"
              title="Enviar mensaje"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return createPortal(modalUI, document.body);
}
