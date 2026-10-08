import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-xl bg-purple-600/90 hover:bg-purple-600 px-3 py-1.5 text-xs font-mono font-bold text-white shadow-md shadow-purple-900/30 transition-all cursor-pointer active:scale-95 border border-purple-400/30"
        title="Instalar aplicación en dispositivo"
      >
        <Download className="w-3.5 h-3.5 text-pink-300" />
        <span className="hidden sm:inline">Instalar App</span>
        <span className="sm:hidden">Instalar</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-xl bg-[#1d1233] hover:bg-[#281845] border border-purple-500/30 px-2.5 py-1.5 text-xs font-mono font-medium text-neutral-200 transition-all cursor-pointer active:scale-95"
          title="Instalar en iOS"
        >
          <Download className="w-3.5 h-3.5 text-pink-400" />
          <span className="hidden sm:inline">Instalar App</span>
          <span className="sm:hidden">Instalar</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#12091c] border border-purple-800/40 p-6 shadow-2xl text-white space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-display font-bold text-white">Instalar en iPhone / iPad</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed space-y-1.5">
                <span className="block">1. Toca el botón <strong>Compartir</strong> <span className="text-pink-400 font-mono">(icono del cuadrado con flecha hacia arriba)</span> en Safari.</span>
                <span className="block">2. Desplázate hacia abajo y selecciona <strong>"Agregar a pantalla de inicio"</strong>.</span>
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-2 w-full rounded-xl bg-purple-600 hover:bg-purple-500 py-2.5 text-xs font-mono font-bold text-white shadow-md transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
