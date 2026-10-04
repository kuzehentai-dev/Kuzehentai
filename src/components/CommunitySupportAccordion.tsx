import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronDown, 
  UserPlus, 
  User, 
  Send, 
  Download, 
  ExternalLink,
  ArrowLeftRight
} from 'lucide-react';

interface CommunitySupportAccordionProps {
  telegramUrl?: string;
}

export default function CommunitySupportAccordion({
  telegramUrl = 'https://t.me/kuzehenta'
}: CommunitySupportAccordionProps) {
  // Inicia cerrado por defecto
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full bg-[#120a1f] border border-purple-900/50 hover:border-purple-700/60 rounded-xl shadow-lg transition-all duration-300 overflow-hidden">
      {/* Botón / Encabezado colapsable */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between text-left cursor-pointer select-none bg-gradient-to-r from-purple-950/30 to-transparent hover:bg-purple-950/50 transition-colors"
        aria-expanded={isOpen}
        aria-label="Desplegar guía y soporte de la comunidad"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-purple-900/40 border border-purple-700/50 text-[#ff5588] shrink-0 shadow-xs">
            <Send className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-mono text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              GUÍA Y SOPORTE DE LA COMUNIDAD
            </h3>
            <p className="text-[10px] text-purple-300/70 font-mono hidden sm:block mt-0.5">
              Haz clic para desplegar consejos útiles y acceso al grupo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono text-purple-300/80 uppercase tracking-wider hidden xs:inline-block">
            {isOpen ? 'Ocultar' : 'Ver'}
          </span>
          <div className={`p-1 rounded-md bg-purple-950/60 border border-purple-800/40 text-neutral-300 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand-red border-brand-red/40' : ''}`}>
            <ChevronDown className="h-3.5 w-3.5" />
          </div>
        </div>
      </button>

      {/* Contenido desplegable con animación */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="accordion-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 border-t border-purple-900/30 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {/* 1. Ícono de usuario + */}
                <div className="p-3.5 rounded-xl bg-[#170e28] border border-purple-900/40 flex items-start gap-3.5 hover:border-purple-700/50 transition-colors">
                  <div className="p-2 rounded-lg bg-purple-900/50 border border-purple-600/40 text-purple-300 shrink-0 mt-0.5">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5">
                    <span className="font-mono text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
                      Cuenta y Participación
                    </span>
                    <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                      Regístrate para comentar, calificar o guardar tus animes favoritos.
                    </p>
                  </div>
                </div>

                {/* 2. Ícono de perfil / silueta */}
                <div className="p-3.5 rounded-xl bg-[#170e28] border border-purple-900/40 flex items-start gap-3.5 hover:border-purple-700/50 transition-colors">
                  <div className="p-2 rounded-lg bg-purple-900/50 border border-purple-600/40 text-purple-300 shrink-0 mt-0.5">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5">
                    <span className="font-mono text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
                      Acceso a tu lista
                    </span>
                    <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                      Encuentra tus animes guardados haciendo clic en el ícono de tu perfil (esquina superior derecha).
                    </p>
                  </div>
                </div>

                {/* 3. Ícono de Telegram / Mensaje (con botón clickable al grupo) */}
                <div className="p-3.5 rounded-xl bg-[#170e28] border border-purple-900/40 flex items-start gap-3.5 hover:border-purple-700/50 transition-colors col-span-1 md:col-span-2">
                  <div className="p-2 rounded-lg bg-[#229ED9]/20 border border-[#229ED9]/40 text-[#229ED9] shrink-0 mt-0.5">
                    <Send className="h-4 w-4" />
                  </div>
                  <div className="space-y-2 flex-1 sm:flex sm:items-center sm:justify-between sm:space-y-0 gap-4">
                    <div>
                      <span className="font-mono text-[10px] font-bold text-[#229ED9] uppercase tracking-wider block">
                        Comunidad & Sugerencias
                      </span>
                      <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                        Únete a nuestro grupo de Telegram para reportar errores, solicitar animes o enviarnos sugerencias.
                      </p>
                    </div>
                    <a
                      href={telegramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#229ED9]/20 hover:bg-[#229ED9]/30 border border-[#229ED9]/50 text-[#4ac1ff] hover:text-white text-xs font-mono font-semibold transition-all duration-200 shadow-xs cursor-pointer active:scale-95 shrink-0"
                    >
                      <Send className="h-3 w-3" />
                      <span>Unirse al Grupo</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* 4. Gestos de deslizamiento (Swipe) */}
                <div className="p-3.5 rounded-xl bg-[#170e28] border border-purple-900/40 flex items-start gap-3.5 hover:border-purple-700/50 transition-colors col-span-1 md:col-span-2">
                  <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-emerald-400 shrink-0 mt-0.5">
                    <ArrowLeftRight className="h-4 w-4" />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <span className="font-mono text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">
                      Gestos de Deslizamiento (Swipe)
                    </span>
                    <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                      Desliza el dedo en cualquier parte de la pantalla para moverte fácilmente:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5 font-sans text-xs text-neutral-300">
                      <div className="flex items-center gap-2 bg-purple-950/40 px-2.5 py-1.5 rounded-lg border border-purple-800/30">
                        <span className="text-sm shrink-0">👈</span>
                        <span><strong className="text-white font-medium">A la izquierda:</strong> Pasa al catálogo o avanza de página.</span>
                      </div>
                      <div className="flex items-center gap-2 bg-purple-950/40 px-2.5 py-1.5 rounded-lg border border-purple-800/30">
                        <span className="text-sm shrink-0">👉</span>
                        <span><strong className="text-white font-medium">A la derecha:</strong> Retrocede de página o sal de detalles y videos.</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Descarga de Episodios en Telegram (Agregado de último) */}
                <div className="p-3.5 rounded-xl bg-[#170e28] border border-purple-900/40 flex items-start gap-3.5 hover:border-purple-700/50 transition-colors col-span-1 md:col-span-2">
                  <div className="p-2 rounded-lg bg-pink-950/60 border border-pink-700/50 text-[#ff5588] shrink-0 mt-0.5">
                    <Download className="h-4 w-4" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <span className="font-mono text-[10px] font-bold text-[#ff5588] uppercase tracking-wider block">
                      Descarga de Episodios en Telegram
                    </span>
                    <p className="text-xs text-neutral-200 leading-relaxed font-sans">
                      Las descargas están alojadas en Telegram. Al presionar el botón de <strong className="text-white font-medium">Descargar</strong> dentro de los detalles de un anime, se abrirá directamente el enlace en Telegram para descargar el episodio.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
