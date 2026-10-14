import React, { useEffect } from 'react';

/**
 * Toast unificado do sistema (Auditoria FASE 1, F-01).
 *
 * Comportamento universal de notificações:
 *  - desaparece automaticamente após `durationMs` (predefinição: 5 segundos);
 *  - tem botão de fechar manual;
 *  - substitui os vários toasts ad-hoc dos módulos (alguns sem auto-fecho,
 *    o que fazia as notificações acumularem-se no ecrã).
 *
 * O módulo mantém o estado `toastMessage` e passa-o a este componente; o
 * auto-fecho é gerido aqui, pelo que chamadas repetidas não deixam resíduos.
 */
interface ToastBannerProps {
  message: string;
  type?: 'success' | 'error' | 'warning';
  onClose: () => void;
  durationMs?: number;
}

export default function ToastBanner({ message, type = 'success', onClose, durationMs = 5000 }: ToastBannerProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onClose]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-[100] p-4 rounded-xl shadow-2xl flex items-center gap-3 border max-w-md ${
        type === 'success'
          ? 'bg-emerald-700 text-white border-emerald-800'
          : type === 'warning'
            ? 'bg-amber-500 text-slate-950 border-amber-600'
            : 'bg-red-600 text-white border-red-700'
      }`}
    >
      <span className="material-symbols-outlined">
        {type === 'success' ? 'check_circle' : type === 'warning' ? 'info' : 'warning'}
      </span>
      <span className="text-sm font-semibold flex-1">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar notificação"
        className="p-1 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}
