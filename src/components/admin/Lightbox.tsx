/**
 * Lightbox
 *
 * Modal viewer for the section image gallery. Supports:
 * - Esc / background click / × button to close
 * - ◀ / ▶ buttons or ← / → keys to navigate
 * - counter "3 / 12" at the bottom
 *
 * The image and the controls don't close the modal on click so
 * navigation feels responsive and the user can interact with the
 * picture (e.g. browser zoom) without losing the view.
 */

import { useEffect, useState } from 'react';

export interface LightboxImage {
  url: string;
  alt: string;
}

interface Props {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

export default function Lightbox({ images, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);

  const total = images.length;
  const current = images[index];
  const canPrev = index > 0;
  const canNext = index < total - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < total - 1) setIndex(index + 1);
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, index, total]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="画像プレビュー"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center"
        aria-label="閉じる"
      >
        ×
      </button>

      {canPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
          aria-label="前の画像"
        >
          ◀
        </button>
      )}

      {canNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
          aria-label="次の画像"
        >
          ▶
        </button>
      )}

      <img
        src={current.url}
        alt={current.alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain"
      />

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-white text-sm font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {index + 1} / {total}
      </div>
    </div>
  );
}
