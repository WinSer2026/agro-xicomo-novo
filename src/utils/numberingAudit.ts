import { Sale } from '../types';

/**
 * Controlo de lacunas na numeração fiscal (B-04).
 *
 * A contabilidade e a inspecção exigem que a sequência de documentos seja
 * contínua. Se um número desaparece (documento emitido e perdido, venda
 * apagada, falha a meio de uma emissão), tem de haver um registo de que a
 * lacuna é conhecida e justificada — não pode ser descoberta numa inspecção.
 */

export type NumberingKind = 'FaturaDefinitiva' | 'FaturaProforma' | 'Recibo' | 'NotaCredito';

export interface NumberingGap {
  prefix: string;
  expected: number;
  missing: number[];
}

function extractNumber(value: string | undefined, prefix: string): number | null {
  if (!value) return null;
  const match = String(value).match(new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\d+)$`));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Números em falta entre 1 e o maior emitido, para um dado prefixo. */
export function findNumberingGaps(
  sales: Sale[],
  kind: NumberingKind,
  year: number
): NumberingGap {
  const prefix =
    kind === 'FaturaDefinitiva' ? `FAC-${year}-`
    : kind === 'FaturaProforma' ? `FP-${year}-`
    : kind === 'NotaCredito' ? `NC-${year}-`
    : year ? `REC-` : 'REC-';

  const emitidos = new Set<number>();

  sales.forEach(venda => {
    if (kind === 'Recibo') {
      // Recibos têm dois prefixos possíveis (POS e A4).
      [`REC-POS-${year}-`, `REC-A4-${year}-`].forEach(pref => {
        const numero = extractNumber(venda.receiptNumber, pref);
        if (numero !== null) emitidos.add(numero);
      });
      return;
    }
    if (kind === 'NotaCredito') {
      const numero = extractNumber(venda.creditNoteNumber, `NC-${year}-`);
      if (numero !== null) emitidos.add(numero);
      return;
    }
    if (kind === 'FaturaDefinitiva' && venda.documentType && venda.documentType !== 'FaturaDefinitiva') return;
    if (kind === 'FaturaProforma' && venda.documentType !== 'FaturaProforma' && venda.documentType !== 'Cotacao') return;
    const numero = extractNumber(venda.invoiceNumber, `FAC-${year}-`);
    if (numero !== null && kind === 'FaturaDefinitiva') emitidos.add(numero);
    const numeroProforma = extractNumber(venda.invoiceNumber, `FP-${year}-`);
    if (numeroProforma !== null && kind === 'FaturaProforma') emitidos.add(numeroProforma);
  });

  const maximo = emitidos.size > 0 ? Math.max(...emitidos) : 0;
  const missing: number[] = [];
  for (let numero = 1; numero <= maximo; numero += 1) {
    if (!emitidos.has(numero)) missing.push(numero);
  }

  return { prefix, expected: maximo, missing };
}

/** Resumo legível para o ecrã: "FAC-2026-0003, 0004 em falta". */
export function describeGaps(gap: NumberingGap): string {
  if (gap.missing.length === 0) {
    return gap.expected === 0 ? 'Sem documentos emitidos.' : `Sequência contínua até ${gap.expected}.`;
  }
  const numeros = gap.missing.map(n => String(n).padStart(4, '0')).join(', ');
  return `${gap.missing.length} número(s) em falta: ${numeros}`;
}
