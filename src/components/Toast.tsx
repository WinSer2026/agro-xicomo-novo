import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'success' | 'error' | 'warning';

interface ToastProps {
  message: string;
  type?: ToastKind;
  /** Auto-dismiss em ms (0 = não desaparece sozinho). */
  duration?: number;
  onDismiss?: () => void;
}

const ICONS: Record<ToastKind, string> = {
  success: 'check_circle',
  error: 'warning',
  warning: 'info'
};

const STYLES: Record<ToastKind, string> = {
  success: 'bg-emerald-700 text-white border-emerald-800',
  error: 'bg-red-600 text-white border-red-700',
  warning: 'bg-amber-500 text-slate-950 border-amber-600'
};

/**
 * Toast global renderizado num portal em `document.body` com z-index máximo.
 *
 * MOTIVO: os toasts antigos eram desenhados dentro da página, com o mesmo z-index
 * dos modais de ecrã inteiro e ANTES deles no DOM — ficavam escondidos atrás dos
 * modais e o operador via "clicar e não acontecer nada" mesmo quando a operação
 * até tinha falhado/morrido com sucesso. Numa notificação nunca pode ficar tapada.
 */
export default function Toast({ message, type = 'success', duration = 4000, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message || !onDismiss || duration <= 0) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [message, duration, onDismiss]);

  // Success confirmations are intentionally silent across the whole application.
  // Keep warnings, errors, and validation feedback visible to the operator.
  if (!message || typeof document === 'undefined' || type === 'success') return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-[9999] max-w-md p-4 rounded-xl shadow-2xl flex items-center gap-3 border ${STYLES[type]}`}
    >
      <span className="material-symbols-outlined">{ICONS[type]}</span>
      <span className="text-sm font-semibold">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
          aria-label="Fechar notificação"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      )}
    </div>,
    document.body
  );
}
