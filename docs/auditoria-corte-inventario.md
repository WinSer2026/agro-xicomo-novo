# Corte de Inventário — o que é, vulnerabilidades e correcções

> **Correcção de uma afirmação minha.** Eu disse que o "Corte de Inventário" não existia. Era verdade no ramo em que trabalho e falso no sistema que está a usar. O repositório tem **duas linhas sem ancestral comum**:
> - `main` — um único commit (`144f53c`), com `InventoryCutoffTool.tsx`, `utils/inventoryCutoff.ts`, `Toast.tsx` e os métodos `cancelSalesBulk` / `applyStockCorrection`. **É esta a versão que vê no ecrã.**
> - o ramo de trabalho (`arena/4eb80ec1…`, 10 commits), criado a partir de `62fcc57`, **sem** essa ferramenta.
>
> Não verifiquei os outros ramos antes de afirmar que não existia. A ferramenta foi agora trazida para este ramo, integrada e auditada.

---

## 1. Para que serve (e porque é legítima)

A contagem física é feita às 07:00. O lançamento no sistema acontece às 18:00. Entre as duas horas a loja continuou a vender. Quando o lançamento grava a contagem como **valor absoluto**, apaga o efeito dessas vendas — o sistema fica com stock **a mais** exatamente nas quantidades vendidas no intervalo.

Há duas formas legítimas de o corrigir:

| Modo | O que faz | Quando usar | Risco |
|---|---|---|---|
| **Anular vendas do período** | Marca as facturas como `Cancelada` e (por omissão) **não** devolve stock; depois relança-se as vendas no PDV | quando se quer refazer a operação do intervalo | alto — obriga a relançar tudo à mão |
| **Descontar vendas do stock** | Mantém as facturas válidas e desconta do stock as quantidades vendidas após a contagem | via normal | baixo — nenhum documento muda |

E a caixa **"devolver as quantidades ao stock"** (`restoreStock`): só faz sentido quando as vendas a anular **já tinham descontado stock** e esse stock **não** foi recontado. No cenário do corte tem de ficar **desligada** — se estiver ligada, o stock sobe e o inventário fica com produto a mais (o teste do módulo demonstra-o: 630 kg em vez de 370 kg, 260 kg a mais).

---

## 2. Vulnerabilidades encontradas

| ID | Nív. | Achado | Estado |
|---|---|---|---|
| **V-C01** | P0 | **Anulação em massa sem nota de crédito.** `annotateCancelledSale` escrevia só `status: 'Cancelada'` numa nota. Dezenas de facturas anuladas sem documento de rectificação — numa inspecção, são facturas em falta. | **Fechado**: `cancelSalesBulk` numera uma NC por documento no mesmo contador transaccional da anulação individual. |
| **V-C02** | P0 | **Perda de actualização no stock.** `applyStockCorrection` gravava o saldo **absoluto** calculado no ecrã. Uma venda feita entre a abertura do painel e o clique era apagada pelo valor antigo. Com dois postos, destruía o stock sem aviso. | **Fechado**: lê o saldo dentro da transacção e aplica só a **diferença**. As vendas entretanto registadas continuam descontadas. |
| **V-C03** | P0 | **Produtos fantasmas.** Escrevia em `products/{id}` com `merge` sem verificar existência: um produto eliminado voltava a existir com stock e sem nome nem preço. | **Fechado**: só se escreve em produtos que existem. |
| **V-C04** | P1 | **Sem verificação de estado.** Uma venda já anulada era anulada outra vez (e re-notada), porque o estado que contava era o do ecrã. | **Fechado**: o estado é lido da base dentro da transacção; já anuladas são ignoradas. |
| **V-C05** | P1 | **Fuso horário errado.** `toDayKey` fazia `substring(0,10)` em ISO (data **UTC**) e `selectSalesForCutoff` comparava o texto `T HH:MM` **UTC** com horas locais. Em Maputo, vendas das 22:00 às 24:00 caíam no dia seguinte e ficavam fora do corte; a janela horária estava duas horas deslocada. | **Fechado**: dia e hora calculados sempre em `Africa/Maputo`, com testes próprios (49/49). |
| **V-C06** | P1 | Estado legado `'canceled'` não era reconhecido: vendas anuladas contavam como stock vendido. | **Fechado** em `isStockImpactingSale` e `selectSalesForCutoff`. |
| **V-C07** | P2 | **Recibos de facturas anuladas continuam válidos.** A factura passa a `Cancelada` e ganha NC, mas o `receiptNumber` fica e o recibo entregue ao cliente não é referido na NC. | **Aberto** |
| **V-C08** | P2 | **Auditoria agregada.** Um único registo para N vendas, sem lista de facturas nem NC emitidas. Não se prova, documento a documento, o que foi anulado. | **Aberto** |
| **V-C09** | P2 | **Duas fases.** Anulação (transaccional) e correcção de stock (transaccional) são chamadas seguidas. Uma falha entre elas deixa vendas anuladas **sem** a correcção de stock. | **Parcial** |
| **V-C10** | P2 | O motivo é texto livre e pode ir vazio — a nota de auditoria fica sem justificação. | **Aberto** |
| **V-C11** | P2 | O modo "anular e relançar" não impede o **relançamento duplicado** no PDV: se o operador repetir, vende duas vezes. | **Aberto** |
| **V-C12** | P3 | `projectStock` usa `Math.max(0, …)`: a pré-visualização esconde saldos negativos em vez de os mostrar. | **Aberto** |
| **V-C13** | P3 | `ipAddress: '127.0.0.1'` fixo no registo de auditoria. | **Aberto** |

---

## 3. O que mudou no código deste ramo

1. **Trazidos** `InventoryCutoffTool.tsx`, `utils/inventoryCutoff.ts`, `Toast.tsx` e `test/inventory_cutoff_test.ts` da linha `main`.
2. **Reescritos** `cancelSalesBulk` e `applyStockCorrection` contra a camada de dados deste ramo (transacções, NC, contador único).
3. **Corrigido o fuso horário** no módulo de domínio, com três asserções novas no teste.
4. **Integrado** o botão "Corte de Inventário" no cabeçalho da Gestão de Facturas, abrindo a ferramenta em modal.
5. **Compactado** o painel da ferramenta: cabeçalho e secções mais baixos, tipografia reduzida, cartões de modo mais pequenos, corpo com altura máxima e scroll interno — cabe numa janela sem arrastar a página.

## 4. Verificação

`npx tsc --noEmit` sem erros · `test/inventory_cutoff_test.ts` **49/49** · `test/master_plan_test.ts` 44/44 · `vite build` concluído.

**Não verificado:** o comportamento com dois postos a operar durante o corte, e o relançamento no PDV após anulação em massa — só se fecham em ambiente real.

## 5. Plano de correcção (o que falta)

| Ordem | Item | Porquê |
|---|---|---|
| 1 | **V-C09** — juntar anulação e correcção numa só transacção (ou marcar a operação como "pendente de stock") | evita vendas anuladas sem correcção |
| 2 | **V-C07** — a NC tem de referir o recibo anulado e o recibo deve ficar marcado | rasto documento ↔ dinheiro |
| 3 | **V-C08** — auditoria por documento, com a lista de NC emitidas | prova para a inspecção |
| 4 | **V-C11** — marca na venda anulada que impede relançamento duplicado | venda dupla |
| 5 | **V-C10** — motivo obrigatório com mínimo de caracteres | justificação |
| 6 | **V-C12/V-C13** — saldos negativos visíveis e IP real | qualidade da prova |
