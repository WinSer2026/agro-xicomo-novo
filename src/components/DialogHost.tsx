import React, { useEffect, useRef, useState } from 'react';
import { DialogRequest, resolveDialog, subscribeDialogs } from '../utils/confirmDialog';

/**
 * Desenha os diálogos pedidos por `appConfirm` / `appPrompt` / `appAlert`.
 * Montado uma única vez em `App`. Não usa `window.*`, por isso funciona dentro
 * de iframes e de ambientes embebidos onde essas APIs são bloqueadas.
 */
export const DialogHost: React.FC = () => {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeDialogs(next => {
    setRequest(next);
    setInputValue(next && next.kind === 'prompt' ? next.defaultValue : '');
  }), []);

  useEffect(() => {
    if (request?.kind === 'prompt') {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [request]);

  if (!request) return null;

  const close = (value: boolean | string | null) => {
    resolveDialog(request.id, value);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={event => {
        if (event.target === event.currentTarget) close(request.kind === 'prompt' ? null : false);
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <span className={`material-symbols-outlined text-2xl ${request.kind === 'alert' ? 'text-sky-600' : 'text-amber-500'}`}>
            {request.kind === 'alert' ? 'info' : 'warning'}
          </span>
          <p className="text-sm text-slate-700 font-medium leading-relaxed whitespace-pre-line">
            {request.message}
          </p>
        </div>

        {request.kind === 'prompt' && (
          <div className="px-5 py-4">
            <input
              ref={inputRef}
              type="password"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') close(inputValue);
                if (event.key === 'Escape') close(null);
              }}
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder="Palavra-passe"
            />
          </div>
        )}

        <div className="px-5 py-4 bg-slate-50 flex justify-end gap-2">
          {request.kind !== 'alert' && (
            <button
              type="button"
              onClick={() => close(request.kind === 'prompt' ? null : false)}
              className="px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-100"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            autoFocus={request.kind !== 'prompt'}
            onClick={() => close(request.kind === 'prompt' ? inputValue : true)}
            className={`px-4 py-2 text-sm font-bold text-white rounded-xl ${
              request.kind === 'alert'
                ? 'bg-sky-600 hover:bg-sky-700'
                : request.kind === 'prompt' || request.danger
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
