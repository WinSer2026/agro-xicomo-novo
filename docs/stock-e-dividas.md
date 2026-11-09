# Stock no carrinho e dívidas de clientes

Os dois pontos que ficaram em aberto na passagem de consistência ao PDV.

---

## 1. Stock verificado ao adicionar, não só ao gravar

**O que estava mal:** a verificação existia, mas contra o stock da última sincronização do ecrã —
que podia ter horas — e, nos artigos híbridos (saco + quilo), olhava para as duas formas como se
fossem reservatórios separados. O resultado era descobrir a falta no fim, com o carrinho montado e
o cliente à espera.

**O que passou a existir:**

- o stock é lido **do servidor nesse instante** (`getProductStock`), sem cache;
- a conta é feita **em unidade base**, somando o que já está no carrinho em qualquer das formas;
- a mensagem diz o que falta, em quilos ou sacos: *«Stock insuficiente para Milho: há 30 kg depois
  de descontar o que já está no carrinho e o pedido é de 50 kg (faltam 20 kg).»*

Isto **não substitui** a transacção final — dois postos podem chegar ao mesmo tempo. Reduz a
janela de horas para milissegundos e transforma um erro no fim da venda numa mensagem clara no
início. O bloqueio definitivo continua a ser o `addSaleWithStockDeduction`.

---

## 2. Venda a crédito passa a ser uma dívida registada

**O que estava mal:** uma venda a crédito ficava marcada com `status: 'Crédito'` e nada mais. Sem
prazo, sem histórico de cobranças, sem forma de saber quem estava atrasado. A dívida existia só na
memória de quem vendeu.

**O que passou a existir** — uma colecção `debts`, um registo por factura:

```ts
{ id, saleId, invoiceNumber, customerName,
  date, dueDate,          // prazo: 30 dias por omissão
  total, paidAmount,      // quanto é e quanto já entrou
  payments: [ { data, valor, meio, operador, recibo } ],
  status: 'Aberta' | 'Paga' }
```

### Cobrança parcial

O botão «Pagar» passou a ter **valor editável**, pré-preenchido com o que falta. Um valor menor
regista cobrança parcial:

- emite **recibo na mesma** (o dinheiro entrou, tem de ter documento);
- atualiza o saldo em dívida;
- escreve uma **entrada no Livro de Caixa** — antes o caixa fechava com sobra que ninguém sabia
  explicar;
- só fecha a dívida e marca a factura como «Paga» quando o total está coberto.

Tudo numa transacção: pagamento, estado da venda, número do recibo e movimento de caixa.

### Prazo e atraso

Na lista de facturas, cada dívida mostra o estado em português de balcão:

- **«Vencida há 9 dias»** — a vermelho;
- **«Vence em 6 dias»** / **«Vence hoje»**;
- **«pago 400,00»** quando já houve cobrança parcial.

No topo, um aviso: *«3 factura(s) em dívida · 2.500,00 MT · 2 vencida(s): 1.800,00 MT»*. Fica
fora dos totais de facturação — é dinheiro a receber, não receita.

---

## Ficheiros

| Ficheiro | O que mudou |
|---|---|
| `src/utils/stockGuard.ts` | **novo** — conversão para unidade base e veredicto de stock com mensagem |
| `src/utils/debts.ts` | **novo** — `daysOverdue`, `describeDebt`, `summarizeDebts` |
| `src/types.ts` | `Debt`, `DebtPayment`, `Sale.amountPaid`, `Sale.dueDate` |
| `src/utils/firebaseDB.ts` | `getProductStock`, `getDebts`, `createDebtFromSale`, `settleDebt` |
| `src/utils/cashBox.ts` | entradas de cobrança contam no saldo |
| `src/components/PDVModule.tsx` | stock do servidor ao adicionar; dívida criada no crédito; liquidação por `settleDebt` |
| `src/components/FaturasModule.tsx` | valor editável no «Pagar», cobrança parcial, badge de atraso, resumo de dívidas |
| `firestore.rules` | colecção `debts` (leitura/criação/actualização; sem eliminação) |
| `test/stock_debts_test.ts` | **novo** — 26 asserções |

## Verificação

```
npx tsc --noEmit                                 → sem erros
TZ=Africa/Maputo npx tsx test/stock_debts_test.ts → 26/26
npm run test:all                                  → 228 asserções, 0 falhas
npx vite build                                    → concluído
```

**Necessita prova no local:**

1. Dois postos: esgotar o stock num e tentar adicionar no outro — a mensagem aparece ao adicionar,
   com o nome do artigo e os quilos que faltam.
2. Vender a crédito e cobrar 40% numa semana: recibo emitido, dívida a 60%, entrada no Livro de
   Caixa.
3. Deixar uma dívida passar do prazo: a lista mostra «Vencida há N dias» a vermelho.
