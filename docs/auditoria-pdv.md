# Auditoria Profunda do PDV — AGRO‑XIComo & Serviços, Lda
## Diagnóstico exaustivo do fluxo de vendas (2.ª passagem, linha a linha)

**Sistema:** `WinSer2026/agro-xicomo-novo` · React 19 + Vite + TypeScript (strict desligado) + Firestore
**Alvo:** tudo o que participa numa venda — PDV, emissão de documentos, stock, faturas, finanças, RH, servidor e API.
**Data:** 2026‑11‑09 · **Âmbito:** 16 ficheiros de componentes, 14 utilitários, `server.ts`, regras Firestore, sementes de dados.
**Método:** leitura integral do código, reprodução de cálculos com Node.js, execução de `tsc`, inspecção do bundle de dados e do CSS de impressão.
**Relação com a 1.ª passagem:** este documento **substitui** o anterior. Dos 78 achados iniciais, a maioria confirmou‑se com linha exacta; alguns foram reformulados porque a causa era outra (o caso mais importante está em §2.1: existe `writeBatch`, ao contrário do que a 1.ª passagem afirmou); e foram abertas áreas que a 1.ª passagem não leu — `server.ts` e a API, o pipeline de impressão e o CSS de `@media print`, o login e a chave mestra, o balancete do módulo financeiro, a pesquisa global, as operações de manutenção destrutiva e a formatação numérica. O catálogo final tem **97 achados** (26 P0, 49 P1, 21 P2, 1 P3), todos com identificador estável, prova e correcção.

---

## 0. Como ler este documento

Cada defeito tem um identificador estável (`A‑01`, `F‑03`, `J‑07`…), uma **gravidade** e uma **prova** (`ficheiro:linha`). A escala de gravidade é financeira, não estética:

| Nível | Significado | Critério objectivo |
|---|---|---|
| **P0** | Perda directa de dinheiro, stock ou dados, ou fraude possível hoje | Um operador normal, a fazer o seu trabalho, produz um erro contabilístico irreversível |
| **P1** | Erro fiscal/contabilístico ou bloqueio operacional | O documento emitido não é legalmente válido ou a operação fica impossível |
| **P2** | Erro funcional visível, sem perda imediata | Dados errados no ecrã, decisões tomadas com informação falsa |
| **P3** | Qualidade, consistência, manutenção | Não altera números, mas esconde os que estão errados |

A regra de priorização usada é simples: **se o erro aparece num documento que sai da loja (fatura, recibo, relatório de fecho), sobe um nível.**

Uma nota importante sobre o que se segue: não se trata de "más práticas". Cada achado tem um número. Onde digo "5.000 MT", é 5.000 MT que existem ou não existem na caixa no fim do dia. Onde digo "stock a 0", é uma prateleira vazia que o sistema diz estar cheia.

### 0.1 Os dez primeiros (se só houver tempo para dez)

| # | Achado | O que acontece hoje |
|---|---|---|
| 1 | **G‑01** | Recuperar uma venda pausada e finalizar **não apaga o rascunho**: ao recarregar, o banner volta e a mesma venda pode ser gravada outra vez |
| 2 | **D‑06** | Venda de 1.000 MT com 600 MT digitados no pagamento múltiplo é gravada como **`Paga`**; o troco nem sequer é guardado |
| 3 | **D‑01/D‑02** | Toda a fatura A4 fica **`Pendente`** mesmo paga em dinheiro, e toda a **proforma** entra como dívida |
| 4 | **D‑03** | Vendas a crédito aparecem **a vermelho como CANCELADA** e não têm botão de pagamento |
| 5 | **B‑01** | Numeração `max+1` no cliente: dois caixas emitem **o mesmo número de fatura** |
| 6 | **C‑01** | Venda depois da meia‑noite conta para **o dia anterior** em todos os relatórios |
| 7 | **F‑01** | A reconciliação de stock devolve **sempre zero** (`difference = 0` literal) |
| 8 | **F‑02** | O inventário vale **0 MT** e o PDF de stock **rebenta** (`p.buyPrice` não existe) |
| 9 | **F2‑01** | O cartão mostra o preço de **atacado** e o carrinho cobra **retalho** (1.200 vs 1.500 no mesmo saco) |
| 10 | **L‑01/L‑03** | `Mazive/0147` entra como **Técnico**, e as regras do Firestore estão em `allow read, write: if true` |

---

## 1. Método, ferramentas e reprodutibilidade

### 1.1 O que foi executado

| Passo | Comando / acção | Resultado |
|---|---|---|
| 1 | `npx tsc --noEmit` | **0 erros** — mas ver §11.1: o React não tem tipos |
| 2 | `npx tsx test/master_plan_test.ts` | 41 testes, 41 passam — **nenhum cobre o PDV** (§11.2) |
| 3 | `node -e` com `TZ=Africa/Maputo` para round‑trip de datas | Prova do desvio de 2 h (§3 / C‑01) |
| 4 | Leitura integral de `PDVModule.tsx` (4.559 linhas) em 12 blocos | 100 % do ficheiro |
| 5 | Leitura integral de `server.ts`, `index.css` (bloco print), `firebaseDB.ts` | API e persistência |
| 6 | `grep -rn` de credenciais, `confirm(`, `toLocaleString()`, `/api/`, `clearSystemData` | Mapas de risco §12 |
| 7 | Simulações aritméticas dos caminhos de código (não estimativas) | §7 |

### 1.2 O que **não** foi possível validar (e porquê)

- **Impressora térmica física / Web Serial**: o ambiente de pré‑visualização é um iframe sem acesso a portas série. Todo o diagnóstico de hardware é por leitura de código (`posHardware.ts`) e não por reprodução.
- **Firestore real**: o projecto `gen-lang-client-0896153566` não é acessível a partir daqui. Tudo o que depende de concorrência multi‑terminal foi deduzido do código (não há `runTransaction` — ver §6.1/A‑03), o que é suficiente para afirmar a inexistência de atomicidade.
- **Dados de produção**: os valores usados nas simulações vêm das sementes de `firebaseDB.ts` (preços e stocks iniciais), não de uma exportação real.

### 1.3 Convenções

- `→` significa "resultado de".
- Todos os valores monetários em **MT** (meticais), 2 decimais.
- "Sessão de caixa" é o conjunto de vendas entre abertura e fecho de um turno.

---

## 2. Arquitectura real do sistema (o que existe, não o que o README diz)

Antes de acusar o PDV de inconsistência, é preciso perceber **quantas fontes de verdade** o sistema tem. São cinco, e elas não se conhecem.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Firestore (nuvem)   coleções: products, sales, customers,          │
│                        employees, credentials, settings, audit_logs,  │
│                        losses, transformations, payroll_payments …    │
│                        REGRAS: allow read, write: if true  ← furo     │
├──────────────────────────────────────────────────────────────────────┤
│ 2. localStorage        agro_local_products, agro_local_sales,         │
│                        active_cart, active_sessions, backup_auto…     │
│                        (fallback + cache; escreve sem versão)         │
├──────────────────────────────────────────────────────────────────────┤
│ 3. IndexedDB           src/utils/indexedDB.ts (1.993 linhas) —        │
│                        camada completa e PARALELA, com ids diferentes  │
│                        (`idb-…`) e chamadas fetch a /api/sync         │
├──────────────────────────────────────────────────────────────────────┤
│ 4. Servidor Express    server.ts: /api/backup, /api/sync[/save|/delete]│
│                        grava em disco, SEM autenticação                │
├──────────────────────────────────────────────────────────────────────┤
│ 5. Estado React        PDVModule.cart, products, salesPage, invoiceToPrint│
│                        (o único que o utilizador vê)                   │
└──────────────────────────────────────────────────────────────────────┘
```

O PDV escreve em **1** (via `dbService`), lê de **1** e de **2**, e o `invoiceToPrint` (fonte dos documentos impressos) é **estado React puro** — nunca é relido da base de dados antes de imprimir. É por isso que um documento pode sair com números que já não existem em lado nenhum (§6.10/J‑05).

O caminho **3+4** é código morto: `indexedDB.ts` não é importado por nenhum componente do fluxo de vendas (só por `App.tsx`? — verificado: não é) e o seu `EventSource('/api/sync/events')` aponta para uma rota que **não existe** em `server.ts` (M‑02). Ou seja: existe um subsistema inteiro de sincronização que nunca corre, mas que os comentários do código apresentam como activo.

### 2.1 O que é atómico e o que não é (correcção importante face à 1.ª passagem)

A 1.ª passagem afirmou que "não há transacções". **Isso é falso e a correcção importa**, porque muda o diagnóstico e a prioridade: `addSaleWithStockDeduction` (`firebaseDB.ts:778‑834`) usa `writeBatch` e `increment()`; a venda e a dedução de stock são gravadas **no mesmo commit**, e o mesmo vale para `cancelSaleWithStockRestoration` (`:836‑880`) e `deductProductStock` (`:612‑634`). Um falha tudo, o outro também. Quem escreveu isto sabia o que estava a fazer.

O problema é **onde essa disciplina não chegou**:

| Caminho | Atómico? | Observação |
|---|---|---|
| Venda normal (PDV) | ✅ batch | `:778`, `increment` correcto |
| Cancelamento + estorno | ✅ batch | `:836` |
| Dedução manual de stock | ✅ batch | `:612` |
| **Venda retroactiva sem dedução** | ❌ `addSale` | upsert simples (`:770`) |
| **Restauro de fatura** | parcial | volta a deduzir, mas por `addSale` + `saveProducts` |
| **Finalizar ano / zerar sistema** | ❌ | `clearSystemData` apaga colecção a colecção |
| **Pagamento de fatura** | ❌ | status + caixa em dois passos |
| **Regenerar referências** | ❌ | `saveProducts` com o catálogo todo do cliente |
| **Contagem física** | parcial | perdas + produtos em chamadas separadas |

Ou seja: o núcleo da venda é sólido; **o que o rodeia não é**. E como `increment` não tem guarda, o stock pode ir a negativo de forma perfeitamente atómica (F‑03) — a atomicidade garante que o erro é consistente, não que é correcto.

A consequência prática mantém‑se para tudo o que está fora do núcleo: uma falha a meio de `clearSystemData` deixa metade das colecções apagadas, e não há registo disso. E `reconcileStock` devolve `difference = 0` sempre (`:1633`), pelo que nenhuma destas divergências é detectada depois.

---

## 3. Inventário funcional do PDV (o que o módulo faz, linha a linha)

`PDVModule.tsx` tem 4.559 linhas e 62 funções nomeadas. Inventário completo por bloco, com estado de saúde:

| # | Funcionalidade | Linhas | Estado |
|---|---|---|---|
| 1 | Busca de produto (texto, código, referência, EAN) | 900‑1010 | OK |
| 2 | Leitura de código de barras (teclado + câmara) | 620‑700 | Funciona; sem validação de duplicados |
| 3 | Carrinho (adicionar/remover/alterar qty) | 1030‑1240 | **P1** — valida stock contra cache; `''` aceite |
| 4 | Unidade de venda Retalho/Atacado | 1060‑1100 | **P0** — Atacado inalcançável por omissão |
| 5 | Desconto por linha e global | 1120‑1180 | P1 — desconto pode exceder o subtotal |
| 6 | Cliente (novo, pesquisa, NUIT) | 1450‑1560 | OK (NUIT sem validação) |
| 7 | Métodos de pagamento + "Múltiplo" | 2330‑2440 | **P0** — parcelas não validadas (D‑06) |
| 8 | Cálculo de troco | 2600‑2660 | P1 — troco de Múltiplo é fictício |
| 9 | Finalizar venda (5 formatos) | 1268‑1500 | **P0** — formato define estado (D‑01/D‑02) |
| 10 | Numeração fatura/recibo | 1300‑1345 | **P0** — max+1, ano do cliente |
| 11 | Venda pausada / recuperar | 1800‑1900 | **P0** — duplica vendas |
| 12 | Venda antiga (retroactiva) | 4080‑4559 | **P0** — várias falhas em série |
| 13 | Impressão A4 / A5 / recibo / POS | 2870‑3700 + `pdfGenerator` | **P1** — IVA ausente, nº de recibo fabricado |
| 14 | Impressão directa ESC/POS | `posHardware.ts` | P1 — falha silenciosa |
| 15 | Gaveta de caixa | `posHardware.ts` | OK condicional |
| 16 | Cliente rápido / associação de código | 960‑1060 | OK |
| 17 | Histórico do dia (tabela) | 2180‑2560 | P2 — sem filtro de estado |
| 18 | Relatório de fecho (imprimir) | 2500‑2870 | P1 — datas erradas (C‑01), dinheiro correcto |
| 19 | Exportação CSV de vendas | 2515‑2530 | P2 — `s.receiptNumber \|\| ''` |
| 20 | Assistente IA técnico | 740 | **Morto** — 404 |
| 21 | Recuperação pós‑crash | 137‑147, 1789 | **P0** — rascunho nunca apagado (G‑01) |

Os pontos 3, 4, 7, 9, 10, 11, 12, 18 e 21 são os que produzem perda mensurável. Os restantes produzem documentos errados ou decisões erradas.

---

## 4. A máquina de estados da venda (e onde ela se parte)

O tipo `Sale` admite quatro estados (`types.ts:65`): `'Paga' | 'Pendente' | 'Cancelada' | 'Crédito'`. Mas quem decide o estado **não é o pagamento** — é o formato de impressão escolhido:

```ts
// PDVModule.tsx:1308‑1314
const effectiveDocType = printFormat === 'FaturaProforma' ? 'FaturaProforma' : 'FaturaDefinitiva';
let finalStatus: Sale['status'] = 'Paga';
if (effectiveDocType === 'FaturaProforma' || printFormat === 'A4') finalStatus = 'Pendente';
else if (paymentMethod === 'Crédito') finalStatus = 'Crédito';
```

A tabela completa de combinações, com o veredicto:

| Pagamento | Formato escolhido | Estado gravado | Correto? |
|---|---|---|---|
| Dinheiro | Térmico (POS) | `Paga` | ✅ |
| Dinheiro | A5 duplicado | `Paga` | ✅ |
| Dinheiro | Recibo A4 | `Paga` | ✅ |
| **Dinheiro** | **Fatura A4** | **`Pendente`** | ❌ pago, mas registado como dívida (D‑01) |
| Múltiplo (parcelas = total) | Térmico | `Paga` | ✅ |
| **Múltiplo (parcelas < total)** | **Térmico** | **`Paga`** | ❌ cobrado a menos, marcado como pago (D‑06) |
| Crédito | Térmico | `Crédito` | ⚠️ estado sem saída na UI (D‑03, D‑07) |
| Crédito | A4 | `Pendente` | ⚠️ confunde-se com dívida paga em dinheiro |
| Qualquer | **Proforma** | **`Pendente`** | ❌ cotação contabilizada como dívida (D‑02) |

```
                    ┌───────────────┐
   A4 / Proforma    │               │   Pagar (só no Faturas)
   ────────────────▶│   Pendente    │──────────────────┐
                    └───────┬───────┘                  │
                            │ Cancelar                 ▼
                            ▼                  ┌───────────────┐
                    ┌───────────────┐          │     Paga      │
                    │   Cancelada   │          └───────┬───────┘
                    └───────┬───────┘                  │
                            │ Restaurar → Pendente ◀────┘ Cancelar
                            ▼
   Térmico + método Crédito → 'Crédito' → badge "CANCELADA", sem botão Pagar, sem Restaurar
```

Três consequências verificadas:

1. **O estado depende do papel, não do dinheiro (D‑01/D‑02).** Toda a fatura A4 fica `Pendente` mesmo paga em dinheiro; toda a proforma fica `Pendente` mesmo sem nunca ter havido venda. O mapa de dívidas e o KPI "Pendente" de `FaturasModule.tsx:627‑640` somam as duas coisas e deixam de significar qualquer coisa.

2. **`'Crédito'` é um beco sem saída (D‑03/D‑07).** Em `FaturasModule.tsx:765` o badge é `status === 'Paga' ? 'PAGA' : status === 'Pendente' ? 'PENDENTE' : 'CANCELADA'` — logo `'Crédito'` aparece **a vermelho, como cancelada**. E o botão "Pagar" só existe para `status === 'Pendente'` (`:773`), o "Restaurar" só para `'Cancelada'`. Não há aba de filtro para `'Crédito'` (`:690`). Uma venda a crédito não pode ser liquidada por nenhum caminho da interface.

3. **O estado nunca é confrontado com o valor recebido (D‑06).** `handleFinalizeSale` não verifica as parcelas do pagamento múltiplo nem o valor entregue. O troco (`amountReceived - total`) só existe no ecrã (`:2421‑2426`): `Sale` **não tem** campo `amountReceived` nem `change`, pelo que não é possível reconstruir depois se o cliente entregou 1.000 ou 5.000. E o cancelamento, que repõe stock correctamente (D‑04), não estorna caixa nem emite nota de crédito (E‑06).

---

## 5. Leitura linha a linha do `PDVModule.tsx`

Esta secção percorre o ficheiro na ordem em que o operador o usa. Não substitui §6 (catálogo de defeitos), complementa‑o: aqui o critério é **o que acontece quando se clica**.

### 5.1 Arranque e carga (1‑760)

`loadPDVData` (≈700‑760) faz, por esta ordem: `dbService.init()` → `getProducts()` → `getSalesPage({pageSize:30})` → `getSettings()` → `getCustomers()` → `getEmployees()`.

- **5.1.1** Se `getSalesPage` falhar (rede, índice em falta), o `catch` genérico impede o `setProducts` e o ecrã fica **vazio** com o toast "Erro ao carregar dados". Não há retry, não há cache local usada, apesar de `localStorage` ter os produtos (§2). Um operador numa loja com Wi‑Fi instável fica sem PDV.
- **5.1.2** O bloco `else` que devia limpar a venda pausada **não existe** (ver I‑01): se `getActiveCart()` devolver algo, o estado fica carregado mesmo depois de o carrinho ser limpo noutro sítio, e o banner "Recuperar venda anterior" (`:1789`) reaparece no dia seguinte.
- **5.1.3** `loadPDVData` (712‑760) carrega `products`, `settings`, `sales`, `customers` e `pausedSales`, e ainda chama `enableLiveCatalogAndSalesSync()`. **Não** carrega funcionários — a exposição salarial está na pesquisa global (§L‑06), não aqui. Mas carrega **todas as vendas** (`getSales()`), que é o que alimenta a numeração client-side (B‑01).

### 5.2 Pesquisa e leitura de código (900‑1030)

- **5.2.1** A pesquisa é `products.filter(...)` sobre o array completo — funciona, mas é recalculada a cada tecla em 200+ produtos sem `useMemo`; com 2.000 produtos (importação) a caixa fica lenta.
- **5.2.2** Um produto com `stockQty: 0` continua a aparecer e a ser seleccionável; o bloqueio só acontece no `addToCart`, e mesmo aí apenas para stock total.
- **5.2.3** O leitor de código de barras funciona por evento de teclado global; se o foco estiver no campo de quantidade, os dígitos do EAN entram no campo de quantidade. Não há distinção entre input humano e scanner.

### 5.3 Carrinho (1030‑1240) — o centro do problema

```ts
// :1078
const selectedUnit = preferredUnit || (hasConversion ? 'Retail' : 'Retail');
```

- **5.3.1** Esta linha é um ternário morto: os dois ramos são `'Retail'`. `preferredUnit` vem do UI de seleção. Para um produto híbrido (ex.: saco de 25 kg que também se vende a retalho), **sem escolha explícita, a venda é sempre a retalho**. O catálogo, no cartão do produto, mostra o preço de **Atacado** (`:1945‑1950`, condicionado por `prod.parentUnit === 'Sacos'`), mas o carrinho insere a retalho. O cliente vê X, paga Y. Ver F2‑01.
- **5.3.2** `updateCartQty('')` guarda `quantity: '' as any` com `totalPrice: 0` (`:1140‑1148`). Não há `NaN` — `unitPrice * ''` é 0 — mas a linha fica na venda a **0 MT**, com uma string num campo numérico, e entra no documento impresso. Só o `blur` repõe 1. Ver K‑02 (e §6, quadro "retirado").
- **5.3.3** O tecto de stock **existe** (`:1057‑1085`, `:1160‑1180`), mas é comparado com o array em memória: um carrinho aberto há 20 minutos valida contra quantidades que já podem ter sido vendidas no outro terminal, e no momento da escrita não há guarda (F‑04, F‑03).
- **5.3.4** O botão de adicionar (`:2010`) decide-se por `prod.stockQty`: um produto com `stockQty: 0` mas `stockQtyRetail: 12` mostra "Sem stock" e botão desactivado; o inverso também acontece. O cartão nunca olha para `stockQtyBulk`/`stockQtyRetail`, embora o carrinho os use. Ver F2‑02.
- **5.3.5** `onError` da miniatura (`:1928`) substitui a imagem por **uma URL do Unsplash** (`images.unsplash.com`). Num ambiente sem Internet externa (o caso desta pré‑visualização, e o caso de uma loja com firewall) a imagem falha em ciclo e o `onError` volta a disparar; além disso, um produto sem foto passa a mostrar a foto de **outro** produto genérico, o que numa farmácia/agro‑loja é um risco de identificação errada.

### 5.4 Descontos (1120‑1180)

- **5.4.1** `discount` é aplicado ao subtotal sem verificação de limite: um desconto de 150 % produz total negativo. Não há autorização por perfil nem registo de quem autorizou (o `audit_log` da venda regista o operador, não o autorizador).
- **5.4.2** O desconto global e o desconto por linha somam‑se sem ordem definida; o valor mostrado no modal de confirmação (`:1448`, com `toLocaleString()` sem locale) pode diferir do valor gravado (que usa `Math.round` a 2 casas).

### 5.5 Cliente (1450‑1560)

- **5.5.1** O NUIT não é validado (nem comprimento, nem dígito de controlo). Uma fatura com NUIT inválido é emitida e assinada electronicamente pelo PDF.
- **5.5.2** Não há limite de crédito por cliente: qualquer cliente pode levar 500.000 MT a crédito.

### 5.6 Pagamentos e "Múltiplo" (2330‑2440) — P0

- **5.6.1** O detalhe por método **é** gravado (`paymentBreakdown`, `:1327‑1344`) e o relatório itera sobre ele (`:2563‑2575`) — a 1.ª passagem errou aqui. O pagamento 600 numerário + 400 BCI aparece correctamente no fecho.
- **5.6.2** O que falta é a **validação**: o painel mostra `Falta: 400 MT` (`:2374‑2384`), mas `handleFinalizeSale` não lê `multiPaymentLines`. Uma venda de 1.000 MT com 600 digitados é gravada como `Paga`. Ver D‑06.
- **5.6.3** O troco (`amountReceived - total`, `:2421‑2426`) só existe no ecrã: `Sale` não tem `amountReceived` nem `change`, pelo que não há como auditar depois.

### 5.7 Finalização (1268‑1500)

- **5.7.1** O `finally` repõe `isFinalizing = false` mesmo quando a venda **não** foi gravada; o utilizador pode repetir. Como `clearCompletedCheckout()` só corre depois do `await` de gravação, uma falha de rede mantém o carrinho — bom — mas o duplo clique antes do `await` está protegido apenas por `if (isFinalizing) return` (correcto).
- **5.7.2** `downloadInvoicePDF` (`:1252`) **descarrega sempre um ficheiro**. O ramo chamado "pré‑visualização" (`else`, `:1452‑1460`) chama `downloadInvoicePDF` e depois abre o modal. Ou seja: cada venda gera um download no disco do operador **e** um modal. Em 200 vendas/dia são 200 PDFs na pasta Downloads, com nomes que dependem do número da fatura. O utilizador não pediu download nenhum.
- **5.7.3** A impressão automática de recurso (`:1425‑1440`) dispara `window.print()` 500 ms depois de `setInvoiceToPrint(null)`/`setPrintType(null)`. O CSS de impressão esconde tudo excepto `#thermal_receipt_80`, que só renderiza `invoiceToPrint` — que é `null`. Resultado: **página em branco garantida**. É o "fallback" que existe precisamente para quando a impressora falha; falha sempre. Ver J‑01.
- **5.7.4** O `audit_log` da venda grava `ipAddress: '127.0.0.1'` fixo (`:1389`). Nenhuma venda é rastreável a um terminal.

### 5.8 Numeração (1300‑1345) — P0 fiscal

```ts
// :1320
// Generate sequential invoice number (Fact-2026-N) and receipt number (Rec-2026-N)
```
- **5.8.1** `sequenceHelper.ts` faz `max(números existentes) + 1` **no cliente**, a partir da página de vendas carregada (30 registos). Dois terminais → o mesmo número. Uma venda apagada → o número é reutilizado. Um ano novo → contador recomeça mas o prefixo do ano vem de `new Date().getFullYear()` **do terminal**, não da data da venda (relevante para vendas antigas: ver H‑02).
- **5.8.2** O prefixo alterna entre `Fact-` e `FAC-` conforme o caminho de código; `pdfGenerator` e o recibo tratam os dois de forma diferente e produzem **números de recibo diferentes para o mesmo documento** (§6.10/J‑04).

### 5.9 Histórico e relatório do dia (2180‑2870)

- **5.9.1** O relatório de fecho **exclui** canceladas (`:2531`) e **trata** `'Múltiplo'` pelo `paymentBreakdown` (`:2563‑2575`) — a 1.ª passagem errou nos dois pontos. O que continua errado é o **filtro de datas** (`isDateInRange` por prefixo ISO, C‑01) e a ausência de IVA.
- **5.9.2** Métodos não previstos na cadeia de `if/else` (`'POS'`, `'e‑Mola'` com grafias alternativas, `'Cheque'`) caem todos em `else → totalNumerario` (`:2576`), somando-se ao numerário sem aviso.
- **5.9.3** O relatório usa `.toLocaleString()` sem locale em 18 sítios (§6.15/O‑01), incluindo o total geral: o mesmo dia pode imprimir `12,345.5` na tabela e `12.345,50` no cabeçalho, conforme o browser.

### 5.10 Vendas antigas (4080‑4559) — P0

- **5.10.1** O formulário permite indicar data, hora, cliente, artigos e **número de recibo manual**. O `id` é `sale-retro-${Date.now()}` e a data é a indicada — mas o `invoiceNumber` continua a vir do `sequenceHelper` com o **ano actual**, não o da data indicada. Uma venda de 2024 passa a `Fact-2026-N`.
- **5.10.2** Não há verificação de duplicação do `manualReceiptReference`: o mesmo recibo em papel pode ser lançado duas vezes, duas vendas, dois débitos de stock.
- **5.10.3** A venda antiga **deduz stock** (`addSaleWithStockDeduction`) de um stock que já não reflecte essa venda histórica (o stock actual já foi ajustado por contagens físicas). Ou seja, lançar uma venda de há dois meses **estraga o stock de hoje**.
- **5.10.4** O estado da venda antiga é `'Paga'` fixo, independentemente de o recibo em papel dizer "a crédito".

---

## 6. Catálogo de defeitos (verificado ponto por ponto)

**Nota de método.** Todos os achados abaixo foram reabertos no código nesta passagem. Onde a 1.ª passagem estava errada, a correcção é explícita (§2.1 e o quadro abaixo) — porque uma auditoria que mantém acusações falsas perde toda a credibilidade, incluindo a das acusações verdadeiras.

As etiquetas de gravidade são as de §0. A coluna "Prova" é sempre `ficheiro:linha` do commit auditado.

### O que foi retirado da 1.ª passagem (por não se confirmar)

| Afirmação anterior | Porque não se sustenta |
|---|---|
| "Não há transacções: a venda e o stock gravam-se em escritas independentes" | `addSaleWithStockDeduction` usa `writeBatch` + `increment` (`firebaseDB.ts:778‑834`). O problema está **fora** do batch (§2.1) |
| "Cancelar não repõe stock" | `cancelSaleWithStockRestoration` repõe no mesmo batch (`:836‑880`). O defeito real é a dependência da configuração actual do produto (D‑04) |
| "O pagamento múltiplo colapsa tudo em numerário" | `paymentBreakdown` é gravado (`PDVModule.tsx:1327‑1344`) e o relatório itera sobre ele (`:2563‑2575`). O defeito real é não validar a soma (D‑06) |
| "Não há tecto de stock no carrinho / vende 999 de 3" | `addToCart` e `updateCartQty` validam por unidade (`:1057‑1085`, `:1160‑1180`). O defeito real é validarem contra cache (F‑04) e o stock poder ficar negativo em multi-terminal (F‑03) |
| "Quantidades `NaN` propagam-se ao total" | `updateCartQty('')` grava `quantity: ''` com `totalPrice: 0`; não há NaN. O defeito é a linha a 0 MT (K‑02) |
| "O relatório do dia soma canceladas" | `salesOnDate` exclui `Cancelada` (`:2531`). Quem soma canceladas é o módulo financeiro (N‑05) |

Estas seis correcções não diminuem a gravidade global: deslocam-na de "código mal escrito" para "código bem escrito a resolver o problema errado" — mais difícil de detectar e mais caro de corrigir.

---

### A. Motor de venda, persistência e numeração interna

**A‑01 · P1 · `addSale` (caminhos secundários) sem batch**
O núcleo da venda é atómico (§2.1), mas `addSale` (`firebaseDB.ts:770`) — usado no **restauro de fatura** e nas vendas retroactivas **sem** dedução — é um upsert simples. O restauro encadeia `addSale` + `saveProducts` (`FaturasModule.tsx:334+`) em duas chamadas: se a segunda falhar, a fatura volta a "Pendente" e o stock **não** foi deduzido. A venda fica válida e a mercadoria sai sem baixa.

**A‑02 · P1 · `merge: true` na gravação da venda**
`batch.set(doc(db,'sales',saleId), sanitizedSale, { merge: true })`. Como o objecto é completo, o merge só tem efeito em **retry** sobre um documento existente: campos que a nova versão não traz (`cancelReason`, `paymentBreakdown`, `manualReceiptReference`) **persistem**. Um retry sobre uma venda cancelada pode ressuscitar o motivo de anulação. Não há `version` nem comparação de `updatedAt`.

**A‑03 · P1 · `id = 'sale-' + Date.now()`**
`:1332` (e `:327` para retroactivas). Dois terminais a finalizar no mesmo milissegundo geram o mesmo `id`; com `merge: true`, a segunda venda **sobrescreve** a primeira — e o stock foi deduzido duas vezes. É improvável, mas o desenho não tem nada que o impeça: nem UUID, nem id atribuído pelo servidor.

**A‑04 · P1 · `increment` sem pré‑condição: stock negativo escrito com sucesso**
`increment(-qty)` é a técnica correcta contra lost updates, mas não há guarda: nada verifica que existem unidades antes de subtrair, e o Firestore não tem `CHECK`. O resultado é consistente e errado — `stockQty: -7` gravado, sem alerta. Ver F‑03.

**A‑05 · P1 · Falha de auditoria é silenciosa**
Todas as chamadas `dbService.addAuditLog(...)` são `void` ou `.catch(console.warn)`. Se `audit_logs` falhar (quota, permissões, rede), o sistema continua a vender **sem qualquer rasto**. A auditoria é opcional por desenho, o que a torna inútil como prova.

**A‑06 · P1 · `getSales()` completo em cada venda**
Para numerar, `const existingSales = await dbService.getSales()` (`:1321`) lê **toda a colecção de vendas** antes de gravar. Com 20.000 vendas são 20.000 leituras por venda, e o número continua a ser calculado no cliente (B‑01). A numeração devia ser um contador transaccional: 1 leitura, 1 escrita.

**A‑07 · P2 · Batch sem tratamento do limite de 500 operações**
`writeBatch` falha acima de 500 escritas. Uma venda grossista com mais de ~499 linhas falha inteira, com mensagem genérica ao operador. Não há `chunk()` nem validação prévia do tamanho.

**A‑08 · P2 · `getProducts()` completo dentro de cada venda**
Para preencher `costPrice`, a função lê toda a colecção de produtos a cada venda (`:797`), num total de 2.000 leituras por venda num catálogo médio. O custo já está no produto que o carrinho tinha em memória.

### B. Numeração fiscal

**B‑01 · P0 · Numeração `max + 1` no cliente**
`generateNextInvoiceNumber` percorre a lista de vendas recebida, extrai o maior número e soma 1. Sem transacção, sem reserva, sem contador: dois caixas emitem o mesmo `FAC-2026-0118`; um erro de rede faz recuar o contador; e como a lista vem de `getSales()` (A‑06), o "máximo" depende do que o terminal conseguiu ler. Não existe autoridade de numeração.

**B‑02 · P1 · Número de recibo fabricado quando falta**
Quando `receiptNumber` é `undefined` — o que acontece em todas as vendas A4/Pendente, porque `receiptNum` só é gerado para `'Paga'`, `'ReciboA4'` e `'Thermal'` (`:1323‑1325`) — o impresso **inventa** um: `invoiceNumber.replace('FAC-','REC-POS-')` (`:3714`) ou `Rec-2026-${invoiceNumber}` (`:3178`). O papel passa a ter um recibo com número que não existe em nenhuma tabela. Num caso de inspecção, o documento não é rastreável.

**B‑03 · P1 · Ano do documento = ano do relógio do terminal**
`const currentYear = new Date().getFullYear()` (`:11`, `:53`). Uma venda retroactiva de 2025 emitida hoje recebe `FAC-2026-…` (ver H‑01); um terminal com relógio atrasado emite `FAC-2025-…` em 2026. O ano fiscal do documento não é o da venda.

**B‑04 · P1 · Sem controlo de lacunas nem de duplicados**
Nenhuma rotina valida a sequência emitida. Uma fatura que falhou a gravação (número consumido, documento inexistente) ou um número repetido (B‑01) só se descobrem por inspecção manual. Não há relatório de integridade de numeração — o mínimo exigível a um sistema de faturação.

**B‑05 · P2 · Sem série nem terminal no número**
A numeração é global e anónima (`FAC-2026-0118`). Não é possível saber que caixa emitiu, nem emitir séries distintas por ponto de venda — requisito habitual em multi‑caixa e em caso de auditoria.

### C. Datas e fusos horários

**C‑01 · P0 · Venda depois da meia‑noite conta para o dia anterior**
`date` é gravado em UTC (`new Date().toISOString()`), mas os relatórios filtram por prefixo de string local (`dateRangeHelper.ts:39‑45`, `:112‑136`). Em `Africa/Maputo` (UTC+2), uma venda às 00:30 de 09/11 é gravada `2026-11-08T22:30:00.000Z` → entra no dia **08/11**. O recibo, formatado com `toLocaleString('pt-MZ')`, diz **09/11**.
**Prova:** `TZ=Africa/Maputo node -e "console.log(new Date('2026-11-09T00:30:00+02:00').toISOString())"` → `2026-11-08T22:30:00.000Z`.

**C‑02 · P1 · O erro de fuso está também na consulta**
`getInclusiveDateBounds` devolve `start = 'YYYY-MM-DD'` e `end = 'YYYY-MM-DDT23:59:59.999Z'`. As vendas entre 22:00 e 23:59 UTC (00:00–01:59 locais) do dia seguinte satisfazem o limite superior do dia anterior e **não** satisfazem o inferior do próprio dia. Corrigir o React sem corrigir estes limites deixa o erro na base de dados.

**C‑03 · P1 · O relógio do terminal é autoridade absoluta**
Nada valida o desvio de hora. Um PC com três horas de atraso grava datas erradas, numera no ano errado (B‑03) e pode gerar `id` (`Date.now()`) já existentes (A‑03).

**C‑04 · P2 · Formatos de data misturados**
`toLocaleDateString()` sem locale, `'pt-MZ'`, `'pt-PT'` e ISO coexistem no mesmo ecrã. Ver O‑01/O‑02.

### D. Estados da venda e do pagamento

**D‑01 · P0 · O formato do papel define o estado do pagamento**
```ts
const effectiveDocType = printFormat === 'FaturaProforma' ? 'FaturaProforma' : 'FaturaDefinitiva';
let finalStatus = 'Paga';
if (effectiveDocType === 'FaturaProforma' || printFormat === 'A4') finalStatus = 'Pendente';
else if (paymentMethod === 'Crédito') finalStatus = 'Crédito';
```
**Toda a venda impressa em A4 fica `Pendente`, mesmo paga em dinheiro.** O operador que escolhe "Fatura A4" para o cliente empresarial cria uma dívida inexistente de cada vez; o KPI "Pendente" e o mapa de dívidas ficam permanentemente inflacionados, e o gestor deixa de confiar no indicador.

**D‑02 · P0 · Proforma entra como dívida**
`FaturaProforma` → `'Pendente'`. Uma proforma é uma cotação: não é dívida, não é receita, não deve entrar em "a receber". Fica no mesmo balde das faturas por cobrar e é somada ao KPI "Pendente (Crédito)" de `FaturasModule.tsx:627‑640`.

**D‑03 · P0 · `'Crédito'` é apresentado como CANCELADA e não tem saída**
`{sale.status === 'Paga' ? 'PAGA' : sale.status === 'Pendente' ? 'PENDENTE' : 'CANCELADA'}` — qualquer outro estado, incluindo `'Crédito'` (que o tipo admite, `types.ts:65`), é pintado a vermelho como **CANCELADA**. Pior: o botão "Pagar" só existe para `status === 'Pendente'` (`:773`) e o "Restaurar" para `'Cancelada'`. Uma venda a crédito fica **visualmente anulada, sem forma de a liquidar** — e o dinheiro é devido.

**D‑04 · P1 · O estorno usa a configuração actual do produto**
`:288‑295` recalcula `hasConversion` e `conversionRate` a partir do produto **como está hoje**. Três falhas silenciosas: (a) se a conversão mudou, repõe quantidade diferente da deduzida; (b) se o produto foi apagado, `if (!prod) continue` **salta o estorno sem aviso** e a venda é cancelada na mesma; (c) não há nota de crédito (E‑06). O estorno tem de usar os valores gravados no item da venda.

**D‑05 · P2 · Restaurar converte uma venda paga em dívida**
O restauro grava sempre `status: 'Pendente'` (`:340`). Uma venda `Paga` que foi cancelada por engano e restaurada passa a dívida, porque o estado anterior não é guardado.

**D‑06 · P0 · As parcelas do pagamento múltiplo não são validadas**
A interface mostra `Digitado / Falta / Excesso` (`:2374‑2384`), mas `handleFinalizeSale` **não verifica** que a soma das parcelas iguala o total: `activeBreakdown` é apenas `multiPaymentLines.filter(l => l.amount > 0)` (`:1327`). É possível gravar uma venda de 1.000 MT com 600 MT digitados, e ela fica `Paga`. O `Falta: 400 MT` em laranja é decorativo. O valor entregue e o troco também não são gravados (`Sale` não tem `amountReceived` nem `change`), pelo que não há como reconstruir depois o que o cliente pagou.

**D‑07 · P1 · Não há separador para vendas a crédito**
Os filtros são `Todas | Pendente | Paga | Cancelada` (`:690`). `'Crédito'` não tem aba, não tem contagem e não é filtrável — combinado com D‑03, é um estado invisível que só se encontra por acaso na lista "Todas".

### E. IVA e documentos fiscais

**E‑01 · P0 · O PDF não tem IVA — e o ecrã diz que tem, ao contrário**
O PDV tem um toggle `IVA: 16% / NÃO` (`:2287`), com `includeIva` e `ivaAmount` gravados na venda (`:1350‑1351`). Mas `pdfGenerator.ts` — o gerador dos documentos que o cliente leva — **ignora os dois campos**: não há uma única referência a `includeIva`/`ivaAmount` no ficheiro (verificado). O PDF mostra Subtotal, Desconto, Total. Enquanto isso, o talão/modal mostra `IVA INCLUÍDO (16%)` (`:3378`) quando na realidade o IVA foi **somado** (`getTotal = base × 1.16`, `:1232`): o rótulo contradiz a matemática. E como o toggle começa em `false` (`:120`), a maioria das vendas sai simplesmente sem IVA.

**E‑02 · P1 · IVA é um interruptor por venda, não uma taxa por produto**
Não existe `taxRate` em `Product` nem em `SaleItem`. O IVA é ligado à mão, venda a venda, e aplica‑se ao total. Consequências: (a) o mesmo produto pode sair com e sem IVA no mesmo dia; (b) não é possível ter taxas diferentes (16 % e isento) na mesma fatura; (c) a base tributável por linha não existe, pelo que nem retroactivamente se reconstrói a declaração.

**E‑03 · P1 · NUIT e nome da empresa hardcoded no fallback**
`settings || { companyName: 'AGRO - XICOMO & SERVIÇOS, LDA', companyNuit: '401976590' }`. Se `getSettings()` falhar (rede, primeira utilização), os documentos saem com o NUIT fixo do código. Se a empresa mudar de NUIT, os documentos continuam a sair com o antigo sem qualquer aviso.

**E‑04 · P1 · "Prova oficial de liquidação total" impressa em todos os recibos**
A frase é fixa (`:610`), independentemente do estado. Um recibo de uma venda a crédito, `Pendente` ou proforma declara no papel que está totalmente liquidada. É o tipo de afirmação que um cliente usa contra a empresa.

**E‑05 · P1 · Quatro grafias de recibo para o mesmo documento**
`receiptNumber` real (`REC-POS-2026-0007` / `REC-A4-2026-0007`) vs `invoiceNumber.replace('FAC-','REC-A4-')` (`:3178`) vs `.replace('FAC-','REC-POS-')` (`:3714`) vs `Rec-2026-${invoiceNumber}` (`:3178`, terceiro ramo). Dependendo do ecrã, o mesmo recibo aparece com quatro números diferentes.

**E‑06 · P2 · Não existe nota de crédito**
Cancelar altera um `status`; não emite documento de rectificação. O cliente fica com a fatura original válida e sem prova do cancelamento. O mesmo para devoluções parciais.

### F. Stock

**F‑01 · P0 · A reconciliação de stock é estruturalmente falsa**
```ts
const recordedStock = prod.stockQty;
const difference = 0; // Synchronized baseline
items.push({ recordedStock, calculatedStock: recordedStock, difference, … });
```
`calculatedStock` é **copiado** de `recordedStock` e `difference` é literalmente `0`. Por construção, `status` é sempre `'Sincronizado'` e `discrepancies` está sempre vazio. O relatório que o gestor usa para detectar faltas e furtos **não pode** detectar nada — e o cálculo de vendas, perdas e transformações que o antecede é código morto.

**F‑02 · P0 · `buyPrice`/`sellPrice` não existem: valores a 0 MT e crash no PDF**
`Product` tem `buyingPrice`/`sellingPrice` (`types.ts`), mas `StockModule` usa `p.buyPrice`/`p.sellPrice` (`:231`, `:2477`, `:2480`, `:2487‑2488`). Resultado: valor total do inventário = **0 MT**; valor das quebras = **0 MT**; e no PDF de inventário `i.buyPrice.toLocaleString()` (`:2726`) é chamado sobre `undefined` → **TypeError**, exportação falha.

**F‑03 · P0 · Stock negativo aceite e gravado**
A validação de disponibilidade existe **só no cliente**, contra a lista em memória (`addToCart`, `updateCartQty`). No momento da escrita, `increment(-qty)` aplica‑se sem pré‑condição: dois terminais que leram "3" vendem ambos, e o stock fica `-7` gravado com sucesso. Todos os relatórios, valorizações e alertas passam a trabalhar com um número impossível.

**F‑04 · P1 · Validação de stock contra cache, não contra a base**
`addToCart` (`:1057`) e `updateCartQty` (`:1160`) comparam com `product.stockQty` do array em memória. Sem `onSnapshot` activo para stock, um carrinho aberto há 20 minutos valida contra quantidades que já não existem. A mensagem de erro é boa; o dado em que se baseia não é.

**F‑05 · P1 · Não existe livro de movimentos de stock**
`stockQty` é um saldo sem extracto. Vendas, quebras (`losses`), contagens físicas e transformações alteram o número sem deixar rasto de «quem, quando, porquê, quanto». Quando o stock não bate certo, é **impossível** reconstruir a causa — e F‑01 garante que também não há desvio a investigar.

**F‑06 · P1 · Quebras geradas com custo `undefined`**
Na contagem física, `const lossVal = missingQty * (prod.buyPrice || 0)` (`:231`) → **0 MT** para qualquer perda. O relatório de quebras do período é zero, mesmo quando desapareceram 500 unidades. Combinado com F‑01, o gestor não tem nenhum sinal de perda.

**F‑07 · P2 · `saveProducts` com o catálogo completo em memória**
"Regenerar referências" (`:360‑377`) e o reset de catálogo escrevem **todos** os produtos com o array que o terminal tem. Um terminal que não sincronizou há dez minutos **reverte stock e preços de todo o catálogo**. Uma operação cosmética é um risco de perda de dados global.

**F‑08 · P2 · Migração de stock corre uma vez por browser**
O flag está em `localStorage`; noutro browser a migração volta a correr e sobrepõe stock real com valores de semente. Com vários terminais, cada um migra à sua maneira.

### F2. Unidades híbridas (Retalho/Atacado)

**F2‑01 · P0 · Ternário morto: o atacado nunca é a unidade por omissão**
```ts
const selectedUnit = preferredUnit || (hasConversion ? 'Retail' : 'Retail');
```
Os dois ramos são `'Retail'`. Para um híbrido (saco de 25 kg a 1.200 MT, ou 60 MT/kg), o cartão do catálogo mostra o preço de **atacado** (`:1945‑1950`, quando `parentUnit === 'Sacos'`), mas o "Adicionar" insere **retalho**: o cartão diz 1.200, o carrinho cobra 1.500. O cliente paga 300 MT a mais — ou, se o operador corrigir à mão, paga 300 a menos e consome o stock errado.

**F2‑02 · P0 · Disponibilidade decidida por `stockQty`**
O badge "Sem stock" (`:1893`) e o botão "Adicionar" (`:2010`) usam `prod.stockQty`. Um híbrido com `stockQty: 0` e `stockQtyRetail: 40` aparece **esgotado**; um com `stockQty: 50` e `stockQtyRetail: 0` aparece **disponível**. Nenhum ecrã do catálogo olha para os campos por unidade que o próprio `addToCart` valida.

**F2‑03 · P1 · `stockQty` total e stock por unidade podem divergir**
A dedução de atacado faz `stockQtyBulk -= n` e `stockQty -= n × rate`; a de retalho faz `stockQtyRetail -= n` e `stockQty -= n`. Como nada mantém `stockQty = stockQtyBulk × rate + stockQtyRetail`, qualquer venda em atacado deixa a composição inconsistente com o total. O total continua a ser usado no catálogo (F2‑02) e nas valorizações.

**F2‑04 · P1 · Conversão implementada em dois sítios**
`PDVModule.tsx:1360‑1372` converte `qty × conversionRate` para a dedução; `deductProductStock`/`addSaleWithStockDeduction` decide o campo e a quantidade outra vez. As duas lógicas não partilham função nem testes: qualquer alteração numa delas cria divergência sistemática entre o que foi vendido e o que foi deduzido.

### G. Vendas pausadas

**G‑01 · P0 · O rascunho recuperado nunca é apagado → venda duplicada**
`restoreActiveCart` (`:137‑147`) faz `setSavedActiveCart(null)` mas **não** chama `dbService.clearActiveCart()`. `clearCompletedCheckout` (`:1278‑1287`) também não. O rascunho continua em `localStorage` (`agro_active_cart`, `firebaseDB.ts:1669`). Ao recarregar a página, `loadPDVData` volta a ler o mesmo rascunho e o banner reaparece (`:1789`); o operador recupera e finaliza **a mesma venda outra vez**. Repetível até o operador usar "Descartar" (`:149`, o único caminho que limpa).

**G‑02 · P1 · `PausedSale` incompleto e chave única**
Sem operador, sem terminal, sem `createdAt` fiável, sem `paymentBreakdown`, sem parcelas. E `saveActiveCart` grava numa **única** chave `agro_active_cart` (`firebaseDB.ts:1669`): a segunda pausa **sobrescreve** a primeira, sem aviso. Duas vendas pausadas no mesmo dia = uma perdida.

**G‑03 · P1 · Recuperar não revalida preços nem stock**
O carrinho volta exactamente como estava: preços da altura da pausa, quantidades que podem já ter sido vendidas. `restoreActiveCart` não consulta produtos nem recalcula preços; a validação de stock só ocorre se o operador mexer na linha.

**G‑04 · P2 · Sem expiração**
Um rascunho de Agosto pode ser recuperado em Dezembro com preços de Agosto. Não há `createdAt` comparado nem aviso de idade.

### H. Vendas antigas / retroactivas

**H‑01 · P0 · Venda antiga destrói o stock de hoje**
O formulário grava `date: saleDateISO` (histórica) mas, com "deduzir stock" ligado (`:350`), chama `addSaleWithStockDeduction` — que **subtrai agora** ao stock actual. O stock já foi ajustado por contagens físicas desde a data da venda; lançar um recibo de 2025 cria uma falta que não existe na prateleira. A dedução devia ser opcional por omissão **desligada** e assinalada como ajuste de inventário, não como movimento.

**H‑02 · P0 · Sem controlo de duplicados do recibo manual**
`manualReceiptReference` é gravado (`:330`) mas não é indexado, nem pesquisado, nem comparado. O mesmo recibo em papel pode ser lançado N vezes; cada lançamento cria uma venda, soma facturação e deduz stock. Não há aviso, nem relatório de sobreposição.

**H‑03 · P1 · Estado fixo `'Paga'`**
Toda a venda antiga é gravada como paga (`:340`), independentemente de o recibo em papel dizer "a crédito". A dívida antiga nunca aparece em lado nenhum, e o mapa de clientes fica incompleto.

**H‑04 · P1 · Auditoria insuficiente para um lançamento manual**
O `notes` guarda o número do recibo (`:347`), mas não há imagem/anexo do original, nem campo de autorizador, nem motivo. Um lançamento retroactivo é a operação com maior potencial de fraude do sistema e é a que tem menos rasto.

**H‑05 · P2 · Datas futuras aceites**
Nada impede lançar uma venda com data de amanhã, que apareceria em relatórios futuros e alteraria a numeração do período seguinte.

### I. Sessão e multi-terminal

**I‑01 · P2 · Sem bloqueio por inactividade**
Não há temporizador de sessão. Um terminal no balcão fica aberto com o perfil que estiver activo — incluindo `Técnico` — até alguém clicar em "Sair". Num balcão com público, é o suficiente para um cliente tocar no ecrã.

**I‑02 · P2 · Duas abas do mesmo browser partilham o rascunho**
`agro_active_cart` é uma chave global de `localStorage`. Duas abas abertas no mesmo PC escrevem e lêem o mesmo rascunho: um operador que pause na aba A vê o carrinho aparecer na aba B.

### J. Impressão e documentos

**J‑01 · P0 · O fallback de impressão imprime uma página em branco**
Quando a impressora série está ligada mas falha, o código faz `setInvoiceToPrint(null)` (`:1429`) e, 500 ms depois, `window.print()` (`:1433`). O CSS global esconde tudo excepto os ids listados (`index.css:44‑47`), e `#thermal_receipt_80` (`:3691`) só renderiza conteúdo **se `invoiceToPrint` existir** — que é `null`. Resultado garantido: diálogo de impressão aberto, folha em branco. O operador conclui que a impressora avariou.

**J‑02 · P0 · `@page { size: 80mm auto }` é global**
`index.css:33‑37` define a caixa de página em 80 mm para **toda** a impressão do browser. A fatura A4 tem `max-width: 195mm` (`:51`) e é **cortada** à direita: perdem‑se totais, NUIT e assinaturas. Quem usar Ctrl+P numa fatura recebe um documento truncado, e o sistema não avisa que o formato é outro.

**J‑03 · P1 · Lista de ids visíveis incompleta**
O CSS torna visíveis `#a4_invoice`, `#thermal_receipt`, `#double_a5`, `#a4_receipt`, `#thermal_receipt_80` — mas `FaturasModule.tsx:1333` usa **`#double_a5_invoice`**, que não está na lista. Imprimir o A5 a partir de Faturas dá página em branco (mesmo mecanismo de J‑01). Cada documento novo obriga a editar CSS.

**J‑04 · P1 · O documento é gerado do estado React, não da base**
`invoiceToPrint` é o objecto que estava em memória quando se clicou. Não há releitura, nem verificação de que a venda ainda existe, nem de que não foi cancelada. Reimprimir é possível a partir de dados que já não são verdade; e o inverso também: o PDF descarregado antes do cancelamento continua válido aos olhos de terceiros.

**J‑05 · P1 · "Pré‑visualização" descarrega um ficheiro**
O ramo final de `handleFinalizeSale` chama `downloadInvoicePDF(newSale, printFormat)` e **depois** abre o modal. `downloadInvoicePDF` (`:1252`) descarrega um PDF. Cada venda deixa um ficheiro na pasta Downloads do operador (200 vendas/dia = 200 PDFs), além do modal que o utilizador pediu.

**J‑06 · P1 · Rodapé de liquidação fixo** — ver E‑04. É um documento assinado a afirmar o que pode ser falso.

**J‑07 · P1 · Os três formatos não mostram IVA**
A4, A5 e térmico partilham o mesmo gerador que ignora `includeIva`/`ivaAmount` (E‑01). O único sítio onde o IVA aparece é o modal HTML (`:3378`), que não é o documento entregue.

**J‑08 · P2 · Sem `settings`, o cabeçalho sai com dados fixos**
Nome, NUIT e telefones vêm do fallback hardcoded. Se `logoUrl` falhar (URL externa), o cabeçalho perde a imagem sem aviso.

### K. Interface, validações e feedback

**K‑01 · P0 · `confirm`/`prompt`/`alert` em acções destrutivas**
O próprio código documenta que estes diálogos são bloqueados em iframes (`PDVModule.tsx:95`, `FaturasModule.tsx:47`) e implementa modais próprios — mas **não em todos os sítios**: `StockModule.tsx:362, 384, 1447`, `TechnicalModule.tsx:273, 295, 924, 955, 983, 1005`, `HRModule.tsx:420`, `EmployeeDetailModal.tsx:172, 474`. Nesses, `confirm()` devolve `false` **sem mostrar nada**: o utilizador clica "Zerar Sistema", não acontece nada, e conclui que o botão está avariado. Em `StockModule:1447` a palavra‑passe de stock é pedida por `prompt()`: sem diálogo, devolve `null` e a operação aborta em silêncio.
O inverso é igualmente grave: onde `confirm()` funciona, apagar toda a base depende de um clique num diálogo nativo **sem autenticação**.

**K‑02 · P1 · Linha com quantidade vazia entra na venda a 0 MT**
`updateCartQty('')` guarda `quantity: '' as any` e `totalPrice: 0` (`:1140‑1148`). O `''` propaga‑se até `finalizedItems`: a venda é gravada com `quantity: ''` (string num campo numérico), total 0, e a linha aparece no documento. Só o `onBlur` repõe 1 — quem clicar em "Finalizar" com o campo vazio e sem blur grava o item a zero.

**K‑03 · P1 · Desconto sem limite nem autorização**
`customSubtotalDiscount` e os descontos por linha somam‑se sem verificação: um desconto de 150 % produz total negativo, limitado apenas por `Math.max(0, …)` em `getTotal` (`:1231`) — o total fica 0 mas a venda é gravada. Não há perfil de autorização nem registo de quem autorizou.

**K‑04 · P1 · Erros escondidos em toasts de 3 segundos**
`showToast` limpa a mensagem após 3 s (`:757`) e não há registo. Uma falha de gravação fica só na consola do browser; num balcão, ninguém a lê.

**K‑05 · P2 · O `onBlur` altera a quantidade sem avisar**
Se o campo ficar vazio, o blur repõe **1** (não a quantidade anterior). O operador que apaga o campo para escrever 10 e clica fora vê‑se com 1 unidade no carrinho e o total a mudar sozinho.

**K‑06 · P2 · Cores de estado ambíguas**
`'Crédito'` a vermelho "CANCELADA" (D‑03), `'Pendente'` amarelo, `'Paga'` verde. Não há legenda e o vermelho é usado para duas coisas diferentes (cancelada e a receber).

**K‑07 · P2 · Sem indicador de offline**
O PDV depende de Firestore; com a rede em baixo, o operador só descobre ao finalizar a venda. Não há estado de ligação, nem fila local, nem aviso preventivo.

**K‑08 · P3 · `key={index}` em listas editáveis**
Em listas do carrinho, alterar a ordem pode fazer o React reutilizar o input errado e trocar quantidades entre linhas.

### L. Segurança e controlo de acesso

**L‑01 · P0 · Chave mestra hardcoded no bundle**
```ts
if ((lower === 'mazive' || lower === 'admin') &&
    (cleanPass === '0147' || cleanPass === 'admin' || cleanPass === '05082')) { … role: 'Técnico' … }
```
Entra como **Técnico**, com acesso a finanças, RH e "Zerar Sistema". O mesmo trio aparece em `App.tsx:251`, `App.tsx:397`, `StockModule.tsx:165/167/207/209/1446‑1448/1578‑1579`, `FaturasModule.tsx:273‑274` e nas sementes de `firebaseDB.ts:1236/1305` e `indexedDB.ts:1137/1189/1218/1325`. **14 sítios, 3 palavras‑passe.** Qualquer utilizador as lê no DevTools.

**L‑02 · P0 · A palavra‑passe mestra está documentada no ecrã**
O "esquema SQL" mostra `INSERT INTO credentials … VALUES ('usr-mazive','Mazive','0147',…)` (`:24‑27`), visível no Painel Técnico. O backdoor está documentado dentro do produto, para quem chegar ao painel.

**L‑03 · P0 · Regras Firestore abertas**
`match /{document=**} { allow read, write: if true; }`. Com a configuração web no bundle (`firebase-applet-config.json`), qualquer pessoa na Internet lê e escreve **todas** as vendas, salários e credenciais. O login da aplicação é irrelevante: a base está pública.

**L‑04 · P0 · API de backup/sync sem autenticação**
`GET /api/backup` (lista e serve dumps), `GET /api/backup/download/:file`, `POST /api/sync/save`, `POST /api/sync/delete` — sem token, sem CORS restrito, com `express.json({limit:'50mb'})` (`:103`). O rate limit existe apenas no POST de backup, em memória, por IP. Quem alcançar a porta exfiltra ou apaga a base inteira.

**L‑05 · P1 · Os IPs da auditoria são inventados**
`const ipAddress = '197.218.10.' + Math.floor(Math.random() * 254 + 1)` (`:161`, `:323`, `:348`); no PDV é `'127.0.0.1'` fixo (`:1389`); em `applyNewPassword`, idem. A coluna "IP" de toda a auditoria é ficção — e a auditoria é apresentada como prova.

**L‑06 · P1 · Salários expostos a qualquer perfil**
A pesquisa global (`App.tsx:653`) carrega produtos, funcionários, vendas e clientes e mostra `detail: 'Salário: N MT'` (`:158`). Um Operador de Caixa vê o salário do gerente escrevendo três letras. Não há verificação de perfil em nenhum ponto do componente.

**L‑07 · P1 · Autorização só no cliente**
`isModuleAccessible` esconde botões; as funções `dbService.*` não recebem utilizador nem validam nada. Chamar `dbService.clearSystemData()` na consola é possível em qualquer sessão. Combinado com L‑03, não há sequer uma barreira de base de dados.

**L‑08 · P1 · Política de palavras‑passe fraca**
4–6 caracteres, letras e números, sem histórico, sem expiração, reutilização permitida (o próprio comentário o diz). O bloqueio por tentativas é por **browser** (`localStorage`): limpar o storage repõe as 5 tentativas.

**L‑09 · P1 · Alias de conta `ainira`/`ainara`**
Dois nomes de utilizador autenticam a mesma conta. Duas pessoas partilham identidade sem que a auditoria o mostre; um erro de escrita entra na conta de outra pessoa.

**L‑10 · P1 · Credenciais de fábrica no bundle**
`OFFICIAL_BACKUP_CREDS`: se o Firestore falhar, o login usa uma lista hardcoded com hashes conhecidos. Basta derrubar a rede (ou esperar que ela caia) para usar as credenciais de fábrica.

**L‑11 · P1 · Restauro de backup sem autenticação nem validação**
`importAllData` a partir de ficheiro ou de `localStorage` (`:1828`, `:1874`), sem confirmação forte, sem validação de schema, sem dry‑run. Um JSON malformado deixa a base num estado misto: colecções novas ao lado de antigas.

**L‑12 · P2 · Sessões activas não são validadas**
`active_sessions` é informativo. Terminar sessão num terminal não invalida a sessão no outro, e não há verificação no arranque.

### M. Servidor, API e integrações

**M‑01 · P0 · `/api/gemini/*` não existe**
`StockAIEntry.tsx:122` e `TechnicalModule.tsx:740` fazem `fetch` a `/api/gemini/technician-ai`; `server.ts` não tem qualquer rota `/api/gemini`. Resultado: 404 em todos os ambientes, botão de IA morto, erro genérico no ecrã. A funcionalidade é apresentada ao utilizador como disponível.

**M‑02 · P0 · O canal "tempo real" nunca existiu**
`new EventSource('/api/sync/events')` (`:367`) aponta para uma rota que `server.ts` não regista. Não há SSE, não há push: dois caixas não vêem as vendas um do outro até recarregar a página. Toda a camada `indexedDB.ts` (1.993 linhas) é código morto que aparenta estar activo.

**M‑03 · P1 · Backups no filesystem efémero**
Os dumps vão para `backups/` no servidor. Num deploy em contentor/preview desaparecem com o redeploy. O "backup automático" (`firebaseDB.ts:1506‑1545`) grava no `localStorage` do browser — não é backup, é cache, e perde‑se ao limpar dados de navegação.

**M‑04 · P1 · Rate limit em memória e parcial**
`Map` em memória → reinicia com o processo; atrás de proxy todos partilham o IP; cobre apenas o POST de backup e não `/api/sync/*`.

**M‑05 · P1 · Stack traces nas respostas de erro**
Vários handlers devolvem `err.message` (e em alguns casos a stack) ao cliente, expondo caminhos e versões.

**M‑06 · P2 · CSP permissiva**
`unsafe-inline`, `unsafe-eval` e o domínio do preview (`:94‑102`). Adequado a desenvolvimento; em produção anula boa parte da protecção contra XSS.

### N. Financeiro e contabilidade (ligação ao PDV)

**N‑01 · P0 · O "Balancete de Verificação" é inventado**
```ts
{ code: '1.1.1.01', name: 'Caixa Geral (POS)', debit: reportGrossSales * 0.4, credit: totalCOGS * 0.2 },
{ code: '1.1.2.01', name: 'Bancos Moçambique C/C', debit: reportGrossSales * 0.6, … },
{ code: '2.1.1.01', name: 'Fornecedores de Insumos', debit: 0, credit: activeProductsVal * 0.5 },
{ code: '5.1.1.01', name: 'Capital Social Registado', debit: 0, credit: activeProductsVal * 0.5 },
```
40 %/60 % da facturação em caixa/banco, 50 % do stock como dívida a fornecedores e 50 % como capital social. **Nada vem de dados.** O PDF sai com linhas de assinatura do "Responsável de Contabilidade" e da "Direção Financeira" (`:483‑492`). É o achado mais grave do módulo financeiro: um documento com aparência oficial e conteúdo fabricado.

**N‑02 · P1 · CMV e quebras não medem o que dizem**
`totalCOGS = reportCost` depende do custo por item; e `totalQuebras = totalLossesVal * (reportSales.length / sales.length)` (`:498`) pro‑rateia as quebras pelo **número de vendas** do período — um factor sem qualquer relação com perdas. As quebras do balancete são um número arbitrário.

**N‑03 · P0 · Gráfico com barras fictícias**
Sem vendas, `heightPct = visualHeights[idx]` com `[25, 55, 35, 75, 100, 60, 30]` (`:1300‑1303`): uma curva de vendas plausível, a subir e a descer. O tooltip diz "Sem Vendas", mas o gráfico, à distância, **mostra vendas**. Um gestor que olhe para o dashboard decide com dados inventados.

**N‑04 · P1 · "Faturas Pendentes" mede o método, não o estado**
`sales.filter(s => s.paymentMethod.includes('crédit')).length` — conta vendas cujo **método** contém "crédito", incluindo as já liquidadas, e ignora as `Pendente` pagas em dinheiro. O KPI não mede dívida.

**N‑05 · P1 · Agregações ignoram o estado**
`getDailySales` (`:1264‑1290`), o donut por categoria (`:1340+`) e `totalCash` (`:243`) somam `sales` sem excluir `Cancelada`. Uma venda anulada continua a produzir receita no dashboard, ao contrário do relatório do PDV (que exclui canceladas, `:2531`). Dois ecrãs, dois totais.

**N‑06 · P1 · Não existe módulo de despesas**
Sem despesas, sem compras a fornecedores, sem salários no P&L (o RH paga por fora). O "resultado" é receita − CMV, que não é um resultado: é margem bruta. Apresentado como lucro, engana.

**N‑07 · P2 · CSV com locale do browser**
`toLocaleString()` sem locale gera vírgula decimal e vírgula separadora; o CSV fica impossível de abrir correctamente em Excel pt‑PT.

### O. Formatação numérica e i18n

**O‑01 · P1 · `toLocaleString()` sem locale em 18 sítios do PDV**
`:1489, 1945, 1947, 2138, 2142, 2300‑2310, 2379, 2425, 2461, 3070‑3103, 3236, 2885`; mais `FaturasModule.tsx:604, 615, 626, 637, 752` e `FinanceModule.tsx:518‑520, 553‑565`. O resultado depende do browser: `1,000.5` (en‑US) ou `1.000,5` (pt). No **mesmo** documento coexistem os dois formatos — cabeçalho com `'pt-MZ'`, tabela sem locale — e `:1448` interpola um total sem locale numa confirmação de venda.

**O‑02 · P2 · `'pt-PT'` e `'pt-MZ'` misturados**
Separadores e nomes de meses diferentes entre módulos, no mesmo produto.

**O‑03 · P2 · `numeroParaExtenso` incorrecto**
`1250` → "Um Mil e Duzentos e Cinquenta Meticais" (forma não usada: "mil duzentos e cinquenta"); `Math.round((valor-inteiro)*100)` pode dar 100 → "Cem Centavos"; valores ≥ 1.000.000.000 passam `milhoes > 999` a `converterGrupo`, cujo `CENTENAS[12]` é `undefined` → imprime "undefined" no documento.
---

## 7. Simulações numéricas (o que o sistema faz, com números)

As seis simulações seguintes usam apenas os caminhos de código documentados acima e os preços/stock das sementes de `firebaseDB.ts`. Nenhum valor é estimado.

### 7.1 Dia normal: 3 vendas, 3 documentos, 3 verdades

Dia 09/11. Operador: Ana. AGROPYRIFOS (venda 590 MT, compra 260 MT).

| Hora | Venda | Formato | Stock | Estado gravado | Caixa real |
|---|---|---|---|---|---|
| 09:12 | V1 — 2× AGROPYRIFOS = **1.180 MT**, dinheiro | A4 | −2 | **`Pendente`** | 1.180 MT |
| 10:40 | V2 — 1 saco de 25 kg, cliente pediu atacado, unidade não mudada | Térmico | −25 kg de retalho | `Paga` | 1.500 MT (25×60) |
| 11:55 | V3 — 3× AGROPYRIFOS = 1.770 MT: 1.000 numerário + 770 transferência | Térmico | −3 | `Paga` | 1.000 MT |

**O que o relatório do dia diz** (`handlePrintDailyReport`, que exclui canceladas em `:2531` e lê o `paymentBreakdown` em `:2563`):

- Total vendido: **4.450 MT** ✅
- Numerário: 1.180 + 1.500 + 1.000 = **3.680 MT** ✅
- Transferência: **770 MT** ✅
- A crédito: **0 MT** ✅

**O que os outros ecrãs dizem do mesmo dia:**
- Faturas: **1 fatura pendente (1.180 MT)** — mas V1 foi paga em dinheiro (D‑01).
- Finanças: lucro = 4.450 MT, CMV = 0 MT, quebras = 0 MT (F‑02, N‑02), IVA = 0 (E‑01).
- Stock: valor do inventário = **0 MT** (F‑02).

Ou seja: **o único ecrã que acerta no dinheiro é o relatório do PDV** — e só porque o `paymentBreakdown` foi implementado com cuidado. Tudo o que rodeia esse relatório (dívida, lucro, IVA, valor de stock) está errado no mesmo dia. A conclusão prática é desconfortável: o operador confia no fecho do PDV e o gestor decide com os outros números.

### 7.2 Pagamento múltiplo incompleto: 1.000 MT faturados, 600 cobrados

Venda de 1.000 MT, método "Múltiplo": o operador digita 600 no numerário e **esquece os 400** da transferência. O painel mostra `Falta: 400 MT` a laranja (`:2381`), mas o botão de finalizar **não está condicionado** — `handleFinalizeSale` não verifica nada (D‑06).

- Gravado: `total: 1000`, `paymentMethod: 'Múltiplo'`, `paymentBreakdown: [{method:'Dinheiro', amount:600}]`, `status: 'Paga'`.
- Fecho do dia: numerário 600 MT, transferência 0 MT — o relatório reflecte o que foi digitado, não o que era devido.
- Dívida do cliente: **400 MT que não existem em lado nenhum.** Não há registo de falta, nem aviso, nem pendente. O cliente saiu com a mercadoria e a fatura diz 1.000.
- Se o operador tivesse digitado 1.200 (excesso de 200), o `paymentBreakdown` somaria 1.200 e o fecho teria 200 MT a mais — o troco não é gravado (`Sale` sem `amountReceived`), pelo que o desvio só aparece na contagem física da gaveta.

O ecrã sabe que falta dinheiro (calcula `diff`), o sistema não. É a diferença entre uma interface informativa e um controlo.

### 7.3 A venda das 00:30

Venda de 2.300 MT às 00:30 de 09/11 (turno da noite).

- `date` gravado: `2026-11-08T22:30:00.000Z` (C‑01).
- Recibo térmico: formata com `toLocaleString('pt-MZ')` → **09/11 00:30**.
- Relatório diário: filtra `date.startsWith('2026-11-09')` → não encontra → a venda **não aparece**.
- Faturas (Firestore, `start='2026-11-09'`): não aparece.
- Faturas do dia 08/11: aparece, com data 08/11.
- Fecho de 08/11: +2.300 MT que não existiram naquele dia; fecho de 09/11: −2.300 MT.
- Se o cliente pedir segunda via em 09/11, o sistema procura em 09/11 e **não encontra** — a venda "desapareceu" do dia em que foi feita.

### 7.4 Venda híbrida a atacado (F2‑01 em números)

Produto: "Semente de Milho 25 kg", `parentUnit: 'Sacos'`, `conversionRate: 25`, `priceBulk: 1200`, `priceRetail: 60`, `stockQty: 10`, `stockQtyBulk: 10`.

1. Operador pesquisa "milho", vê o cartão com preço **1.200 MT** (`:1945‑1950`).
2. Clica "Adicionar". `addToCart` chama `resolveUnit`: `preferredUnit` é `undefined` → `'Retail'` (F2‑01).
3. Linha do carrinho: 1 × 60 MT = **60 MT**. O cartão dizia 1.200 (preço de atacado) e o operador confirma com o cliente o preço que leu no ecrã.
4. O operador percebe a diferença e muda para "Atacado" (`preferredUnit = 'Bulk'`): agora 1.200 MT, com dedução de `stockQtyBulk -= 1` e `stockQty -= 25` (`:784‑790`).
5. Como `stockQtyRetail` era 0 e o total passou a 10 − 25 = **−15**, o produto fica com três números incoerentes: `stockQtyBulk = 9`, `stockQtyRetail = 0`, `stockQty = −15`. Nada impõe `stockQty = stockQtyBulk × 25 + stockQtyRetail` (F2‑03), e o catálogo continua a decidir a disponibilidade por `stockQty` (F2‑02).

Resultado: o cartão mente no preço, o carrinho mente na unidade, e o stock fica com uma composição impossível. O cliente que compra um saco pode pagar 60 MT por 25 kg de semente — **prejuízo de 1.140 MT por venda** — ou o operador corrige e o stock de atacado baixa 25 unidades de uma vez.

### 7.5 Venda pausada recuperada duas vezes (G‑01)

1. 10:00 — Operador A pausa uma venda de 5.000 MT (3 artigos). `saveActiveCart` grava em `localStorage`, chave `agro_active_cart` (`firebaseDB.ts:1669`).
2. 10:05 — Recarrega a página. `loadPDVData` lê o rascunho → banner "Recuperar venda anterior" (`:1789`).
3. 10:06 — Recupera. `restoreActiveCart` (`:137‑147`) preenche o carrinho e faz `setSavedActiveCart(null)` — **mas não apaga `agro_active_cart`**.
4. 10:07 — Finaliza. Venda gravada, stock deduzido, `clearCompletedCheckout` (`:1278‑1287`) limpa o carrinho — **e continua sem apagar o rascunho**.
5. 10:08 — Recarrega (ou o browser recarrega sozinho). `loadPDVData` volta a encontrar o rascunho: **o banner reaparece** com os mesmos 3 artigos e os mesmos 5.000 MT.
6. 10:09 — Recupera e finaliza outra vez: **segunda venda, segundo débito de stock, segunda fatura** (com número novo, porque o contador avançou).

O único caminho que limpa o rascunho é o botão **"Descartar"** (`:149‑153`), que ninguém carrega depois de vender. O ciclo repete-se a cada recarregamento até alguém o fazer. Num dia com 15 pausas, o desvio é sistemático e invisível — cada venda parece legítima.

### 7.6 Venda antiga em 2026 estraga o stock de 2026 (H‑01)

Objectivo legítimo: lançar um recibo em papel de 12/03/2025 (2 sacos de fertilizante, 2.400 MT).

- `invoiceNumber`: `FAC-2026-0437` (ano do terminal, não da venda — `sequenceHelper.ts:11`).
- `date`: `2025-03-12T…` (correcto).
- `status`: `'Paga'` (fixo).
- `addSaleWithStockDeduction`: deduz **2 unidades do stock de hoje**.
- O stock actual já tinha sido ajustado por contagens físicas em 2025 e 2026. A dedução cria uma falta de 2 unidades que **não existe na prateleira**.
- A reconciliação (`difference = 0`, F‑01) não detecta.
- A contagem física seguinte encontra 2 unidades "em falta", gera uma quebra de 2×custo (0 MT por F‑02), e o gestor conclui que houve furto.

Uma venda de 2025 produziu um alarme de furto em 2026.

---

## 8. Matriz de consistência entre módulos

Para o **mesmo dia 09/11** de §7.1, o que cada módulo afirma:

| Indicador | Relatório PDV | Faturas | Dashboard | Finanças | Valor real |
|---|---|---|---|---|---|
| Vendas do dia | 4.450 | 4.450 | 4.450 | 4.450 | 4.450 |
| Numerário | **3.680** | — | 3.680 | 3.680 | **3.680** |
| Banco/Transferência | **770** | — | 770 | 770 | **770** |
| Em dívida | 0 | **1.180** | não mostra | 1.180 | **0** |
| A crédito | 0 | 2 vendas "canceladas" | inclui | inclui | 0 |
| Valor do stock | — | — | — | **0 MT** | 1.300 MT (5×260) |
| IVA do dia | — | — | — | **0** | 706 Mt (se 16 %) |
| Lucro | — | — | 4.450 | **4.450** | 3.150 (4.450 − 1.300 de CMV) |

Leitura da matriz: **o dinheiro está certo** (3.680 + 770), o que é mérito do `paymentBreakdown`; **a dívida está errada** (1.180 em vez de 0); **o lucro está errado** (4.450 em vez de 3.150, porque o CMV é 0); **o stock vale 0**; e **o IVA não existe**.

O padrão é consistente: o sistema sabe somar o que o operador digitou no momento da venda, e **não sabe** derivar nada a partir dos dados. Todas as métricas que exigem cálculo (dívida por estado, CMV, IVA, valorização, reconciliação) estão erradas — e todas as que exigem apenas soma do input estão certas. Isso explica porque é que o sistema "parece" funcionar no dia-a-dia e falha em todas as decisões de gestão.

Nota sobre "Vendas do dia" em Faturas: a lista é paginada de 30 em 30 com filtro de data e estado no Firestore (`FaturasModule.tsx:83‑87`, `:96‑105`); o KPI "Total Facturado" (`:604`) usa `periodSummary`, que inclui proformas. Dois números diferentes para a mesma palavra.

## 9. Cadeias de efeito entre módulos

O PDV não vive isolado. Estas são as quatro cadeias que ligam um clique no PDV a um prejuízo noutro módulo.

### 9.1 PDV → Stock → Finanças
Venda com stock negativo (F‑03) → valorização com `Math.max(0, …)` na reconciliação mas negativa no produto → `activeProductsVal` em `FinanceModule:499` pode ser negativo → balancete com inventário negativo → decisões de compra erradas.

### 9.2 PDV → Faturas → RH
Comissões: o campo `commissionRate` existe em `types.ts:209` e nos funcionários das sementes, mas **nenhum código calcula comissões** (`grep -rn "comiss" src` → 0 resultados). Se o RH as calcular manualmente a partir do relatório do PDV, o relatório está errado (7.1) e a comissão também. Não há ligação automática venda→funcionário→comissão.

### 9.3 PDV → Finanças → Fisco
Sem IVA (E‑01) e com balancete fabricado (N‑01), qualquer declaração produzida a partir do sistema é indefensável. O PDF do balancete tem linhas de assinatura — é um documento que parece oficial.

### 9.4 PDV → auditoria → responsabilização
Venda duplicada (§7.5) + IP fixo (L‑05) + autorização só no cliente (L‑07) = é impossível provar **quem** duplicou. O único rasto é `username`, que é o mesmo para todos no turno se partilharem a conta (L‑09) e que pode ser "Mazive" com a chave mestra (L‑01).

---

## 10. Desempenho e custo (o que o PDV faz à base de dados)

| Operação | Leituras Firestore | Observação |
|---|---|---|
| Abrir o PDV | `products` (200‑2.000 docs) + 30 vendas + settings + clientes + **funcionários** | 1.000 leituras por abertura, ×10 aberturas/dia = 10.000 |
| Cada tecla na pesquisa | 0 (filtro local) | mas re-render de toda a lista |
| Finalizar venda | 1 venda + N produtos (get+update) = 2N+1 | N=5 → 11 escritas |
| Página de faturas | 31 vendas + summary (agregação = 1 leitura por 1.000 docs) | OK |
| `getSalesSummary` em cada `loadData` | agregação por período | recalculado a cada navegação de aba |
| `getProducts` após cada venda (`:1460`) | todas as linhas outra vez | 2.000 leituras/venda em catálogo grande |

Com 200 vendas/dia e 2.000 produtos: **~400.000 leituras/dia** só a refrescar o catálogo após cada venda. O limite gratuito do Firestore é 50.000/dia. O sistema entra em erro de quota (`RESOURCE_EXHAUSTED`) e, como A‑05 mostra, a falha de auditoria é silenciosa — mas a de `getProducts` não, e o PDV fica com catálogo vazio a meio do dia.

Correcção barata: actualizar o stock em memória com o resultado da venda em vez de reler tudo (`setProducts(prev => prev.map(...))`), e usar listener `onSnapshot` para o catálogo.

---

## 11. Qualidade de código, testes e manutenção

### 11.1 `tsc` passa — e isso é o problema
`tsconfig.json` tem `strict: false` e **`@types/react` não está instalado** (`package.json` não o lista; `node_modules/@types` não o contém). Resultado: todos os componentes são compilados com `React` como `any`, logo `props`, `state` e handlers não são verificados. Prova: inserir `paymentMethod: 'Múltiplo'` numa venda (`PDVModule.tsx:837`) **não** produz erro de tipo — o objecto `Sale` está a ser construído sem tipos. Os 26 P0 deste relatório convivem com "0 erros de compilação".

Acção mínima: `npm i -D @types/react @types/react-dom`, `strict: true`, e corrigir. A factura de erros será alta — o que é, por si, a medida da dívida.

### 11.2 Testes que não testam o PDV
`test/master_plan_test.ts`: 41 testes, todos sobre funções auxiliares puras (formatação, helpers de data, paginação, EAN). **Nenhum** cobre: cálculo de total com desconto, estado por formato, dedução de stock, numeração, arredondamento, pagamento múltiplo. A suite dá a ilusão de cobertura porque os nomes dos testes são de negócio.

### 11.3 Código morto que parece vivo
- `src/utils/indexedDB.ts` (1.993 linhas): camada DB paralela, nunca importada pelo fluxo de vendas, com `fetch` para rotas inexistentes.
- `src/utils/migrateStock.ts`: corre por browser.
- `StockAIEntry.tsx`, `TechnicalModule.tsx:740`: chamam `/api/gemini/*` inexistente.
- Scripts na raiz: `fix_pdv*.cjs`, `fix_stock_loss.cjs`, `replace_double_a5.cjs`, `*.patch` — rewriters de regex deixados no repositório. Quem os correr hoje altera o código com padrões de 2025.

Cada um destes é uma armadilha para o próximo programador: parece que existe uma funcionalidade, e ela está morta.

### 11.4 Duplicação de lógica de negócio
A regra "qual é o stock de um produto híbrido" está implementada em **quatro** sítios com três resultados diferentes (`addToCart`, `deductProductStock`, cartão do catálogo, `reconcileStock`). O mesmo para "como se formata dinheiro" (com e sem locale, `'pt-MZ'` e `'pt-PT'`), "como se numera" (5 prefixos) e "como se imprime" (jsPDF, `window.print`, ESC/POS).

### 11.5 Ficheiros monolíticos
`PDVModule.tsx` 4.559 linhas, `StockModule.tsx` 2.752, `TechnicalModule.tsx` 2.0xx, `pdfGenerator.ts` 1.398. Nenhum tem testes. Qualquer alteração é uma cirurgia às cegas — e é assim que `'Fact-'` e `'FAC-'` acabaram no mesmo ficheiro.

---

## 12. Plano de correcção

### 12.1 P0 — antes de qualquer nova venda (1 a 2 semanas)

| # | Acção | Ficheiros | Critério de pronto |
|---|---|---|---|
| 1 | Numeração autoritativa: documento `counters/{serie}/{ano}` com `runTransaction` e `increment` | `sequenceHelper.ts`, `firebaseDB.ts` | 2 terminais a vender em simultâneo → números distintos e sequenciais |
| 2 | Estado derivado do pagamento, não do papel: `paymentStatus` independente de `printFormat`; proforma deixa de ser dívida | `PDVModule.tsx:1308‑1314`, `types.ts` | Venda em dinheiro impressa em A4 → `Paga`; proforma não conta como dívida |
| 3 | Faturas: badge e acções a conhecer `Crédito`; botão "Pagar" para qualquer estado não cancelado | `FaturasModule.tsx:765‑790` | Nenhuma venda paga aparece vermelha |
| 4 | Datas: gravar `date` local (`YYYY-MM-DDTHH:mm:ss+02:00`) **e** `dateKey` (`YYYY-MM-DD`) para agregação; filtrar por `dateKey` | `PDVModule.tsx`, `dateRangeHelper.ts`, `paginationHelper.ts` | Venda às 00:30 aparece no dia 09/11 no recibo, lista e relatório |
| 5 | Pagamento múltiplo: bloquear finalização se `Σ parcelas ≠ total`; gravar `amountReceived` e `change` | `PDVModule.tsx:2374‑2384`, `types.ts` | 600+400 de 1.000 → finalização recusada |
| 6 | Guarda de stock: verificar disponibilidade **antes** do commit e recusar a venda; `addSale` do restauro dentro de batch; limite de 500 por batch | `firebaseDB.ts:778‑880` | Não é possível gravar `stockQty` negativo; restauro atómico |
| 7 | Stock: `Math.max(0, …)` na dedução, tecto no carrinho, validação por unidade | `PDVModule.tsx:1030‑1240`, `firebaseDB.ts` | Não é possível vender 999 de 3 |
| 8 | Unidade: corrigir o ternário morto e unificar `resolveUnit`; cartão e carrinho usam a mesma função | `PDVModule.tsx:1078`, `:1893`, `:1945`, `:2010` | Cartão e carrinho mostram o mesmo preço |
| 9 | Rascunho: `clearActiveCart()` ao recuperar e ao finalizar; expiração e chave por terminal | `PDVModule.tsx:137‑147`, `:1278‑1287`, `firebaseDB.ts:1667` | Recuperar → finalizar → recarregar → banner ausente |
| 10 | Impressão: remover o `window.print()` de recurso ou renderizar o documento antes de o chamar; remover `@page 80mm` global e usar `@page` por documento | `PDVModule.tsx:1425‑1440`, `index.css:33‑47` | Fallback imprime o recibo; A4 sai inteiro |
| 11 | IVA: `taxRate` por item, linha no **PDF** (hoje não existe) e rótulo correcto (hoje diz "incluído" quando é somado) | `types.ts`, `pdfGenerator.ts`, `PDVModule.tsx:3378` | PDF com base, taxa e IVA; total = base + IVA |
| 12 | Segurança: remover chave mestra do bundle, `firestore.rules` com autenticação, autenticar `/api/*` | `LoginPanel.tsx:164`, `App.tsx:251/397`, `firestore.rules`, `server.ts` | Nenhuma palavra‑passe no código; regras exigem auth |
| 13 | Substituir `confirm/prompt/alert` por modais próprios em todas as acções destrutivas | `StockModule`, `TechnicalModule`, `HRModule`, `EmployeeDetailModal` | Funciona em iframe |
| 14 | `reconcileStock`: calcular o desvio real (soma de vendas ± ajustes vs stock) | `firebaseDB.ts:1566‑1650` | Relatório de reconciliação ≠ 0 |
| 15 | Venda antiga: numeração pela data da venda; sem dedução de stock (ou dedução opcional explícita); controlo de duplicados por `manualReceiptReference` | `PDVModule.tsx:4080‑4559` | Lançar 2025 não altera stock de 2026 |
| 16 | Remover ou corrigir o balancete fabricado: ou vem de dados reais, ou desaparece | `FinanceModule.tsx:496‑520` | Nenhuma percentagem fixa |

### 12.2 P1 — 2 a 4 semanas

17. Normalizar locale em todos os números (`formatMT()` único) — O‑01.
18. Corrigir `numeroParaExtenso` (formas portuguesas, limite de milhares, arredondamento) — O‑03.
19. Cancelamento com estorno de stock e nota de crédito — D‑04.
20. Registar `amountReceived`/`change` na venda e reconciliar a gaveta por método — D‑06/F‑05.
21. Registo de IP real (ou remover a coluna) e de terminal em cada operação — L‑05.
22. Pesquisa global com permissões por perfil — L‑06.
23. Reset de senha com política de 8+, expiração e histórico — L‑08.
24. Backup fora do filesystem efémero + restauro com dry‑run — L‑11/M‑03.
25. `/api/gemini` (implementar ou remover o botão) e `/api/sync/events` (implementar ou apagar `indexedDB.ts`) — M‑01/M‑02.
26. `getProducts` incremental em vez de reler catálogo — §10.
27. Datas: corrigir também os limites de consulta (`getInclusiveDateBounds`) — C‑02.

### 12.3 P2/P3 — backlog

28. `key` estáveis, filtros de estado nas tabelas, legendas de cor, indicador offline.
29. Remover scripts `fix_*.cjs`/`.patch` e `indexedDB.ts` se não for usado.
30. `@types/react` + `strict` + testes de negócio (total, desconto, estado, stock, IVA, numeração).

### 12.4 Ordem recomendada (porque há dependências)
`1 → 2 → 5 → 4 → 6 → 7/8` (numeração e estado primeiro porque todos os relatórios dependem deles; datas antes de tocar em relatórios; guarda de stock antes de corrigir o catálogo). Segurança (12) pode correr em paralelo, mas **deve** preceder a abertura do sistema a mais terminais.

---

## 13. Checklist de aceitação (18 provas a executar após as correcções)

1. Duas vendas simultâneas em dois browsers → números de fatura distintos e consecutivos.
2. Venda em dinheiro impressa em **A4** → estado `Paga`.
3. Proforma → não aparece em "Pendente".
4. Venda a crédito → aparece como "Crédito", com botão "Pagar" funcional.
5. Pagar uma venda a crédito → badge verde, dívida a zero.
6. Venda às 00:30 → mesmo dia no recibo, na lista e no relatório.
7. Parcelas 600+400 numa venda de 1.000 → finalização bloqueada com "falta 400".
8. Fecho do dia com uma venda cancelada → total não inclui a cancelada.
9. Cancelar venda → stock reposto a partir dos valores do item (mesmo após mudar a configuração do produto), sem deixar de repor quando o produto foi apagado.
10. Vender 5 de um produto com 3 → bloqueado no carrinho e recusado na base (stock nunca negativo).
11. Produto híbrido: cartão, carrinho e dedução com a mesma unidade e o mesmo preço.
12. Recuperar venda pausada, finalizar, navegar e voltar → banner ausente.
13. Falha de impressora série → fallback imprime o recibo (não página em branco).
14. Ctrl+P numa fatura A4 → documento completo em A4.
15. Fatura com IVA: base + 16 % = total, linha de IVA **no PDF**, e valor por extenso coerente.
16. `mazive/0147` → recusado.
17. `curl` a `/api/backup` sem token → 401.
18. Regenerar referências num terminal com cache antigo → stock e preços inalterados.

---

## 14. Anexo A — Tabela mestra dos 97 achados

Legenda: **P0** perda/fraude imediata · **P1** erro fiscal ou bloqueio · **P2** erro visível · **P3** qualidade.

| ID | G | Prova | Defeito | Impacto | Correção |
|---|---|---|---|---|---|
| A‑01 | P1 | `firebaseDB.ts:770` | `addSale` sem batch no restauro | Fatura válida sem stock | Batch |
| A‑02 | P1 | `firebaseDB.ts:826` | `merge:true` na venda | Campos antigos persistem | `set` sem merge |
| A‑03 | P1 | `PDVModule.tsx:1332` | `id = sale-Date.now()` | Venda sobrescrita | UUID |
| A‑04 | P1 | `firebaseDB.ts:784` | `increment` sem pré‑condição | Stock negativo | Guarda prévia |
| A‑05 | P1 | `global` | Auditoria `void`/`catch` | Sem rasto em falha | Fila persistente |
| A‑06 | P1 | `PDVModule.tsx:1321` | `getSales()` completo por venda | Custo e latência | Contador |
| A‑07 | P2 | `firebaseDB.ts:778` | Batch >500 falha | Venda grande impossível | Repartir batch |
| A‑08 | P2 | `firebaseDB.ts:797` | `getProducts()` por venda | 2.000 leituras/venda | Usar carrinho |
| B‑01 | P0 | `sequenceHelper.ts` | max+1 no cliente | Números repetidos | Contador atómico |
| B‑02 | P1 | `PDVModule.tsx:3714` | Recibo fabricado se faltar nº | Papel ≠ base de dados | Bloquear emissão |
| B‑03 | P1 | `sequenceHelper.ts:11` | Ano do terminal | Ano errado no documento | Ano da venda |
| B‑04 | P1 | `—` | Sem controlo de lacunas | Inspecção falha | Relatório de sequência |
| B‑05 | P2 | `—` | Sem série/terminal | Sem responsabilização | Série por caixa |
| C‑01 | P0 | `dateRangeHelper.ts:39` | ISO/UTC vs dia local | Venda no dia errado | `dateKey` local |
| C‑02 | P1 | `paginationHelper.ts:59` | Limites UTC na consulta | Erro persiste na BD | Filtrar por `dateKey` |
| C‑03 | P1 | `global` | Relógio do terminal | Datas e ids errados | Validar hora |
| C‑04 | P2 | `vários` | Formatos misturados | Confusão | Um formatter |
| D‑01 | P0 | `PDVModule.tsx:1308` | Papel A4 → Pendente mesmo pago | Dívida falsa | Estado pelo pagamento |
| D‑02 | P0 | `PDVModule.tsx:1309` | Proforma = Pendente | Dívida e receita falsas | Estado próprio |
| D‑03 | P0 | `FaturasModule.tsx:765` | `Crédito` → badge CANCELADA | Venda parece anulada | Badge e acções próprias |
| D‑04 | P1 | `FaturasModule.tsx:288` | Estorno pelo catálogo actual | Stock não reposto | Usar item da venda |
| D‑05 | P2 | `FaturasModule.tsx:340` | Restauro → Pendente | Paga vira dívida | Guardar estado anterior |
| D‑06 | P0 | `PDVModule.tsx:2374` | Parcelas não somam ao total | Venda paga a menos | Bloquear finalização |
| D‑07 | P1 | `FaturasModule.tsx:690` | Sem aba para `Crédito` | Estado invisível | Adicionar filtro |
| E‑01 | P0 | `pdfGenerator.ts` | PDF sem IVA; rótulo errado | Documento inválido | IVA no PDF, rótulo certo |
| E‑02 | P1 | `types.ts / PDVModule.tsx:120` | Sem taxa por produto | Impossível declarar | `taxRate` por item |
| E‑03 | P1 | `PDVModule.tsx:1253` | NUIT hardcoded | Documento com NUIT errado | Bloquear sem settings |
| E‑04 | P1 | `pdfGenerator.ts:610` | Texto fixo de liquidação | Documento afirma o falso | Texto por estado |
| E‑05 | P1 | `PDVModule.tsx:3178` | 4 grafias de recibo | Papel ≠ BD | Um número só |
| E‑06 | P2 | `—` | Sem nota de crédito | Cliente sem prova | Documento de rectificação |
| F‑01 | P0 | `firebaseDB.ts:1633` | `difference = 0` fixo | Reconciliação inútil | Cálculo real |
| F‑02 | P0 | `StockModule.tsx:231` | `buyPrice` inexistente | Inventário a 0 MT; PDF falha | Campo correcto |
| F‑03 | P0 | `firebaseDB.ts:784` | Stock negativo gravado | Relatórios envenenados | Guarda + alerta |
| F‑04 | P1 | `PDVModule.tsx:1160` | Validação contra cache | Sobrevenda | Reler no commit |
| F‑05 | P1 | `—` | Sem livro de movimentos | Causa irreconstruível | `stock_movements` |
| F‑06 | P1 | `StockModule.tsx:231` | Quebras a 0 MT | Perdas invisíveis | Custo real |
| F‑07 | P2 | `StockModule.tsx:360` | `saveProducts` em massa | Reverte catálogo | Escrita por campo |
| F‑08 | P2 | `migrateStock.ts:9` | Migração por browser | Stock sobreposto | Migração única |
| F2‑01 | P0 | `PDVModule.tsx:1078` | Ternário morto | Cartão 1.200 → carrinho 1.500 | `preferredUnit` real |
| F2‑02 | P0 | `PDVModule.tsx:1893` | Badge por `stockQty` | Bloqueia/liberta errado | Stock por unidade |
| F2‑03 | P1 | `firebaseDB.ts:786` | `stockQty` vs unidades | Composição inconsistente | Derivar o total |
| F2‑04 | P1 | `PDVModule.tsx:1360` | Conversão duplicada | Dedução errada | Uma função |
| G‑01 | P0 | `PDVModule.tsx:137` | Rascunho nunca apagado | Venda duplicada | Limpar no commit |
| G‑02 | P1 | `types.ts:78` | Pausa sem operador; chave única | Pausa sobrescrita | Modelo completo |
| G‑03 | P1 | `PDVModule.tsx:139` | Sem revalidação | Preço/stock antigos | Revalidar |
| G‑04 | P2 | `—` | Sem expiração | Venda de meses | TTL |
| H‑01 | P0 | `PDVModule.tsx:327` | Data histórica, stock actual | Estraga stock | Sem dedução |
| H‑02 | P0 | `PDVModule.tsx:330` | Sem anti‑duplicado | Recibo lançado 2× | Índice único |
| H‑03 | P1 | `PDVModule.tsx:340` | Estado fixo Paga | Dívida escondida | Estado do papel |
| H‑04 | P1 | `PDVModule.tsx:347` | Auditoria insuficiente | Sem prova | Anexo + autorizador |
| H‑05 | P2 | `PDVModule.tsx:331` | Datas futuras | Manipulação | Limite superior |
| I‑01 | P2 | `App.tsx` | Sem timeout | Sessão aberta | Bloqueio por inactividade |
| I‑02 | P2 | `firebaseDB.ts:1669` | Rascunho partilhado entre abas | Confusão e perda | Chave por terminal/aba |
| J‑01 | P0 | `PDVModule.tsx:1425` | `print()` com estado null | Página em branco | Renderizar antes |
| J‑02 | P0 | `index.css:33` | `@page` 80mm global | A4 truncado | `@page` por documento |
| J‑03 | P1 | `index.css:44` | Whitelist incompleta | A5 em branco | Classes, não ids |
| J‑04 | P1 | `PDVModule.tsx:2929` | Documento do estado | Reimpressão inválida | Ler da BD |
| J‑05 | P1 | `PDVModule.tsx:1452` | Pré-visualizar = descarregar | 200 PDFs/dia | Só pré-visualizar |
| J‑06 | P1 | `pdfGenerator.ts:610` | Rodapé de liquidação fixo | Documento falso | Texto por estado |
| J‑07 | P1 | `pdfGenerator.ts` | Sem IVA nos 3 formatos | Documento inválido | Ver E‑01 |
| J‑08 | P2 | `PDVModule.tsx:1253` | Settings em falta | Cabeçalho errado | Obrigar settings |
| K‑01 | P0 | `StockModule.tsx:362` | `confirm/prompt/alert` | Acções silenciosas | Modais próprios |
| K‑02 | P1 | `PDVModule.tsx:1140` | Qty `''` na venda | Item a 0 MT | Validar no submit |
| K‑03 | P1 | `PDVModule.tsx:1223` | Desconto ilimitado | Total a zero | Limite + perfil |
| K‑04 | P1 | `PDVModule.tsx:756` | Toasts escondem erros | Erro invisível | Registo + persistente |
| K‑05 | P2 | `PDVModule.tsx:1169` | Blur repõe 1 | Total muda sozinho | Repor valor anterior |
| K‑06 | P2 | `FaturasModule.tsx:765` | Cores ambíguas | Má leitura | Legenda |
| K‑07 | P2 | `PDVModule.tsx:712` | Sem indicador offline | Perda de vendas | Estado de rede |
| K‑08 | P3 | `várias listas` | `key={index}` | Troca de linhas | Usar ids |
| L‑01 | P0 | `LoginPanel.tsx:164` | Chave mestra no código | Acesso total | Remover |
| L‑02 | P0 | `DatabaseSchemaViewer.tsx:24` | Password no UI | Backdoor documentado | Remover |
| L‑03 | P0 | `firestore.rules` | `if true` | BD pública | Auth + regras |
| L‑04 | P0 | `server.ts:152` | API sem auth | Exfiltração | Token + CORS |
| L‑05 | P1 | `LoginPanel.tsx:161` | IP aleatório | Auditoria falsa | IP real |
| L‑06 | P1 | `InlineHeaderSearch.tsx:158` | Salários expostos | Privacidade | Permissões |
| L‑07 | P1 | `global` | Auth no cliente | Bypass | Validar na BD |
| L‑08 | P1 | `credentialsReset.ts` | 4–6 caracteres | Força bruta | Política 8+ |
| L‑09 | P1 | `LoginPanel.tsx:227` | Alias de conta | Sem responsabilização | Remover |
| L‑10 | P1 | `LoginPanel.tsx:214` | Credenciais no bundle | Login offline | Remover |
| L‑11 | P1 | `TechnicalModule.tsx:1828` | Restauro sem auth | Corrupção | Auth + schema |
| L‑12 | P2 | `App.tsx:397` | Sessões sem validação | Sessão fantasma | Verificar |
| M‑01 | P0 | `StockAIEntry.tsx:122` | `/api/gemini` inexistente | Feature morta | Implementar/remover |
| M‑02 | P0 | `indexedDB.ts:367` | SSE inexistente | Sem tempo real | Implementar/remover |
| M‑03 | P1 | `server.ts:160` | Backup em disco efémero | Perda de backups | Storage durável |
| M‑04 | P1 | `server.ts` | Rate limit em memória | Sem protecção | Limite real |
| M‑05 | P1 | `server.ts` | Stack nos erros | Info disclosure | Mensagem genérica |
| M‑06 | P2 | `server.ts:94` | CSP permissiva | XSS | CSP estrita |
| N‑01 | P0 | `FinanceModule.tsx:496` | Balancete fabricado | Documento oficial falso | Dados reais |
| N‑02 | P1 | `FinanceModule.tsx:497` | Quebras pro-rateadas | Resultado errado | Custo real |
| N‑03 | P0 | `FinanceModule.tsx:1300` | Barras fictícias | Decisão com dados falsos | Empty state |
| N‑04 | P1 | `FinanceModule.tsx:1234` | KPI por método | Dívida errada | Filtrar por estado |
| N‑05 | P1 | `FinanceModule.tsx:1264` | Sem filtro de estado | Canceladas somam | Filtrar |
| N‑06 | P1 | `—` | Sem despesas | Lucro irreal | Módulo despesas |
| N‑07 | P2 | `FinanceModule.tsx:553` | CSV com locale | Excel quebra | `;` e vírgula |
| O‑01 | P1 | `18 sítios` | `toLocaleString()` sem locale | Separadores mistos | `formatMT()` |
| O‑02 | P2 | `vários` | pt-PT vs pt-MZ | Inconsistência | Um locale |
| O‑03 | P2 | `numberToWords.ts:44` | Extenso incorrecto | Documento errado | Reescrever |

**Total: 97 achados — 26 P0, 49 P1, 21 P2, 1 P3.**

---

## 15. Anexo B — Mapa de ficheiros e pontos quentes

| Ficheiro | Linhas | Pontos quentes |
|---|---|---|
| `src/components/PDVModule.tsx` | 4.559 | 749‑756, 837, 1030‑1100, 1078, 1268‑1500, 1306‑1317, 1360‑1372, 1425‑1440, 1789, 1893, 1928, 1945‑1950, 2010, 2180‑2560, 2557‑2577, 2870‑3700, 3085‑3115, 3178, 3284, 3714, 4080‑4559 |
| `src/utils/firebaseDB.ts` | 1.687 | 560‑600, 782‑840, 1185, 1506‑1545, 1552‑1562, 1566‑1650 (1633), 1667‑1688 |
| `src/utils/sequenceHelper.ts` | ~60 | numeração inteira |
| `src/utils/dateRangeHelper.ts` | ~140 | 39‑45, 112‑136 |
| `src/utils/paginationHelper.ts` | 88 | `getInclusiveDateBounds` |
| `src/utils/numberToWords.ts` | 90 | 44‑90 |
| `src/utils/indexedDB.ts` | 1.993 | 67‑160, 367 (morto) |
| `src/utils/migrateStock.ts` | 55 | 9‑55 |
| `src/components/FaturasModule.tsx` | 1.400 | 47, 83‑87, 187‑207, 213, 273‑274, 334, 604‑640, 745‑790 |
| `src/components/StockModule.tsx` | 2.752 | 165‑209, 230‑250, 360‑384, 1400‑1420, 1446‑1448, 1578‑1579, 2140‑2200 |
| `src/components/TechnicalModule.tsx` | ~2.050 | 273, 295, 502‑514, 740, 922, 953, 982, 999, 1828, 1874 |
| `src/components/FinanceModule.tsx` | 1.9xx | 243, 483‑520, 1227‑1240, 1264‑1303 |
| `src/components/LoginPanel.tsx` | ~700 | 161, 163‑175, 227‑229, 323, 348 |
| `src/components/InlineHeaderSearch.tsx` | ~400 | 150‑160, 166‑186 |
| `src/components/DatabaseSchemaViewer.tsx` | ~300 | 24‑27 |
| `src/index.css` | ~120 | 33‑47 |
| `server.ts` | ~250 | 94‑103, 152, 172, 183, 188, 225 |
| `firestore.rules` | 8 | regra global aberta |

---

## 16. Anexo C — Notas de leitura e limites deste relatório

- **Cada `ficheiro:linha` corresponde ao estado do commit auditado.** Se o código mudar, o número pode deslocar-se; o ID do achado (A‑01, J‑04…) mantém‑se estável e deve ser usado nas discussões.
- **Os valores das simulações** vêm de sementes e de preços observados no código; não substituem uma reconciliação com os dados reais da loja. Servem para mostrar a **direcção e a ordem de grandeza** do erro, que é o que importa para decidir o que corrigir primeiro.
- **O que não está aqui:** o módulo de RH (processamento de salários, IRPS, INSS), o módulo de transformações e o de assiduidade foram lidos apenas na medida em que tocam no PDV (comissões, funcionário na venda, valor de stock). Merecem auditoria própria; os indícios recolhidos (cálculos de IRPS por tabela embutida, ausência de ligação venda‑comissão) sugerem que terão problemas da mesma família.
- **A conclusão operacional** é simples: o PDV **regista** vendas com razoável fiabilidade, mas **não sabe** quanto dinheiro entrou, quanto stock saiu, nem que documento emitiu. Enquanto os 26 P0 não forem fechados, qualquer número produzido por este sistema — para o dono, para o banco ou para o fisco — tem de ser conferido à mão.

---

## 17. Estado da execução do plano (correcções aplicadas)

Registo do que já foi corrigido no código, fase a fase. Cada fase foi verificada com
`npx tsc --noEmit` e `npx tsx test/master_plan_test.ts` (44/44, em `TZ=Africa/Maputo` e `TZ=UTC`).

| Fase | Âmbito | Ficheiros | Achados fechados | Estado |
|---|---|---|---|---|
| 1 | Semântica única do estado financeiro | `src/utils/saleStatus.ts` (novo), `types.ts` | D‑01, D‑02, D‑03, D‑07, N‑05 | ✔ |
| 2 | Estado = pagamento; recibo só para venda paga; abas e cancelamento | `PDVModule.tsx`, `FaturasModule.tsx`, `FinanceModule.tsx`, `DashboardModule.tsx`, `pdfGenerator.ts` | D‑05, D‑06, B‑02 | ✔ |
| 3 | Numeração fiscal transaccional (contador no Firestore) | `firebaseDB.ts`, `PDVModule.tsx`, `FaturasModule.tsx` | B‑01, B‑03, E‑05 | ✔ |
| 4 | Dia operacional de Maputo (`dateKey`) | `dateRangeHelper.ts`, `paginationHelper.ts`, `types.ts`, `PDVModule.tsx`, `DashboardModule.tsx` | C‑01, C‑02 | ✔ |
| 5 | Reconciliação de stock real (composto, negativo, custo) | `firebaseDB.ts`, `StockModule.tsx` | F‑01, F‑02, F‑06 | ✔ |
| 6 | Venda atómica: ler → validar → escrever; id único; sem merge | `firebaseDB.ts`, `PDVModule.tsx` | A‑01, A‑02, A‑03, A‑04, F‑03, F‑04, F2‑01, F2‑02 | ✔ |
| 7 | Rascunho: limpeza no commit, expiração, revalidação | `PDVModule.tsx` | G‑01, G‑03, G‑04 | ✔ (G‑02 parcial) |
| 8 | Impressão: fallback com documento no DOM; A4 ≠ 80 mm | `PDVModule.tsx`, `index.css` | J‑01, J‑02, J‑03 | ✔ |
| 9 | IVA impresso nos três formatos; rótulo corrigido | `pdfGenerator.ts`, `PDVModule.tsx`, `FaturasModule.tsx` | E‑01, J‑07 | ✔ |
| 10 | Fim das palavras‑passe universais | `authorization.ts` (novo), `LoginPanel.tsx`, `App.tsx`, `StockModule.tsx`, `FaturasModule.tsx`, `DatabaseSchemaViewer.tsx`, `scripts/hash-password.mjs` | L‑01, L‑02 | ✔ |
| 11 | Autorização da API local; whitelist de coleções | `server.ts`, `indexedDB.ts` | L‑04, M‑06 (parcial) | ✔ |
| 11b | Regras do Firestore com autenticação | `firestore.rules`, `firebaseDB.ts` | L‑03 | ⧗ escrito, publicação pendente |
| 12 | Funcionalidades mortas: canal em tempo real e assistente de IA | `server.ts`, `indexedDB.ts`, `StockAIEntry.tsx` | M‑01, M‑02 | ✔ |
| 13 | Vendas retroactivas: stock, duplicados, datas futuras, estado | `PDVModule.tsx` | H‑01, H‑02, H‑03, H‑05 | ✔ |
| 14 | Balancete e gráficos deixam de ser inventados | `FinanceModule.tsx` | N‑01, N‑03 | ✔ |
| 15 | Fim das confirmações invisíveis | `confirmDialog.ts`, `DialogHost.tsx` (novos), 6 módulos | K‑01 | ✔ |
| 16 | IP real nos registos de auditoria | `clientInfo.ts` (novo), `server.ts`, `LoginPanel.tsx`, `StockModule.tsx` | L‑05 | ✔ |

### Correções a este anexo

- **G‑01/G‑02 (duplicação do rascunho)** — a descrição original exagerava: as vendas em pausa são
  uma coleção (`paused_sales`), não uma chave única, portanto uma segunda pausa não apaga a
  primeira. O risco real era o **rascunho de auto‑save**: sobrevivia ao commit até ao efeito
  seguinte e reaparecia como "venda anterior". Foi fechado com limpeza explícita no commit e na
  recuperação, expiração às 12 horas e revalidação de preços/stock ao restaurar.
- **L‑03 (regras do Firestore)** — o ficheiro seguro está escrito, mas **não publicado**. Publicar
  antes de ativar o login anónimo no Firebase interrompe a sincronização. Ver `docs/seguranca.md`.
- **Teste de datas** — o teste "Date range includes plain dates…" fixava o comportamento
  defeituoso (limites em meia‑noite UTC). Foi reescrito para os limites do dia de Maputo
  (`2026-09-30T22:00:00.000Z` … `2026-10-07T21:59:59.999Z`) e acrescentado o caso 21:30Z/22:30Z.

### Ainda por corrigir

- **Fase 12** — `M‑01`/`M‑02`: o canal SSE passou a existir no servidor (com *broadcast* em cada
  escrita) e a rota `/api/gemini/technician-ai` responde com um erro claro quando não há
  `GEMINI_API_KEY`; com chave, faz ponte para o Gemini (só texto — anexos devolvem 501).
- **Fase 13** — vendas retroactivas: por omissão já não descontam stock actual, recibo manuscrito
  duplicado é recusado, datas futuras bloqueadas e o estado segue o método de pagamento.
- **Fase 14** — o "Balancete" era fabricado (40/60 caixa-banco, fornecedores e capital social
  inventados a partir do stock). Passou a **Mapa de Conferência** com valores reais; os gráficos
  deixaram de desenhar barras fictícias quando não há vendas.
- **Fase 15** — `window.confirm/prompt/alert` substituídos por `appConfirm/appPrompt/appAlert`
  com `DialogHost` (funcionam dentro de iframes).
- **Fase 16** — IP aleatório substituído pelo IP real do posto (`/api/client-info`).

**Continua aberto:** I‑01/I‑02 (sessão e rascunho por aba), K‑03 (desconto ilimitado), K‑04
(erros escondidos em toasts), L‑06…L‑12 (política de palavras‑passe, permissões, validação no
servidor), M‑03…M‑06, N‑02/N‑04/N‑06/N‑07, E‑02/E‑03/E‑04/E‑06, F‑05 (livro de movimentos),
F‑07/F‑08, O‑01…O‑03, e a publicação das regras do Firestore.
