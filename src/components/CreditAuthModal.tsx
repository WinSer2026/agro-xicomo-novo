import React, { useState } from 'react';
import type { SystemSettings } from '../types';
import { isAuthorizationConfigured, verifyAuthorizationPassword } from '../utils/authorization';
import { CREDIT_LIMIT_MT } from '../utils/creditRules';

/**
 * Autorização da gerência para vender a crédito acima do limite.
 *
 * Existe porque a regra do dono é de 20.000 MT por cliente: acima disso, quem
 * responde é a gerência. O código pedido é o mesmo do stock (código de gestor),
 * para não haver três códigos diferentes no balcão.
 */
interface CreditAuthModalProps {
  customerName: string;
  amount: number;
  outstanding: number;
  reasons: string[];
  settings: SystemSettings | null;
  onAuthorized: () => void;
  onClose: () => void;
}

export default function CreditAuthModal({
  customerName,
  amount,
  outstanding,
  reasons,
  settings,
  onAuthorized,
  onClose
}: CreditAuthModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const configured = isAuthorizationConfigured(settings);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!configured) {
      setError('Não há código de gestor definido. Peça ao técnico para o definir no Painel Técnico antes de autorizar crédito acima do limite.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ok = await verifyAuthorizationPassword(password, settings);
      if (!ok) {
        setError('Código de gestor incorrecto.');
        return;
      }
      onAuthorized();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-3 border border-slate-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">verified_user</span>
          </div>
          <div>
            <h3 className="font-black text-slate-900 text-base leading-tight">Crédito acima do limite</h3>
            <p className="text-[11px] text-slate-600 mt-1">
              Cliente: <strong>{customerName}</strong> · dívida actual {outstanding.toFixed(2)} MT · esta venda {amount.toFixed(2)} MT
              (limite {CREDIT_LIMIT_MT.toFixed(2)} MT).
            </p>
          </div>
        </div>

        {reasons.length > 0 && (
          <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
            {reasons.map((motivo, i) => <p key={i} className="text-[11px] text-amber-900">{motivo}</p>)}
          </div>
        )}

        <label className="block">
          <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">Código de gestor</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-900"
            placeholder="Código de autorização"
          />
        </label>

        {error && <p className="text-[11px] text-red-700 font-semibold">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-600">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="flex-1 py-2 rounded-lg bg-slate-900 text-white text-xs font-black uppercase disabled:opacity-50">
            {busy ? 'A verificar…' : 'Autorizar'}
          </button>
        </div>

        <p className="text-[10px] text-slate-400">
          A autorização fica registada na venda e no registo de auditoria com o nome do operador e a hora.
        </p>
      </form>
    </div>
  );
}
