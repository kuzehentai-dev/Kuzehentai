import React from 'react';

interface KhBrandLogoProps {
  className?: string;
}

export default function KhBrandLogo({ className = "h-8 sm:h-9 w-auto" }: KhBrandLogoProps) {
  return (
    <svg
      viewBox="0 0 320 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="KuzeHentai - KH"
      style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.7))' }}
    >
      {/* Left Vertical Stem of K */}
      <rect x="30" y="30" width="46" height="240" rx="3" fill="#6a2b94" />

      {/* Right Vertical Stem of H */}
      <rect x="244" y="30" width="46" height="240" rx="3" fill="#6a2b94" />

      {/* Crossbar of H */}
      <rect x="150" y="132" width="96" height="38" fill="#6a2b94" />

      {/* Center-left Vertical Stem of H */}
      <rect x="150" y="132" width="46" height="138" rx="3" fill="#6a2b94" />

      {/* Upper Arm of K - Dynamic arching blade swooping up and right */}
      <path
        d="M76 150 C98 126 128 82 178 30 C182 26 192 28 190 36 C186 52 165 96 142 136 C134 150 126 158 116 164 Z"
        fill="#6a2b94"
      />
      <path
        d="M116 136 C138 98 162 56 190 30 C176 50 152 96 132 146 Z"
        fill="#6a2b94"
      />

      {/* Lower Arm of K - Sweeping down-right with curved finial hook */}
      <path
        d="M104 154 L138 154 L188 238 C198 256 216 268 244 270 C216 270 190 256 172 226 Z"
        fill="#6a2b94"
      />
      <path
        d="M138 154 C158 192 182 238 236 270 C206 268 184 252 168 226 L124 154 Z"
        fill="#6a2b94"
      />
    </svg>
  );
}
