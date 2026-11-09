import { Sale } from '../types';

/**
 * Regras únicas sobre o significado financeiro de uma venda.
 *
 * Existem três conceitos que o sistema confundia:
 *  - documento emitido (proforma/cotação) — NÃO é receita nem dívida;
 *  - venda cancelada — não conta para nada;
 *  - venda válida — receita (paga) ou dívida (pendente/crédito).
 *
 * Todas as agregações devem passar por aqui em vez de repetir comparações
 * de `status` espalhadas pelos módulos.
 */

export const isCancelledSale = (sale: Pick<Sale, 'status'>): boolean =>
  sale.status === 'Cancelada' || (sale.status as string) === 'canceled';

/** Proforma/cotação: documento comercial sem efeito fiscal nem financeiro. */
export const isProformaSale = (sale: Pick<Sale, 'status' | 'documentType'>): boolean =>
  sale.status === 'Proforma' ||
  sale.documentType === 'FaturaProforma' ||
  sale.documentType === 'Cotacao';

/** Venda que produz receita e/ou dívida. */
export const isFinancialSale = (sale: Pick<Sale, 'status' | 'documentType'>): boolean =>
  !isCancelledSale(sale) && !isProformaSale(sale);

/** Venda com valor por receber (Pendente legado ou Crédito). */
export const isDebtSale = (sale: Pick<Sale, 'status'>): boolean =>
  sale.status === 'Pendente' || sale.status === 'Crédito';

/** Etiqueta legível do estado, usada nas listas. */
export const saleStatusLabel = (sale: Pick<Sale, 'status'>): string => {
  switch (sale.status) {
    case 'Paga': return 'PAGA';
    case 'Pendente': return 'PENDENTE';
    case 'Crédito': return 'A CRÉDITO';
    case 'Proforma': return 'PROFORMA';
    default: return 'CANCELADA';
  }
};
