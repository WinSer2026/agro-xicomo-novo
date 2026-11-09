# Cancelados e proformas nos relatórios

## A regra

**Documentos cancelados e proformas nunca entram nos totais.** Aparecem sempre, com valor e contagem, numa linha própria que não soma.

| Documento | Entra na faturação? | Entra no lucro? | Entra nas transações? | Onde aparece |
|---|---|---|---|---|
| Factura paga | sim | sim | sim | total |
| Factura pendente/crédito | sim (é faturação a receber) | sim | sim | total |
| **Factura cancelada** | **não** | **não** | **não** | linha "Cancelado — não soma" |
| **Proforma / cotação** | **não** | **não** | **não** | linha "Proformas — não é receita" |

## O que estava errado

O **Relatório Oficial Periódico do POS** — o documento que se leva ao município — filtrava as vendas apenas por data:

```ts
// antes
sales.filter(s => dentroDoPeriodo(s))   // devolvia TUDO: pagas, pendentes,
                                        // canceladas e proformas
```

E somava tudo em cima disso:

- **Faturação Bruta** — inflacionada pelo valor das facturas anuladas;
- **Lucro Estimado** — calculado sobre vendas que já não existem;
- **Transações** — contava documentos cancelados como vendas;
- **Desempenho por produto** — as colunas "Faturado" e "Lucro" de cada artigo incluíam quantidades que foram anuladas.

Numa verificação, a empresa apresenta faturação superior à que tem nos livros. É o tipo de discrepância que, por si só, justifica uma inspeção mais funda.

Também estavam contaminados:

| Local | Problema |
|---|---|
| Ledger Excel / PDF ("Livro de Vendas Detalhado") | exportava **todas** as vendas e o subtítulo contava `sales.length`, canceladas incluídas |
| Totalizador Trienal / Quinquenal / Decenal | somava todas as vendas do período, anuladas incluídas |
| Gráfico semanal (últimos 7 dias) | o valor do dia incluía vendas canceladas |
| Contagem de clientes a crédito | contava canceladas com meio de pagamento "crédito" |

## O que passou a existir

`src/utils/reporting.ts` — uma única função, usada por todos:

```ts
const split = splitSalesForReport(vendasDoPeriodo);
split.valid        // documentos que contam
split.cancelled    // cancelados (valor + contagem, nunca somados)
split.proforma     // proformas/cotações (valor + contagem)
split.totals.valid // faturação real
```

A separação é feita por `isCancelledSale` / `isProformaSale` de `saleStatus.ts`, que já reconhecem o estado legado `'canceled'` (com um "l" só), escrito por versões antigas.

### No ecrã (Relatórios POS)

Depois dos quatro cartões de KPI, dois cartões novos:

> **Cancelado — não soma** · 12.400,00 MT · 7 doc.
> Facturas anuladas no período. Já estão fora da faturação, do lucro e das transações acima.

> **Proformas — não é receita** · 3.100,00 MT · 4 doc.
> Documentos comerciais sem efeito fiscal. Fora dos totais até serem convertidos em factura.

Ficam em cinzento quando não há nada; em vermelho/âmbar quando há — para o valor não passar despercebido.

### No PDF oficial

Por baixo da caixa de resumo, em duas linhas que **não** somam a nada:

```
Documentos CANCELADOS no período (não somados): 12.400 MT em 7 documento(s)
Proformas/cotações (não são receita): 3.100 MT em 4 documento(s)
```

### No Excel

Duas linhas novas na folha "Resumo Executivo", com o mesmo aviso no nome da métrica:

- `Cancelado no período (não soma)`
- `Proformas no período (não soma)`

### Nas faturas

Já estava correto: o cartão "Cancelado" existe à parte e `totalInvoiced` soma apenas `isFinancialSale`.

## Ficheiros

| Ficheiro | O que mudou |
|---|---|
| `src/utils/reporting.ts` | **novo** — `splitSalesForReport` |
| `src/components/FinanceModule.tsx` | relatório oficial, ledger Excel/PDF, totalizadores multi-ano, gráfico semanal, contagem de crédito, cartões no ecrã |
| `test/reporting_test.ts` | **novo** — 13 asserções |

## Verificação

```
npx tsc --noEmit                               → sem erros
TZ=Africa/Maputo npx tsx test/reporting_test.ts → 13/13
TZ=Africa/Maputo npx tsx test/cash_box_test.ts → 15/15
TZ=Africa/Maputo npx tsx test/inventory_cutoff_test.ts → 49/49
TZ=Africa/Maputo npx tsx test/master_plan_test.ts → 44/44
npx vite build                                 → concluído
```

O teste verifica que: uma venda cancelada não soma; o estado legado `'canceled'` é reconhecido; proforma e cotação ficam fora; a soma das três listas continua a ser igual ao total de documentos (nada se perde pelo caminho); e um período só com canceladas dá faturação zero mas declara o valor.

**Necessita prova no local:** compilar um relatório mensal com pelo menos uma factura anulada e confirmar no PDF que a faturação desceu exatamente o valor dela, e que a linha de cancelados mostra esse valor.
