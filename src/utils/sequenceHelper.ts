import { Sale } from '../types';

/**
 * Utilitário para gerar numeração sequencial de Facturas e Recibos.
 * Facturas Definitivas: FAC-YYYY-NNNN (ex: FAC-2026-0001, FAC-2026-0002)
 * Facturas Proformas: FP-YYYY-NNNN (ex: FP-2026-0001, FP-2026-0002)
 * Recibos POS (XP-80c): REC-POS-YYYY-NNNN (ex: REC-POS-2026-0001)
 * Recibos A4: REC-A4-YYYY-NNNN (ex: REC-A4-2026-0001)
 */

export function generateNextInvoiceNumber(existingSales: Sale[], docType: 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao' = 'FaturaDefinitiva'): string {
  const currentYear = new Date().getFullYear();
  let prefix = `FAC-${currentYear}-`;
  
  if (docType === 'FaturaProforma' || docType === 'Cotacao') {
    prefix = `FP-${currentYear}-`;
  }

  let maxNum = 0;

  existingSales.forEach(s => {
    if (!s.invoiceNumber) return;
    
    // Check if the invoice number matches the correct prefix
    if (s.invoiceNumber.startsWith(prefix)) {
      const parts = s.invoiceNumber.split('-');
      const lastPart = parts[parts.length - 1];
      const val = parseInt(lastPart, 10);
      if (!isNaN(val) && val > maxNum) {
        maxNum = val;
      }
    } else {
      // Robust regex match fallback for any legacy numbers ending in a digit
      const match = s.invoiceNumber.match(/(?:FAC|Fact|FT|FP|PROFORMA)-\d{4}-(\d+)/i) || s.invoiceNumber.match(/-(\d+)$/);
      if (match && match[1]) {
        // Only count if it corresponds to the same document type context to prevent overlapping
        const isSProforma = s.documentType === 'FaturaProforma' || s.documentType === 'Cotacao';
        const isCurrentProforma = docType === 'FaturaProforma' || docType === 'Cotacao';
        if (isSProforma === isCurrentProforma) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
      }
    }
  });

  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/**
 * Extrai o prefixo e o próximo número sequencial mínimo a partir de um número
 * gerado localmente (ex.: "FAC-2026-0007" → { prefix: "FAC-2026-", next: 7 }).
 * Usado em conjunto com dbService.nextDocumentNumber() para serialização real
 * entre vendedores simultâneos (Auditoria FASE 1, D-01).
 */
export function extractSequenceParts(generatedNumber: string): { prefix: string; next: number } {
  const match = generatedNumber.match(/^(.*?)(\d+)$/);
  if (!match) {
    return { prefix: generatedNumber, next: 1 };
  }
  return { prefix: match[1], next: parseInt(match[2], 10) || 1 };
}

/** Formata o número sequencial com o mesmo zero-padding dos documentos existentes. */
export function formatSequenceNumber(prefix: string, serial: number): string {
  return `${prefix}${String(serial).padStart(4, '0')}`;
}

/**
 * Reserva o próximo número de documento de forma transaccional.
 * `reserver` (normalmente dbService.nextDocumentNumber) serializa pedidos
 * concorrentes; se a transacção falhar, mantém o número calculado localmente
 * para nunca impedir a gravação de uma venda concluída.
 */
export async function reserveDocumentNumber(
  generatedNumber: string,
  reserver: (counterKey: string, minimumNext: number) => Promise<number>
): Promise<string> {
  const { prefix, next } = extractSequenceParts(generatedNumber);
  try {
    const counterKey = prefix.replace(/-$/, '');
    const serial = await reserver(counterKey, next);
    return formatSequenceNumber(prefix, serial);
  } catch (error) {
    console.warn('[sequenceHelper] Numeração transacional indisponível; mantém numeração local.', error);
    return generatedNumber;
  }
}

export function generateNextReceiptNumber(existingSales: Sale[], printFormat?: 'Thermal' | 'ReciboA4' | 'A4' | 'DoubleA5' | 'FaturaProforma' | 'Proforma'): string {
  const currentYear = new Date().getFullYear();
  
  // Decide whether it is a POS (Thermal) receipt or an A4 receipt
  const isPOS = printFormat === 'Thermal';
  const prefix = isPOS ? `REC-POS-${currentYear}-` : `REC-A4-${currentYear}-`;

  let maxNum = 0;

  existingSales.forEach(s => {
    const rNum = s.receiptNumber;
    if (rNum) {
      if (rNum.startsWith(prefix)) {
        const parts = rNum.split('-');
        const lastPart = parts[parts.length - 1];
        const val = parseInt(lastPart, 10);
        if (!isNaN(val) && val > maxNum) {
          maxNum = val;
        }
      } else {
        // Match legacy receipt formats: Rec-YYYY-N or REC-POS-YYYY-N or REC-A4-YYYY-N
        const match = rNum.match(/(?:Rec|REC-POS|REC-A4)-\d{4}-(\d+)/i) || rNum.match(/-(\d+)$/);
        if (match && match[1]) {
          const isSRecPOS = rNum.toLowerCase().includes('pos');
          if (isSRecPOS === isPOS) {
            const val = parseInt(match[1], 10);
            if (!isNaN(val) && val > maxNum) {
              maxNum = val;
            }
          }
        }
      }
    }
  });

  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}
