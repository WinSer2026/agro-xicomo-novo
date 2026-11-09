# Passagem de consistência ao PDV — dinheiro, stock, documentos

Feita depois de fechar os planos das faturas e do corte de inventário, com o mesmo critério: o que
o cliente paga, o que o stock movimenta e o que o documento declara têm de ser a mesma coisa — em
qualquer ecrã e em qualquer posto.

Sete achados. Cinco corrigidos agora; dois ficam descritos no fim.

---

## 1. Anular uma factura no PDV não era anular uma factura

A mesma venda, anulada em dois ecrãs diferentes:

| | Faturas | PDV (antes) |
|---|---|---|
| Palavra-passe de gestor | sim | **não** |
| Nota de crédito numerada | sim | **não** |
| Stock reposto | sim | sim |
| Reembolso registado em caixa | sim | **não** |
| Registo de auditoria | sim | **não** |

Um clique no PDV anulava uma factura — e o stock voltava — sem documento de rectificação. Numa
inspecção, é uma factura emitida que desapareceu sem explicação.

**Fechado.** O PDV passou a fazer o mesmo que as Faturas: pede a palavra-passe, numera a NC por
documento definitivo, repõe o stock, pergunta pelo dinheiro devolvido (e regista-o em
`cash_movements`) e escreve a auditoria com IP.

## 2. Liquidar uma factura no PDV podia emitir dois recibos

O PDV lia o contador de recibos, calculava o número e gravava a venda em duas operações separadas.
Dois postos a liquidar a mesma factura no mesmo instante emitiam **dois recibos para um só
pagamento**. As Faturas já usavam `payInvoiceWithReceipt` (transaccional); o PDV não.

**Fechado.** O PDV passou a usar a mesma transacção, que verifica o estado da factura (paga,
anulada, inexistente), numera e grava no mesmo commit.

## 3. O contador de recibos podia repetir um número já emitido

Tanto no PDV como nas Faturas, o contador começava em zero se o documento `counters/document_numbers`
não existisse — por exemplo, numa base migrada. O primeiro recibo emitido repetia um número que já
estava na mão de um cliente.

**Fechado.** `payInvoiceWithReceipt` aceita o maior recibo conhecido como ponto de partida
(`fallbackMax`) e usa `max(contador, maiorConhecido) + 1`. Os dois ecrãs passam esse valor.

## 4. O IVA cobrado não era o IVA declarado

```ts
// total cobrado ao cliente
base * 1.16                     // 16% fixos sobre tudo
// IVA gravado na venda
cart.reduce(… lineTaxAmount(item, produto))   // taxa de cada linha, sobre o valor BRUTO
```

Com um produto isento ao lado de um tributado, o cliente pagava 16% sobre o total mas a factura
declarava o IVA só da linha tributada. E o IVA era calculado antes dos descontos.

**Fechado.** Existe agora uma só conta — `cartTaxAmount` — usada para formar o total **e** para
gravar o IVA:

- taxa de cada linha (16% por omissão, com isenções e taxas reduzidas);
- base já líquida de descontos, repartidos proporcionalmente;
- arredondamento ao cêntimo no fim.

Com todos os produtos a 16% e sem descontos, o valor é **exactamente o mesmo de antes** — a
mudança só se nota onde o cálculo estava errado.

## 5. Reemitir no PDV ressuscitava a factura anulada

As Faturas emitem uma factura **nova** quando se reemite (documentado no próprio modal: «a factura
anulada não volta a viver»). O PDV repunha o estado da **mesma** factura: mesmo número, mesmo
documento, que já tinha sido declarado anulado.

**Fechado.** O PDV emite número novo, com nota a indicar de que factura veio. A anulada e a nota
de crédito ficam no histórico.

## 6. Reemitir podia deduzir stock duas vezes

Se a anulação anterior foi feita por **corte de inventário** (`stockReturned: false` — a contagem
física já a tinha em conta), a mercadoria já saiu. A reemissão voltava a deduzir.

**Fechado.** A reemissão respeita `stockReturned`: só deduz stock quando a anulação anterior o
tinha reposto.

## 7. Verificado e correto (sem alteração)

| Item | Estado |
|---|---|
| Venda sem pagamento suficiente | bloqueada (D-06) |
| Pagamentos múltiplos com soma errada | bloqueados com a diferença em MT |
| Desconto acima de 20% | exige palavra-passe |
| Proforma | não movimenta stock, não gera recibo |
| Venda a crédito | estado `Crédito`, sem recibo, sem dinheiro recebido |
| Stock insuficiente no momento de gravar | transacção recusa (`InsufficientStockError`) e avisa |
| Venda retroactiva | deduz stock quando marcada; grava custo congelado por linha |
| Relatórios diários do PDV | excluem canceladas e proformas |
| Número de factura | contador transaccional (dois caixas nunca recebem o mesmo) |

---

## Ainda em aberto

**(a) O stock é verificado ao gravar, não ao adicionar ao carrinho.** Dois postos podem vender o
mesmo último saco; o segundo recebe um erro no fim, com o carrinho montado. É correto — não se
vende o que não existe — mas a experiência é má. Exigiria reserva de stock ao adicionar, com
expiração; é uma alteração de arquitectura, não um remendo.

**(b) A venda a crédito não cria um registo de dívida próprio.** O estado `Crédito` na venda é a
única marca. Não há prazo, não há histórico de cobranças parciais, não há alerta de atraso. Para o
que a empresa faz hoje chega; se as vendas a crédito crescerem, isto é o próximo módulo.

---

## Verificação

```
npx tsc --noEmit                                     → sem erros
TZ=Africa/Maputo npx tsx test/pdv_consistency_test.ts → 17/17
npm run test:all                                      → 193 asserções, 0 falhas
npx vite build                                        → concluído
```

O teste novo cobre a única peça que se pode provar sem Firestore: o IVA. Confirma que um produto
isento ao lado de um tributado **não** paga 16% sobre tudo, que o desconto reduz a base, que a taxa
de cada linha é respeitada, e que tudo arredonda ao cêntimo.

**Necessita prova no local:**

1. Vender um artigo isento + um a 16% e conferir que o total é a soma das duas linhas tributadas
   corretamente (e não 16% sobre tudo);
2. Anular essa venda no PDV: tem de pedir palavra-passe, emitir NC e perguntar pelo dinheiro;
3. Liquidar a mesma factura em dois postos ao mesmo tempo: um recebe recibo, o outro recebe erro —
   nunca dois recibos.
