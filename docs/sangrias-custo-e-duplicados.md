# Três passos: sangrias, custo congelado e relançamento duplicado

Executados em sequência, pela ordem de risco.

---

## 1. Sangrias — o dinheiro que sai da gaveta pelo operador

**O problema:** além dos reembolsos, havia um segundo caminho sem rasto. O operador retira dinheiro do caixa (depósito no banco, troco para outra loja, pagamento a fornecedor à porta) e não fica nada escrito. A gaveta fecha com falta e a explicação é verbal.

**O que passou a existir** — em Contabilidade → Livro de Caixa, um formulário compacto:

> **Sangria / Entrada de dinheiro**
> Tipo · Valor (MT) · Meio · Motivo · **Senha gestor** → *Gravar movimento*

Regras:

| Regra | Porquê |
|---|---|
| Exige **palavra-passe de gestor** | é dinheiro a sair |
| Motivo com mínimo de 5 caracteres | uma sangria sem motivo é indistinguível de um furto |
| **Não deixa retirar mais do que o saldo do período** | a mensagem diz quanto existe: *"A gaveta tem 3.420,00 MT no período."* |
| Fica no Livro de Caixa e no registo de auditoria | com operador, IP, valor, meio e motivo |

O saldo do painel já contava saídas (`cashBalance`), pelo que a sangria passa a explicar a diferença entre o que entrou das vendas e o que está na gaveta.

---

## 2. Custo congelado na linha da venda

O ponto que tinha deixado para decisão do proprietário: o lucro histórico usava o preço de compra **actual**, não o da altura da venda.

**Boa notícia:** o campo já existia — `costPrice` em cada linha da venda — e o PDV já o gravava com o preço de compra do momento (`getUnitCost(product, selectedUnit)`, com a unidade certa: saco ou quilo).

**O que estava mal:** os relatórios não o usavam. `reportCost` ia buscar o preço actual; e quando o produto já não existia, inventava 40% de margem (`preço × 0,6`).

Agora a ordem é sempre:

1. `item.costPrice` — custo do momento da venda;
2. `item.buyingPrice` — alias antigo;
3. preço de compra actual do catálogo;
4. **valor faturado** (margem zero), declarado no documento.

Também corrigi o mesmo `× 0,6` em três pontos do PDV e no `firebaseDB`, onde ele era gravado como custo no momento da venda — ou seja, contaminava o snapshot para sempre.

**Fica assim:** vendas novas usam o custo real da altura. Vendas antigas sem `costPrice` continuam estimadas — e o relatório diz quantas linhas foram estimadas e por que valor.

---

## 3. Relançamento duplicado no PDV (V-C11)

**O problema:** o corte de inventário anula vendas para serem relançadas. Nada impedia lançar duas vezes — stock a sair duas vezes e cliente facturado duas vezes, em silêncio.

**A guarda:** antes de gravar, o PDV compara a venda em construção com as vendas **do mesmo dia**:

```
cliente normalizado + total ao cêntimo + conjunto de linhas (produto, quantidade, unidade)
```

Se encontrar:

- **uma venda válida igual** → é um relançamento repetido;
- **uma venda anulada igual** → é a original do corte, e o operador deve saber que ela existe.

Aparece então:

> **VENDA POSSIVELMENTE DUPLICADA**
> Já existe hoje uma venda igual: FT-2026-0042 (350,00 MT).
> Existe uma venda anulada igual (FT-2026-0041) — se está a relançar vendas do corte de inventário, cada uma deve entrar uma única vez.
> Gravar mesmo assim? Se for engano, cancele e verifique as facturas do dia.

É uma confirmação, não um bloqueio: duas vendas genuinamente iguais (dois clientes, mesmo produto, mesmo valor) acontecem numa loja, e travar isso obrigaria o operador a inventar diferenças. Mas agora exige um clique consciente.

---

## Ficheiros

| Ficheiro | O que mudou |
|---|---|
| `src/components/FinanceModule.tsx` | formulário de sangria/entrada com senha de gestor, limite de saldo, auditoria; custo congelado nos relatórios |
| `src/App.tsx` | passa `currentUser` ao módulo financeiro |
| `src/utils/reporting.ts` | tabela por produto usa `costPrice` quando existe |
| `src/components/PDVModule.tsx` | guarda de duplicados antes de gravar; `× 0,6` removido |
| `src/utils/firebaseDB.ts` | `× 0,6` removido no custo gravado |
| `src/utils/saleDuplicates.ts` | **novo** — assinatura da venda e detecção de conflito |
| `test/sale_duplicates_test.ts` | **novo** — 16 asserções |

## Verificação

```
npx tsc --noEmit                                       → sem erros
TZ=Africa/Maputo npx tsx test/sale_duplicates_test.ts   → 16/16
TZ=Africa/Maputo npx tsx test/reporting_test.ts         → 35/35
TZ=Africa/Maputo npx tsx test/cash_box_test.ts          → 15/15
TZ=Africa/Maputo npx tsx test/inventory_cutoff_test.ts  → 49/49
TZ=Africa/Maputo npx tsx test/master_plan_test.ts       → 44/44
npx vite build                                          → concluído
```

**Necessita prova no local:**

1. fazer uma sangria de 500 MT e confirmar que o saldo do Livro de Caixa desce exatamente esse valor;
2. relançar uma venda anulada por corte de inventário e tentar lançá-la segunda vez — tem de aparecer o aviso;
3. vender dois artigos iguais em dias diferentes e confirmar que **não** aparece aviso (o dia é comparado em Maputo, não em UTC).
