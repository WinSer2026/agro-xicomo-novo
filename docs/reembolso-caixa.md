# Reembolso ao cliente registado em caixa (V-04 / FT-36)

## O problema, em dinheiro

Tudo o que sai do estabelecimento tinha documento: venda, recibo, nota de crédito, quebra, estorno. **O reembolso ao cliente não tinha nenhum.**

Consequência prática: anulava-se uma factura de 1.500 MT já paga, devolvia-se o dinheiro da gaveta e o sistema ficava a dizer que a venda tinha sido cancelada — sem qualquer saída de caixa. Ao fechar o dia, faltavam 1.500 MT e não havia como provar para onde foram.

Numa inspecção municipal isto é pior do que a falta: a nota de crédito declara que o valor foi creditado ao cliente. Se não existe saída de caixa correspondente, ou o cliente não foi pago (a NC é falsa) ou foi pago fora do sistema. As duas leituras são más.

O corte de inventário tornou o problema maior: passa a anular vendas **em massa**, quase todas pagas.

## O que passou a existir

### 1. Colecção `cash_movements`

```ts
export interface CashMovement {
  id: string;
  date: string;      // ISO
  day: string;       // AAAA-MM-DD em Maputo
  type: 'Reembolso' | 'Sangria' | 'Entrada' | 'Fundo';
  amount: number;    // negativo sai, positivo entra
  method: string;
  operator: string;
  authorizedBy?: string;
  reference?: string;        // factura
  creditNoteNumber?: string;
  receiptNumber?: string;
  notes?: string;
}
```

Saídas ficam **sempre negativas** — o saldo não depende de quem escreveu o registo.

### 2. Anulação de factura: pergunta explícita, palavra-passe de gestor

No modal de anulação, quando a factura foi paga:

- caixa **"Devolvi dinheiro ao cliente"** — desligada por omissão;
- valor pré-preenchido com o que o cliente pagou, editável;
- meio (Dinheiro / Transferência / M-Pesa / E-Mola);
- **palavra-passe de gestor** — a mesma que já autoriza a anulação. Sem ela não se anula nem se devolve.

Regras aplicadas no servidor de dados e no ecrã:

| Situação | Pode devolver? |
|---|---|
| Venda paga a 100% | sim, até ao total |
| Venda paga em parte | sim, **só até ao valor pago** (não se devolve dinheiro que nunca entrou) |
| Proforma / pendente | não — nunca entrou dinheiro |
| Já anulada | não — evita devolver duas vezes |

Se a gravação do reembolso falhar, **a anulação não é desfeita mas o operador é avisado em vermelho** que a devolução não ficou registada e tem de a lançar à mão. Fingir que correu bem seria pior.

### 3. Corte de inventário: reembolsos na mesma transacção

No modo "anular", se houver vendas pagas, aparece:

> **Devolvi dinheiro aos clientes — registar em caixa** — 12 venda(s) já pagas · 4.320,00 MT a devolver.

O total é calculado com o mesmo limite (só o que foi pago). Os movimentos de caixa são escritos **no mesmo commit** das anulações e das notas de crédito: não existe o estado em que a factura está anulada e o dinheiro não está registado.

### 4. Contabilidade → Livro de Caixa

Novo painel: **entrou em dinheiro** (vendas pagas em dinheiro no período), **saiu em dinheiro** (reembolsos e sangrias), **saldo** — com a nota "deve coincidir com a gaveta ao fechar o dia" — e a lista das últimas saídas com factura, nota de crédito, meio e operador.

## Ficheiros

| Ficheiro | O que mudou |
|---|---|
| `src/types.ts` | novo `CashMovement` com o comentário do porquê |
| `src/utils/cashBox.ts` | **novo** — `toCashDay`, `canRefund`, `maxRefundFor`, `sumRefunds`, `cashBalance` |
| `src/utils/firebaseDB.ts` | colecção `cash_movements`, `getCashMovements`, `addCashMovement`; `applyCutoff` aceita e grava `refunds` na transacção |
| `src/components/FaturasModule.tsx` | pergunta de reembolso no modal de anulação + gravação + toast |
| `src/components/InventoryCutoffTool.tsx` | opção de reembolso em massa com total e meio de pagamento |
| `src/components/FinanceModule.tsx` | painel de caixa no Livro de Caixa |
| `test/cash_box_test.ts` | **novo** — 15 asserções |

## Verificação

```
npx tsc --noEmit                              → sem erros
TZ=Africa/Maputo npx tsx test/cash_box_test.ts        → 15/15
TZ=Africa/Maputo npx tsx test/inventory_cutoff_test.ts → 49/49
TZ=Africa/Maputo npx tsx test/master_plan_test.ts      → 44/44
npx vite build                                → concluído
```

O teste cobre exatamente as regras que protegem dinheiro: paga parcial devolve só o pagamento; proforma não devolve; anulada não devolve duas vezes; sangria não é reembolso; o dia é o de Maputo.

**Necessita prova no local:** fechar um dia com um reembolso real e confirmar que a gaveta bate certo com o saldo do Livro de Caixa.
