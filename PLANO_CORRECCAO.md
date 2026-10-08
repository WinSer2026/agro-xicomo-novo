# Plano de Correcção — AGRO • XICOMO & SERVIÇOS, LDA

**Data:** 2026-10-08
**Ramo:** `arena/0b139fa1-agro-xicomo-novo`
**Estado:** correcções implementadas, testadas (`npm run test`) e compiladas (`npm run build` / `tsc --noEmit` sem erros).

---

## 1. Os dois problemas relatados

### 1.1. "Vendas antigas": clicar em **Finalizar Registo Retroativo** não faz nada

**Causa raiz (3 defeitos somados):**

| # | Defeito | Onde |
|---|---------|------|
| A | **O aviso de erro ficava escondido debaixo do modal.** O toast era desenhado com `z-50` na linha 1693 do `PDVModule`, e o modal de ecrã inteiro também é `z-50` mas aparece *depois* no DOM — com `z-index` igual ganha o elemento que vem atrás. O modal é opaco (`bg-slate-900/95`) e cobre o ecrã todo, por isso a mensagem de erro (e a de sucesso) nunca era vista. | `src/components/PDVModule.tsx` |
| B | **A mensagem era genérica** — `"Erro ao registar a venda antiga."` — sem dizer o motivo nem o que fazer. | `handleFinalizeRetroactiveSale` |
| C | **Nada impedia cliques repetidos** e **não havia qualquer indicador de progresso**. Se a ligação estiver lenta ou sem rede, a promessa do Firestore fica pendente e o botão parecia "morto". | `handleFinalizeRetroactiveSale` |

**Correcção aplicada:**

- O erro passa a ser mostrado **dentro do modal** (faixa vermelha por cima do botão) e o toast passou a ser desenhado num portal no `<body>` com `z-[9999]`, ficando **sempre acima de qualquer modal**.
- Mensagens accionáveis traduzidas do código de erro do Firestore (`permission-denied`, `unavailable`, …) — criado `src/utils/errorHelper.ts`.
- Botão desactivado durante a gravação, com texto **"A gravar…"** e spinner.
- **Watchdog de 8 s:** se a gravação não terminar, aparece o aviso *"A gravação está a demorar — a ligação pode estar lenta ou sem internet. NÃO feche esta janela…"*.
- **O stock deixou de ser descontado produto a produto.** Antes, se a gravação da venda falhasse a meio, o stock já tinha saído e ficava divergente da facturação. Agora a venda e a saída de stock são escritas **no mesmo lote atómico** (`addSaleWithStockDeduction`).
- O registo de auditoria deixou de poder deitar a operação abaixo.
- Validação da data (rejeita datas inválidas e datas futuras).
- O modal só fecha em caso de sucesso.

### 1.2. Painel do Técnico → Definições → Utilizadores → **Gravar** dá erro

**Causa raiz (2 defeitos principais + 1 secundário):**

| # | Defeito | Consequência |
|---|---------|--------------|
| A | Ao carregar em EDITAR, **o hash da palavra-passe era colocado dentro do campo** (`setUsrPassword(user.passwordHash)`). O campo tem `maxLength={6}` e a validação exige 4 a 6 caracteres: qualquer conta cujo hash não começe por `sha256:` (contas antigas em texto simples, ou contas criadas pelo assistente de IA) **falhava sempre a validação** e o técnico via "Erro" sem perceber porquê. | Gravação bloqueada |
| B | **Mensagem genérica** `'Erro ao gravar utilizador.'` — escondia o motivo real (regras do Firestore, sem rede, etc.). | Diagnóstico impossível |
| C | **Não havia validação de utilizador duplicado** — gravar `maria` quando já existe `Maria` criava dois registos diferentes (o login é *case-insensitive*). | Contas duplicadas |

**Correcção aplicada:**

- O campo da palavra-passe passa a ficar **vazio em modo de edição** (`"Deixe em branco para manter a actual"`). Se não escrever nada, a palavra-passe actual é preservada — incluindo as contas antigas em texto simples.
- Ao criar, a palavra-passe continua a ser obrigatória e validada pela política oficial (4 a 6 caracteres).
- **Utilizador duplicado recusado** com mensagem clara (`case-insensitive`).
- Ao editar, o `id` do registo existente é reaproveitado — nunca se cria um registo paralelo.
- Mensagens de erro accionáveis (regras de segurança, sem ligação, quota, …).
- O log de auditoria deixou de poder bloquear a gravação.
- Botão desactivado durante a gravação ("A gravar…"), impedindo duplo clique.

---

## 2. Problemas idênticos encontrados em todo o sistema

Foram identificados **8 padrões de defeito** que se repetiam em todos os módulos. Todos foram corrigidos.

### P1 — Toasts escondidos atrás dos modais (idêntico ao problema 1.1-A) — **7 módulos**

`PDVModule`, `FaturasModule`, `FinanceModule`, `HRModule`, `StockModule`, `TechnicalModule`, `TransformationView`.
Todos desenhavam `fixed bottom-6 right-6 z-50` e todos tinham modais `z-50` declarados depois no DOM.
**Efeito em produção:** qualquer gravação que falhasse dentro de um modal (criar produto, gravar funcionário, processar salário, registar quebra, aplicar alterações de IA…) dava exactamente a mesma sensação de **"carreguei e não aconteceu nada"**.
**Correcção:** componente único `src/components/Toast.tsx` (portal para `<body>`, `z-[9999]`, botão de fechar, duração maior para erros).

### P2 — `window.confirm()` / `prompt()` / `alert()` bloqueados em iframes — **17 ocorrências**

O navegador bloqueia estas funções quando a aplicação corre dentro de um iframe com `sandbox` (pré-visualizações, AI Studio, incorporações). `window.confirm()` devolve sempre `false` e `alert()` não mostra nada → **o clique parece não fazer nada**.
Encontrados em: `TechnicalModule` (6), `StockModule` (2 + 1 `prompt` de autorização de stock), `TransformationView` (1), `StockAIEntry` (7 `alert`).
**Correcção:** novo componente `src/components/ConfirmDialog.tsx` (com confirmação escrita — "ELIMINAR" / "ZERAR" — nas operações destrutivas) e janela própria de palavra-passe no ajuste directo de stock.

### P3 — Mensagens de erro genéricas — **~25 ocorrências**

`'Erro ao gravar.'` / `'Erro ao cadastrar produto.'` / `'Erro ao processar o pagamento.'` etc., sem motivo nem acção seguinte.
**Correcção:** `describeError()` converte códigos do Firestore em português corrente, com dica concreta (ex.: *"A base de dados recusa escritas (regras de segurança). É necessário publicar as regras do Firestore..."*). Aplicado em todos os módulos.

### P4 — Ids duplicados que se sobrepunham em silêncio — **61 pontos**

Ids gerados com `'log-' + Date.now()`, `'sale-' + Date.now()`, etc. Vários registos no mesmo milissegundo recebiam o **mesmo id** e, como o Firestore grava por id, sobrescreviam-se sem aviso — vendas perdidas e rasto de auditoria incompleto (havia 36 pontos só de logs de auditoria).
**Correcção:** `src/utils/idHelper.ts` (`uid('log-')` = timestamp + sequência + aleatório), aplicado nos 61 pontos.

### P5 — Escritas não atómicas (stock descontado antes de gravar a venda)

`PDVModule` (venda antiga). A venda e o movimento de stock devem ser atómicos.
**Correcção:** lote único (`addSaleWithStockDeduction`), com fallback.

### P6 — Cache que nunca era revalidada — **4 métodos**

`getSales()`, `getLosses()`, `getPayrollPayments()` e `getPausedSales()` usavam `if (cache && cache.length >= 0)`. Como `length` nunca é negativo, a condição era **sempre verdadeira** — se a cache chegasse vazia, o sistema devolvia zero registos para sempre (vendas "desapareciam" e a numeração das facturas voltava ao 0001).
**Correcção:** `> 0`.

### P7 — Cache partilhada corrompida por alterações no próprio objecto

`getProducts()` devolvia os objectos da cache por referência; vários módulos fazem `prod.stockQty = …` antes de gravar. Se a gravação falhasse, a alteração ficava "suja" na cache.
**Correcção:** `getProducts()` devolve cópias superficiais.

### P8 — Falta de feedback de ligação

O painel dizia sempre "sincronizado" (`isSSEActive()` devolvia `true` fixo) e o teste de ligação ao Firebase devolvia sempre sucesso falso com latência inventada (38 ms).
**Correcção:**
- `probeDatabaseHealth()` faz uma sonda real (escreve, lê e apaga um documento de saúde) e devolve o erro verdadeiro; `testConnection()` passou a usá-la.
- Banda amarela global **"Sem ligação à internet"** em `App.tsx` quando `navigator.onLine` é falso.
- `isSSEActive()` / `getPendingCount()` passaram a reflectir o estado real do navegador.

### Extra — Correcções de modelo de dados (erros de compilação latentes)

`tsc --noEmit` falhava em 8 pontos (campos usados em runtime mas ausentes dos tipos). Corrigido:
- `SaleItem.category` (usado pelo PDV e pelos relatórios);
- `LossRecord.reason` — acrescentado `'Deterioração'` (já era usado no Stock);
- `PayrollPayment.date` e `PausedSale.createdAt` — campos legados usados nas ordenações.

---

## 3. Ficheiros criados

| Ficheiro | Função |
|----------|--------|
| `src/utils/errorHelper.ts` | Tradução de erros do Firestore para linguagem corrente + `describeError()` |
| `src/utils/idHelper.ts` | `uid()` — ids únicos (fim das sobreposições silenciosas) |
| `src/components/Toast.tsx` | Toast global num portal (`z-[9999]`) — nunca fica atrás de modais |
| `src/components/ConfirmDialog.tsx` | Caixa de confirmação própria (substitui `window.confirm`), com confirmação escrita nas operações destrutivas |
| `test/firestoreMock.ts` | Firestore em memória para os testes |
| `test/setup.ts`, `vitest.config.ts` | Infra-estrutura de testes |
| `test/pdv.retroactive.test.tsx` | Venda antiga: gravação correcta |
| `test/technical.users.test.tsx` | Utilizadores: criar e editar sem alterar a senha |
| `test/failuremodes.test.tsx` | Regressões: escrita rejeitada, sem rede, senha legada, duplicados |

---

## 4. Como verificar (2 minutos)

```bash
npm install
npm run test     # 8 testes de regressão — todos a passar
npm run lint     # tsc --noEmit — 0 erros
npm run build    # compila sem erros
npm run dev      # http://localhost:3000
```

Na aplicação:
1. **PDV → "Venda Antiga"** → adicionar artigo → **Finalizar Registo Retroativo**: o botão passa a "A gravar…", e em caso de falha o motivo aparece **dentro do modal**.
2. **Painel do Técnico → Definições → Utilizadores** → EDITAR → **Guardar Alterações** (sem tocar na senha): grava e mantém a senha actual.
3. **Painel do Técnico → Nuvem/Firebase → Testar ligação**: passou a fazer uma sonda real e a mostrar o erro verdadeiro.

---

## 5. O que falta fazer (recomendações por prioridade)

### 🔴 Prioridade Alta — resolver na infra-estrutura

1. **Publicar as regras do Firestore.** O ficheiro `firestore.rules` deste repositório permite leitura e escrita, mas se essas regras não estiverem publicadas na base de dados `ai-studio-remixagroxicomoe-…` do projecto `gen-lang-client-0896153566`, **todas as gravações falham com `permission-denied`** — o que explica o erro no painel do técnico.
   Acção: `firebase deploy --only firestore:rules` (ou publicar no console) e depois confirmar em
   *Painel do Técnico → Nuvem/Firebase → Testar ligação*.
   Com as correcções feitas, se o problema for este, a aplicação passa a dizê-lo por extenso.

2. **Confirmar que o projeto Firebase aceita o domínio de produção.** Se a app corre num domínio Vercel, verificar as restrições de `Referer`/`API key` na consola Google Cloud.

### 🟠 Prioridade Média

3. **Numeração sequencial de facturas em concorrência.** `generateNextInvoiceNumber()` calcula o próximo número a partir da lista de vendas em cache; dois terminais a facturar ao mesmo tempo podem gerar o mesmo número. Recomenda-se passar a um contador no Firestore dentro de uma transacção (`runTransaction`).

4. **Fila de sincronização explícita.** Hoje o Firestore guarda as escritas pendentes localmente, mas a aplicação não mostra quantas ficaram por sincronizar. Vale a pena mostrar o contador real (`waitForPendingWrites`) na barra de estado.

5. **Substituir os modais `securityModal` do módulo de Facturas** pelo `ConfirmDialog` (já existe essa intenção no código) para uniformizar o comportamento.

### 🟡 Prioridade Baixa / Manutenção

6. **`src/utils/indexedDB.ts` (1993 linhas) não é usado** — era a camada antiga. Pode ser removido depois de confirmar que nenhum ambiente de produção depende dele.
7. **Os scripts `fix_pdv.cjs`, `fix_pdv_more.cjs`, `fix_stock_loss.cjs`, `replace_double_a5.cjs`, `pdv.patch`, `update_stock.patch`** na raiz já foram aplicados; podem ser arquivados.
8. **O `fetch('/api/gemini/technician-ai')`** usado pelo assistente de IA e pela entrada de stock por IA devolve 404 quando o servidor não expõe esse endpoint. Vale a pena devolver uma mensagem apresentável quando o backend não está disponível.

---

## 6. Nota sobre a metodologia

Os dois problemas relatados não eram "um botão que não funciona": eram **falhas silenciosas** — a operação corria, falhava (ou ficava pendente), e o resultado nunca chegava ao ecrã. Por isso a correcção não foi só "arranjar o botão", mas sim:

1. **Nunca esconder um erro** (portal com `z-index` superior a todos os modais);
2. **Nunca mostrar um erro sem solução** (mensagens accionáveis traduzidas do Firestore);
3. **Nunca deixar o utilizador sem saber que o sistema está a trabalhar** (estado "A gravar…" + watchdog de 8 s + banda de "Sem ligação");
4. **Nunca deixar dados a meio** (escritas atómicas de venda + stock, ids únicos, auditoria não bloqueante).

Estes quatro princípios foram aplicados a todo o sistema, não apenas aos dois ecrãs relatados.
