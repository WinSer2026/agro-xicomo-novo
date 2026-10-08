import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** texto a digitar para confirmar (operações destrutivas) */
  requireTypedText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Caixa de confirmação própria da aplicação.
 *
 * Substitui `window.confirm`, que é BLOQUEADO pelo navegador quando a app
 * corre dentro de um iframe em sandbox (pré-visualizações, AI Studio, etc.).
 * Nesses ambientes o `window.confirm` devolve sempre `false` e o utilizador
 * tem a sensação de que "carregou e não aconteceu nada".
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  requireTypedText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  const canConfirm = !busy && (!requireTypedText || typed.trim().toUpperCase() === requireTypedText.trim().toUpperCase());

  return createPortal(
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[9998] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                danger ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'
              }`}
            >
              <span className="material-symbols-outlined">{danger ? 'warning' : 'help'}</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed whitespace-pre-line">{message}</p>
            </div>
          </div>

          {requireTypedText && (
            <div className="mt-4">
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                Escreva <span className="text-red-600">{requireTypedText}</span> para confirmar
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-indigo-600"
                placeholder={requireTypedText}
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white transition-colors flex items-center justify-center gap-2 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            } ${canConfirm ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
          >
            {busy && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
            {busy ? 'A processar...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
