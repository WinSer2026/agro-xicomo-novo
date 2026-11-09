import type { Product } from '../types';

/**
 * Verificação de stock no momento de adicionar ao carrinho.
 *
 * O PDV só descobria que não havia mercadoria **ao gravar** — no fim, com o
 * carrinho montado e o cliente à espera. Aqui a conta faz-se antes, com o stock
 * lido do servidor nesse instante e já descontando o que está no carrinho.
 *
 * Não substitui a transacção final (dois postos podem chegar ao mesmo tempo);
 * reduz a janela de horas para milissegundos e transforma um erro no fim da
 * venda numa mensagem clara no início.
 */

/** Quantidade em unidade base que uma linha consome. */
export function lineBaseQty(
  product: Pick<Product, 'conversionRate' | 'parentUnit'> | null | undefined,
  quantity: number,
  sellingUnit?: 'Bulk' | 'Retail'
): number {
  const qty = Number(quantity) || 0;
  const conversao = Number(product?.conversionRate);
  const temConversao = Boolean(product?.parentUnit) && Number.isFinite(conversao) && conversao > 1;
  if (!temConversao) return qty;
  // 'Bulk' = sacos (multiplica); 'Retail' = quilos (unidade base).
  return sellingUnit === 'Bulk' ? qty * conversao : qty;
}

export interface StockCheck {
  allowed: boolean;
  /** Em unidade base: quanto existe depois de descontar o carrinho. */
  available: number;
  /** Em unidade base: quanto falta para satisfazer o pedido. */
  missing: number;
  message: string;
}

export function checkStockAddition(input: {
  product: Pick<Product, 'name' | 'baseUnit' | 'stockQty' | 'conversionRate' | 'parentUnit' | 'isService'> | null | undefined;
  /** Stock do servidor neste instante. */
  serverStock: number;
  /** Já no carrinho, em unidade base (o próprio produto). */
  inCartBase: number;
  quantity: number;
  sellingUnit?: 'Bulk' | 'Retail';
}): StockCheck {
  const { product } = input;
  const unidade = product?.baseUnit || 'un';
  const pedidoBase = lineBaseQty(product, input.quantity, input.sellingUnit);

  // Serviços não consomem stock.
  if (product?.isService) {
    return { allowed: true, available: Number.POSITIVE_INFINITY, missing: 0, message: '' };
  }

  const stock = Number.isFinite(Number(input.serverStock)) ? Number(input.serverStock) : 0;
  const noCarrinho = Math.max(0, Number(input.inCartBase) || 0);
  const disponivel = stock - noCarrinho;

  if (!Number.isFinite(pedidoBase) || pedidoBase <= 0) {
    return { allowed: false, available: disponivel, missing: 0, message: 'Quantidade inválida.' };
  }

  if (pedidoBase > disponivel + 1e-6) {
    const falta = pedidoBase - Math.max(0, disponivel);
    return {
      allowed: false,
      available: disponivel,
      missing: falta,
      message:
        `Stock insuficiente para ${product?.name || 'este artigo'}: ` +
        `há ${Math.max(0, disponivel).toLocaleString('pt-MZ')} ${unidade}` +
        (noCarrinho > 0 ? ` depois de descontar o que já está no carrinho` : '') +
        ` e o pedido é de ${pedidoBase.toLocaleString('pt-MZ')} ${unidade}` +
        ` (faltam ${falta.toLocaleString('pt-MZ')} ${unidade}).`
    };
  }

  return { allowed: true, available: disponivel - pedidoBase, missing: 0, message: '' };
}
