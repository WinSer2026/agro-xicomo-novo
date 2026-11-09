# Limites e consistência dos relatórios

Verificado a pedido, depois de os cancelados terem saído dos totais. Sete problemas encontrados; seis corrigidos agora, um fica documentado para decisão.

---

## 1. O stock anterior ficou errado — e era eu que o tinha estragado

A coluna "Stock ant." do relatório por produto calculava-se:

```
stock anterior = stock actual + quantidade vendida no período
```

Quando as vendas canceladas saíram do relatório, a quantidade vendida desceu — e o stock anterior também. Parecia que a loja tinha menos stock do que tinha.

**A causa mais funda:** "venda cancelada" deixou de significar "o stock não mudou". No corte de inventário a anulação acontece **sem** devolver stock (a contagem física já o tinha em conta). Nesses casos a saída de stock aconteceu mesmo.

**Correção:** novo campo na venda, `stockReturned`.

| Situação | `stockReturned` | Conta como saída de stock? |
|---|---|---|
| Anulação clássica (stock voltou) | `true` | não |
| Anulação por corte de inventário | `false` | **sim** |
| Vendas antigas sem o campo | ausente | não (comportamento clássico) |
| Proforma | — | não |

E o cálculo passou a devolver `{ value, complete }`: se alguma linha vendida pertencer a um artigo que já não existe no catálogo, o ecrã mostra **"n/d"** — não se inventa um número.

## 2. O período do relatório não era o período

```ts
const diffDays = Math.ceil(Math.abs(agora - dataVenda) / 86400000);
if (period === 'Diário') return diffDays <= 1;
```

Três erros em três linhas:

- **`Math.abs` aceitava datas no futuro** — uma venda com data adiantada por erro de relógio entrava no relatório;
- **"Diário" era "últimas 24 horas"** — depois da meia-noite, o dia anterior continuava a contar;
- **o corte era em UTC** — uma venda das 23:00 em Maputo contava no dia seguinte.

Agora: dias de calendário locais (`periodDayRange`), com `hoje` a ser hoje e nada depois de hoje.

## 3. O lucro era forçado a zero

```ts
const reportProfit = Math.max(0, reportGrossSales - reportCost);
```

Um mês de prejuízo apresentava **"0 MT de lucro"** — indistinguível de um mês sem vendas. O mesmo em `totalProfit` e `netCommercialMargin` no painel.

Agora o valor é assinado: aparece a negativo e a vermelho, com a nota *"Prejuízo no período — não foi arredondado para zero"*.

## 4. Custo inventado nos artigos desaparecidos

```ts
const buyPrice = prod ? getUnitCost(prod, ...) : (item.unitPrice * 0.6);
```

Quando o produto já não existia no catálogo, o sistema **assumia 40% de margem** e mostrava isso como lucro.

Agora, sem custo conhecido, assume-se custo igual ao valor faturado (margem zero) e o documento declara:

> Artigos já inexistentes no catálogo: 4.200,00 MT faturados sem custo conhecido — lucro assumido como zero nessas linhas.

## 5. O PDF e o Excel davam números diferentes para o mesmo produto

| Documento | Quantidade vendida |
|---|---|
| PDF | `item.quantity` — **sem converter a unidade** |
| Excel | `getBaseUnitQuantity(...)` — convertida para unidade base |

Um saco de 50 kg aparecia como **1** no PDF e como **50** no Excel. E o "Faturado" de ambos era `quantidade × preço de tabela actual`, ignorando o preço e o desconto praticados na venda.

Agora existe **uma só tabela** (`buildProductPerformance`), usada pelos dois documentos: quantidade em unidade base, faturado ao preço real da venda, custo com o preço de compra.

## 6. Os totais não fechavam com a soma das linhas

A "Faturação Bruta" é líquida de descontos (`sale.total`), mas o "Faturado" por produto era bruto. Com descontos, as linhas somavam mais do que o total — parecia dinheiro a faltar.

Acrescentada a linha de reconciliação no PDF e no Excel:

> Descontos concedidos no período: 1 850,00 MT — os valores por produto abaixo são brutos; o total acima é líquido de desconto.

## 7. Cêntimos desapareciam dos documentos fiscais

`toLocaleString('pt-MZ')` mostrava valores arredondados ao inteiro. Num documento que vai ao município, 1.234,56 MT aparecia como 1.235 MT.

Novo `formatMT()`: sempre dois decimais, agrupamento de milhares explícito (não depende dos dados de locale do ambiente), sinal preservado.

---

## Ficheiros

| Ficheiro | O que mudou |
|---|---|
| `src/utils/reporting.ts` | `periodDayRange`, `saleMovedStock`, `stockBeforePeriod`, `formatMT`, `buildProductPerformance` |
| `src/types.ts` | `Sale.stockReturned` |
| `src/utils/firebaseDB.ts` | grava `stockReturned` na anulação clássica (`true`) e no corte (`= applyStock`) |
| `src/components/FinanceModule.tsx` | período, stock anterior, lucro assinado, custo sem invenção, tabela única, descontos, centavos, gráfico semanal por dia de Maputo |
| `test/reporting_test.ts` | 35 asserções (eram 13) |

## Verificação

```
npx tsc --noEmit                                        → sem erros
TZ=Africa/Maputo npx tsx test/reporting_test.ts          → 35/35
TZ=Africa/Maputo npx tsx test/cash_box_test.ts           → 15/15
TZ=Africa/Maputo npx tsx test/inventory_cutoff_test.ts   → 49/49
TZ=Africa/Maputo npx tsx test/master_plan_test.ts        → 44/44
npx vite build                                          → concluído
```

Os testes novos cobrem: os limites de cada período (incluindo o dia de Maputo às 23:30), as quatro combinações de `stockReturned`, o stock anterior com produto inexistente a devolver `complete: false`, o lucro negativo, a formatação com centavos e a tabela por produto.

**Necessita prova no local:** abrir o relatório mensal e conferir que a soma das colunas "Faturado" menos os descontos dà exactamente a "Faturação Bruta" do cabeçalho.

---

## Um ponto que fica para decisão do proprietário

**O custo usado é o preço de compra actual, não o da altura da venda.** Se o preço de compra de um artigo subiu 20% desde a venda, o lucro histórico desse artigo aparece mais baixo do que foi. Corrigir exige gravar o custo no momento da venda (campo novo em cada linha) — a partir daí só vale para vendas futuras; as antigas ficam sempre estimadas. É uma alteração à estrutura da venda, por isso não a fiz sem a sua palavra.
