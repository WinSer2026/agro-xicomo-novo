import React, { useState } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Se indicado, o utilizador tem de escrever este texto para ativar a confirmação. */
  requireTypedText?: string;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  request: ConfirmRequest;
  onClose: () => void;
}

/**
 * Diálogo de confirmação próprio, em substituição do `window.confirm`.
 *
 * MOTIVO: dentro de iframes em sandbox (e em contextos com políticas restritivas)
 * o `confirm()` nativo é bloqueado ou devolve `false` sem mostrar nada — os botões
 * destrutivos passavam a ser "mortos" (clicar e não acontecer nada).
 */
export default function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  const needsTyping = Boolean(request.requireTypedText);
  const typingOk = !needsTyping || typed.trim() === request.requireTypedText;

  const handleConfirm = async () => {
    if (busy || !typingOk) return;
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${request.danger ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            <span className="material-symbols-outlined">{request.danger ? 'warning' : 'help'}</span>
          </div>
          <div>
            <h3 className="font-black text-slate-900 text-base">{request.title}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{request.message}</p>
          </div>
        </div>

        {needsTyping && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">
              Escreva <span className="font-mono bg-slate-100 px-1 rounded">{request.requireTypedText}</span> para confirmar:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            {request.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !typingOk}
            className={`px-5 py-2 text-sm font-black rounded-lg text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              request.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {busy ? 'A processar…' : (request.confirmLabel || 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook auxiliar para pedir confirmações a partir de qualquer módulo. */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const askConfirm = (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    opts?: Omit<ConfirmRequest, 'title' | 'message' | 'onConfirm'>
  ) => setRequest({ title, message, onConfirm, ...(opts || {}) });

  const dialog = request ? (
    <ConfirmDialog request={request} onClose={() => setRequest(null)} />
  ) : null;

  return { askConfirm, dialog };
}
