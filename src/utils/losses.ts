/**
 * Quebras e perdas — o que conta e o que é só história.
 *
 * ES-42: ao anular uma transformação, a perda era **apagada** do sistema.
 * Isso apaga a prova de que houve prejuízo (e a auditoria fiscal não gosta de
 * documentos que desaparecem). Passou a ficar marcada como anulada: continua
 * visível em «Quebras», com autor e motivo, mas não soma a prejuízo.
 */
import type { LossRecord } from '../types';

/** A perda entra nas somas? Uma perda anulada não entra. */
export function isCountedLoss(loss: Pick<LossRecord, 'annulled'> | null | undefined): boolean {
  return Boolean(loss) && loss!.annulled !== true;
}

/** Só as perdas que contam (para totais, exportações e painéis). */
export function countedLosses(losses: LossRecord[] | null | undefined): LossRecord[] {
  return (Array.isArray(losses) ? losses : []).filter(isCountedLoss);
}

/** Valor total do prejuízo, ignorando anuladas e valores inválidos. */
export function totalLossValue(losses: LossRecord[]): number {
  return countedLosses(losses).reduce((soma, perda) => {
    const valor = Number(perda.costValue);
    return soma + (Number.isFinite(valor) ? valor : 0);
  }, 0);
}

/** Quantidade perdida por artigo (para «quem perdeu o quê»). */
export function lossQuantityByProduct(losses: LossRecord[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const perda of countedLosses(losses)) {
    const qtd = Number(perda.quantity);
    if (!Number.isFinite(qtd) || qtd <= 0) continue;
    mapa[perda.productId] = (mapa[perda.productId] || 0) + qtd;
  }
  return mapa;
}
