import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CashCounts, CashSession } from '../types';
import { loadShiftOverview, openShift, closeShift } from '../utils/shifts';
import { CASH_METHODS, computeCountsDifference, round2, totalOf } from '../utils/cashSessions';

/**
 * Troca de turno da caixa.
 *
 * Existe porque não se sabe como a empresa vai organizar os turnos: quem está no
 * balcão carrega no botão quando passa o dinheiro à pessoa seguinte. Não há
 * horários fixos nem fundo de maneio inventado.
 *
 * O ecrã mostra, por método de pagamento, quanto o sistema espera e deixa
 * escrever quanto foi contado. Se houver qualquer diferença, a justificação é
 * obrigatória — não há tolerância de 50 MT nem de 5 MT (decisão do dono).
 */

interface ShiftChangeModalProps {
  currentUser: string;
  onClose: () => void;
  /** Chamado depois de abrir ou fechar um turno, para o cabeçalho refrescar. */
  onChanged?: () => void;
}

function money(value: number): string {
  return `${(Number(value) || 0).toFixed(2)} MT`;
}

export default function ShiftChangeModal({ currentUser, onClose, onChanged }: ShiftChangeModalProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [session, setSession] = useState<CashSession | null>(null);
  const [expected, setExpected] = useState<CashCounts>({});
  const [history, setHistory] = useState<CashSession[]>([]);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [openingCounts, setOpeningCounts] = useState<Record<string, string>>({ Dinheiro: '' });
  const [openingNote, setOpeningNote] = useState('');
  const [countedBy, setCountedBy] = useState(currentUser);
  const [verifiedBy, setVerifiedBy] = useState(currentUser);
  const [justification, setJustification] = useState('');

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const overview = await loadShiftOverview();
      setSession(overview.session);
      setHistory(overview.history);
      const esperado: CashCounts = overview.expected?.expected || {};
      setExpected(esperado);
      // Campos vazios de propósito: o operador conta, não copia.
      const inicial: Record<string, string> = {};
      Object.keys(esperado).forEach(method => { inicial[method] = ''; });
      setCounts(inicial);
      const abertura: Record<string, string> = {};
      CASH_METHODS.forEach(method => { abertura[method] = ''; });
      setOpeningCounts(abertura);
    } catch (erro) {
      console.error('[Turnos] Falha ao ler o turno:', erro);
      setLoadError('Não foi possível ler o turno de caixa. Sem leitura fiável não se abre nem fecha nada — tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const methodsToCount = useMemo(() => {
    const set = new Set<string>(Object.keys(expected));
    CASH_METHODS.forEach(method => set.add(method));
    return Array.from(set);
  }, [expected]);

  const countedNumeric: CashCounts = useMemo(() => {
    const result: CashCounts = {};
    methodsToCount.forEach(method => {
      const raw = counts[method];
      if (raw === undefined || String(raw).trim() === '') return;
      const valor = round2(Number(String(raw).replace(',', '.')) || 0);
      result[method] = valor;
    });
    return result;
  }, [counts, methodsToCount]);

  const differenceCounts = useMemo(
    () => computeCountsDifference(expected, countedNumeric),
    [expected, countedNumeric]
  );
  const difference = totalOf(differenceCounts);
  const hasDifference = Object.values(differenceCounts).some((v: number) => Math.abs(v) >= 0.01);

  const handleOpen = async () => {
    if (busy) return;
    setBusy(true); setErrors([]); setWarnings([]);
    try {
      const contagem: CashCounts = {};
      Object.entries(openingCounts).forEach(([method, raw]) => {
        if (raw === undefined || String(raw).trim() === '') return;
        const valor = round2(Number(String(raw).replace(',', '.')) || 0);
        if (valor !== 0) contagem[method] = valor;
      });
      const aberto = await openShift({
        openedBy: currentUser,
        openingCounts: contagem,
        note: openingNote,
        isFirstSession: history.length === 0
      });
      setDone(`Turno ${aberto.number} aberto com ${money(totalOf(contagem))} na gaveta.`);
      onChanged?.();
      await load();
    } catch (erro) {
      setErrors([erro instanceof Error ? erro.message : 'Não foi possível abrir o turno.']);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Fecha o turno.
   *
   * `openNext = true`  → fecha e abre já o seguinte com o dinheiro contado
   *                      (a troca de turno normal, com alguém a receber).
   * `openNext = false` → SÓ fecha. O próximo turno fica por abrir, à espera do
   *                      botão "Abrir turno". Serve para fechar no fim do dia,
   *                      ao fechar para almoço, ou quando ainda não se sabe
   *                      quem vai ficar na caixa.
   *
   * Em qualquer dos casos, a contagem, a diferença e as assinaturas são
   * gravadas da mesma forma — o que muda é apenas se nasce um turno novo.
   */
  const handleClose = async (openNext: boolean) => {
    if (busy || !session) return;
    setBusy(true); setErrors([]); setWarnings([]);
    try {
      const resultado = await closeShift({
        session,
        countedBy,
        verifiedBy,
        counted: countedNumeric,
        justification,
        openNext
      });
      setWarnings(resultado.warnings);
      if (!resultado.ok) {
        setErrors(resultado.errors);
        return;
      }
      const numeroFechado = resultado.closed?.number ?? session.number;
      setDone(
        `Turno ${numeroFechado} fechado. Diferença: ${money(resultado.difference || 0)}.` +
        (resultado.next
          ? ` Turno ${resultado.next.number} aberto com o dinheiro contado.`
          : (openNext
              ? ' A abrir o turno seguinte falhou — abra manualmente quando precisar.'
              : ' Não foi aberto nenhum turno novo: a caixa fica fechada até alguém carregar em "Abrir turno".'))
      );
      setJustification('');
      onChanged?.();
      await load();
    } catch (erro) {
      setErrors([erro instanceof Error ? erro.message : 'Não foi possível fechar o turno.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-3 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto border border-slate-200">

        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">swap_horiz</span>
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base leading-tight">Troca de turno da caixa</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Conta-se o dinheiro, assina-se quem conta e quem confere, e o turno seguinte começa com o que existe na gaveta.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" title="Fechar">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">A ler o turno…</div>
        ) : loadError ? (
          <div className="p-4 space-y-3">
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-semibold">{loadError}</div>
            <button onClick={() => void load()} className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-bold">Tentar novamente</button>
          </div>
        ) : (
          <div className="p-4 space-y-4">

            {done && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">{done}</div>
            )}
            {errors.length > 0 && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-1">
                {errors.map((erro, i) => <p key={i} className="text-xs text-red-800 font-semibold">• {erro}</p>)}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                {warnings.map((aviso, i) => <p key={i} className="text-xs text-amber-800 font-semibold">• {aviso}</p>)}
              </div>
            )}

            {!session ? (
              /* ---------- Sem turno aberto: abrir ---------- */
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-xs font-bold text-slate-800">Não há turno aberto.</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {history.length === 0
                      ? 'Primeiro turno: conte o dinheiro que está na gaveta agora e escreva-o abaixo. É a única vez que o sistema não tem um turno anterior para transportar.'
                      : 'O turno seguinte começa normalmente com o dinheiro contado no fecho anterior. Se está a abrir outro, escreva quanto tem na gaveta.'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CASH_METHODS.map(method => (
                    <label key={method} className="block">
                      <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">{method}</span>
                      <input
                        type="number" min="0" step="0.01" inputMode="decimal"
                        value={openingCounts[method] ?? ''}
                        onChange={e => setOpeningCounts(prev => ({ ...prev, [method]: e.target.value }))}
                        placeholder="0,00"
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:border-slate-900"
                      />
                    </label>
                  ))}
                </div>
                <label className="block">
                  <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">Nota de abertura (opcional)</span>
                  <input
                    value={openingNote}
                    onChange={e => setOpeningNote(e.target.value)}
                    placeholder="Ex.: turno da manhã, dinheiro contado com o gerente"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-slate-900"
                  />
                </label>
                <button
                  onClick={handleOpen}
                  disabled={busy}
                  className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black uppercase tracking-wide disabled:opacity-50"
                >
                  {busy ? 'A abrir…' : 'Abrir turno'}
                </button>
                {history.length > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Último fecho: turno {history[0].number}
                    {history[0].closingCounts ? ` · contado ${money(totalOf(history[0].closingCounts))}` : ''}
                    {typeof history[0].difference === 'number' ? ` · diferença ${money(history[0].difference)}` : ''}
                  </p>
                )}
              </div>
            ) : (
              /* ---------- Turno aberto: fechar ---------- */
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-slate-900 text-white flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Turno aberto</p>
                    <p className="text-sm font-black">N.º {session.number} · {session.openedBy}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Aberto em</p>
                    <p className="text-xs font-bold">
                      {session.openedAt ? new Date(session.openedAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[9px] uppercase text-slate-500 border-b border-slate-200">
                        <th className="text-left py-1.5 font-black">Método</th>
                        <th className="text-right py-1.5 font-black">Sistema espera</th>
                        <th className="text-right py-1.5 font-black">Contado</th>
                        <th className="text-right py-1.5 font-black">Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {methodsToCount.map(method => {
                        const diff = differenceCounts[method] || 0;
                        const semContagem = counts[method] === undefined || String(counts[method]).trim() === '';
                        return (
                          <tr key={method} className="border-b border-slate-100">
                            <td className="py-1.5 font-bold text-slate-700">{method}</td>
                            <td className="py-1.5 text-right font-mono text-slate-600">{money(expected[method] || 0)}</td>
                            <td className="py-1.5 text-right">
                              <input
                                type="number" min="0" step="0.01" inputMode="decimal"
                                value={counts[method] ?? ''}
                                onChange={e => setCounts(prev => ({ ...prev, [method]: e.target.value }))}
                                placeholder="—"
                                className="w-24 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right focus:outline-none focus:border-slate-900"
                              />
                            </td>
                            <td className={`py-1.5 text-right font-mono font-bold ${
                              semContagem ? 'text-slate-300' : Math.abs(diff) < 0.01 ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {semContagem ? '—' : money(diff)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="pt-2 font-black text-slate-900">Total</td>
                        <td className="pt-2 text-right font-mono font-black text-slate-900">{money(totalOf(expected))}</td>
                        <td className="pt-2 text-right font-mono font-black text-slate-900">{money(totalOf(countedNumeric))}</td>
                        <td className={`pt-2 text-right font-mono font-black ${Math.abs(difference) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {money(difference)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">Quem contou</span>
                    <input
                      value={countedBy}
                      onChange={e => setCountedBy(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">Quem conferiu</span>
                    <input
                      value={verifiedBy}
                      onChange={e => setVerifiedBy(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </label>
                </div>

                {countedBy.trim() && verifiedBy.trim() &&
                  countedBy.trim().toLowerCase() === verifiedBy.trim().toLowerCase() && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    A mesma pessoa conta e confere. É permitido e fica registado no fecho.
                  </p>
                )}

                {hasDifference && (
                  <label className="block">
                    <span className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Justificação da diferença de {money(difference)} (obrigatória)
                    </span>
                    <textarea
                      value={justification}
                      onChange={e => setJustification(e.target.value)}
                      rows={2}
                      placeholder="Ex.: faltou troco de 20 MT entregue a cliente sem registo; confirmado com o gerente"
                      className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-slate-900"
                    />
                  </label>
                )}

                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600 leading-relaxed">
                  Reembolsos já estão descontados no valor que o sistema espera. O fecho não se altera depois de gravado.
                  <br />
                  <strong>Escolha em baixo</strong> se o turno seguinte deve abrir já com
                  <strong> {money(totalOf(countedNumeric))}</strong> contados (troca de turno) ou se a caixa deve ficar fechada.
                </div>

                <button
                  onClick={() => handleClose(true)}
                  disabled={busy}
                  className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black uppercase tracking-wide disabled:opacity-50"
                >
                  {busy ? 'A fechar…' : 'Fechar turno e abrir o seguinte'}
                </button>

                <button
                  onClick={() => handleClose(false)}
                  disabled={busy}
                  className="w-full py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-[11px] font-black uppercase tracking-wide hover:bg-slate-50 disabled:opacity-50"
                  title="Fecha o turno e não abre nenhum novo. A caixa fica fechada até alguém abrir o próximo turno."
                >
                  {busy ? 'A fechar…' : 'Só fechar o turno (não abrir outro)'}
                </button>
                <p className="text-[10px] text-slate-500 leading-relaxed text-center">
                  Use o segundo botão no fim do dia, ao fechar para uma pausa, ou quando ainda não se sabe
                  quem vai ficar na caixa. O turno seguinte abre depois, com o botão "Abrir turno", e começa
                  com o dinheiro que ficou contado.
                </p>
              </div>
            )}

            {history.length > 0 && (
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[10px] font-black uppercase text-slate-500 mb-1">Últimos turnos</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {history.slice(0, 8).map(item => (
                    <div key={item.id} className="flex items-center justify-between text-[10px] text-slate-600">
                      <span className="font-bold">N.º {item.number} · {item.openedBy}</span>
                      <span className={`font-mono font-bold ${item.status === 'Aberto' ? 'text-slate-500' : (item.difference || 0) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {item.status === 'Aberto'
                          ? 'aberto'
                          : `${money(totalOf(item.closingCounts))} · dif. ${money(item.difference || 0)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
