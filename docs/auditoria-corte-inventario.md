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
| **V-C07** | P2 | **Recibos de facturas anuladas continuam válidos.** A factura passa a `Cancelada` e ganha NC, mas o `receiptNumber` fica e o recibo entregue ao cliente não era referido. | **Fechado parcialmente**: a nota da venda e a NC passam a declarar o recibo anulado e a hora. O recibo físico continua a existir — depende do procedimento no balcão |
| **V-C08** | P2 | **Auditoria agregada.** Um único registo para N vendas, sem lista de facturas nem NC emitidas. | **Fechado**: o registo passa a incluir o mapa `factura→nota de crédito` (até 60 pares) e o número de documentos ignorados |
| **V-C09** | P0 | **Duas fases.** Anulação e correcção de stock eram duas transacções seguidas: uma falha entre elas deixava vendas anuladas **sem** correcção de stock. | **Fechado**: `applyCutoff` escreve vendas, notas de crédito, contador e stock no mesmo commit |
| **V-C10** | P2 | O motivo é texto livre e podia ir vazio. | **Fechado**: mínimo de 10 caracteres, validado antes de executar |
| **V-C11** | P2 | O modo "anular e relançar" não impede o **relançamento duplicado** no PDV: se o operador repetir, vende duas vezes. | **Aberto** |
| **V-C14** | **P0** | **A palavra-passe do corte nunca podia estar certa.** O ecrã comparava o texto escrito com o próprio `stockPasswordHash` (`typed !== expected`). Com a palavra-passe guardada em hash — que é o formato normal — qualquer tentativa falhava; e onde fosse texto simples, a palavra-passe era válida por comparação direta, sem o helper de autorização. | **Fechado**: passa a usar `verifyAuthorizationPassword` (hash com salt) |
| **V-C12** | P2 | `projectStock` usava `Math.max(0, …)`: a pré-visualização escondia saldos negativos. Um artigo que ia ficar a −40 kg aparecia a 0 — indistinguível de «já não há stock», quando na verdade a venda saiu de mercadoria que o sistema não tem. | **Fechado**: a pré-visualização mostra o saldo real, a vermelho, com «falta X»; um aviso conta os artigos sem stock suficiente. A gravação continua a travar em zero e a dizer o nome do artigo |
| **V-C13** | P3 | `ipAddress: '127.0.0.1'` fixo no registo de auditoria. | **Fechado**: IP real via `/api/client-info` |

---

## 3. O que mudou no código deste ramo

1. **Trazidos** `InventoryCutoffTool.tsx`, `utils/inventoryCutoff.ts`, `Toast.tsx` e `test/inventory_cutoff_test.ts` da linha `main`.
2. **Reescritos** `cancelSalesBulk` e `applyStockCorrection` contra a camada de dados deste ramo (transacções, NC, contador único).
3. **Corrigido o fuso horário** no módulo de domínio, com três asserções novas no teste.
4. **Integrado** o botão "Corte de Inventário" no cabeçalho da Gestão de Facturas, abrindo a ferramenta em modal.
5. **Compactado** o painel da ferramenta: cabeçalho e secções mais baixos, tipografia reduzida, cartões de modo mais pequenos, corpo com altura máxima e scroll interno — cabe numa janela sem arrastar a página.
6. **Unificada a execução** em `applyCutoff`: anulação + notas de crédito + contador + stock num só commit.
7. **Corrigida a palavra-passe** (V-C14): comparava o texto com o hash guardado.
8. **Motivo obrigatório**, IP real e resultado detalhado no ecrã (NC emitidas, documentos ignorados, stock travado em zero, operação dividida em lotes).

## 4. Verificação

`npx tsc --noEmit` sem erros · `test/inventory_cutoff_test.ts` **54/54** · `test/master_plan_test.ts` 44/44 · `vite build` concluído.

**Não verificado:** o comportamento com dois postos a operar durante o corte, e o relançamento no PDV após anulação em massa — só se fecham em ambiente real.

## 5. Plano de correcção — estado

| Ordem | Item | Estado |
|---|---|---|
| 1 | **V-C09** — anulação e stock na mesma transacção | ✅ feito |
| 2 | **V-C07** — NC refere o recibo anulado | ✅ feito (resta o procedimento no balcão) |
| 3 | **V-C08** — auditoria com mapa factura→NC | ✅ feito |
| 4 | **V-C10** — motivo obrigatório | ✅ feito |
| 5 | **V-C13** — IP real | ✅ feito |
| 6 | **V-C14** — palavra-passe comparada com o hash | ✅ feito |
| 7 | **V-C11** — impedir relançamento duplicado no PDV | ⏳ em aberto |
| 8 | **V-C12** — mostrar saldos negativos na pré-visualização | ✅ feito |
| 9 | **V-C09 (lote)** — acima de 150 vendas a operação é dividida; sinalizar no registo de stock | ⏳ em aberto |
