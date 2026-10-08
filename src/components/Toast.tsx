import React from 'react';
import { createPortal } from 'react-dom';
import { describeError } from '../utils/errorHelper';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  /** descrição técnica opcional (erro) apresentada em texto pequeno */
  detail?: string;
  /** milissegundos até desaparecer; 0 = mantém visível */
  duration?: number;
  onClose?: () => void;
}

const STYLES: Record<ToastType, string> = {
  success: 'bg-emerald-600 border-emerald-800 text-white',
  error: 'bg-red-600 border-red-800 text-white',
  warning: 'bg-amber-500 border-amber-700 text-white',
  info: 'bg-slate-900 border-slate-700 text-white',
};

const ICONS: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

/**
 * Toast global.
 *
 * IMPORTANTE: é renderizado com `createPortal` para o <body> e usa z-[9999].
 * Antes cada módulo desenhava o seu próprio toast com `z-50`, ficando por
 * DEBAIXO dos modais (que também são `z-50`, mas aparecem depois no DOM).
 * Resultado: quando uma gravação falhava dentro de um modal, o utilizador
 * via "nada acontecer". Este componente resolve esse problema de forma global.
 */
export default function Toast({
  message,
  type = 'success',
  detail,
  duration = 5000,
  onClose,
}: ToastProps) {
  React.useEffect(() => {
    if (!duration || !onClose) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [duration, onClose, message]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 z-[9999] max-w-md p-4 rounded-xl shadow-2xl flex items-start gap-3 border ${STYLES[type]}`}
    >
      <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">{ICONS[type]}</span>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-snug break-words">{message}</p>
        {detail && <p className="text-[11px] opacity-90 mt-1 break-words font-mono">{detail}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto shrink-0 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          title="Fechar"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      )}
    </div>,
    document.body
  );
}

/** Estado + API de toast reutilizável por qualquer módulo. */
export interface ToastState {
  message: string;
  type: ToastType;
  detail?: string;
}

export function toastError(err: unknown, fallback: string): ToastState {
  const d = describeError(err, fallback);
  return {
    message: `${d.title} ${d.hint}`.trim(),
    type: 'error',
    detail: d.raw,
  };
}
