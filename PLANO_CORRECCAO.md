# Plano de Correcção — Falhas Silênciosas no AGRO XICOMO

**Data:** 2026-10-08
**Problemas reportados:**
1. **Vendas antigas / lançamento retroactivo** — clicar em «Finalizar Registo Retroativo» não dá qualquer feedback visível.
2. **Painel de Técnico → Definições → Utilizadores** — clicar em «Gravar» após alterar um utilizador mostra mensagem de erro.

**Pedido adicional:** procurar problemas idênticos em todo o sistema e apresentar o plano de correcção de tudo.

---

## 1. Diagnóstico — Causa Raiz Comum

Os dois sintomas aparentam ser bugs diferentes, mas resultam da mesma família de defeitos:
**«falhas silênciosas»** — a aplicação até tenta fazer a coisa certa, mas o resultado (sucesso ou
erro) nunca chega aos olhos do operador, ou a operação é bloqueada por uma validação inesperada.

### 1.1 Porque «nada acontece» na venda retroativa

| # | Causa | Efeito |
|---|-------|--------|
| A | O toast é renderizado dentro da página (`z-50`), **antes** no DOM dos modais de ecrã inteiro (`z-50` / `z-[100]`). Com z-index igual, o modal (mais tardio no DOM) cobre o toast. | Qualquer erro/sucesso na venda retroativa acontece, mas a notificação fica **escondida atrás do modal opaco**. Para o operador, «não aconteceu nada». |
| B | O botão não tem estado de carregamento nem proteção contra duplo clique. | Um clique que dispare uma escrita lenta parece um clique morto; cliques repetidos podem criar escritas concorrentes. |
| C | O Firestore, quando está sem ligação (loja «sem energia»/rede instável — exatamente o cenário do registo retroativo), deixa as escritas `setDoc`/`batch.commit()` **penduradas para sempre** (a promise só resolve com confirmação do servidor). Sem watchdog, o sistema fica mudo. |
| D | `new Date(retroactiveDateTime).toISOString()` lança `RangeError` com data inválida e não há validação de data futura. | Erro capturado mas invisível (ver A). |
| E | IDs gerados com `'sale-retro-' + Date.now()` / `'log-' + Date.now()`. | Registos criados no mesmo milissegundo colidem no Firestore e **sobrescrevem-se silenciosamente** (venda/log perdido). |

### 1.2 Porque a gravação de utilizadores dá erro

| # | Causa | Efeito |
|---|-------|--------|
| F | `startEditUser` carrega o `passwordHash` guardado (ex.: `sha256:salt:hash` ou senha antiga em texto simples como `gestor123`) **para dentro do campo da palavra-passe**. | Ao clicar em «Gravar», o sistema trata o hash/senha antiga como se fosse uma **palavra-passe nova** e submete-a à política oficial (4–6 caracteres). Contas antigas (senhas com mais de 6 caracteres ou qualquer hash que não comece por `sha256:`) são rejeitadas → mensagem de erro. |
| G | Não existe validação de username duplicado. | É possível criar dois «admin»/«Vanda» que depois colidem no login (case-insensitive). |
| H | `hashPassword()` é chamado **fora** do `try/catch` e os erros do Firestore são mostrados como «Erro ao gravar utilizador.» sem causa. | Erros reais (permissão, rede, quota) ficam sem tradução — o técnico não sabe o que fazer. |

### 1.3 Problemas idênticos encontrados em todo o sistema

| # | Problema | Onde |
|---|----------|------|
| I | **Toast sempre atrás dos modais** (mesmo defeito de A) | `PDVModule`, `StockModule`, `TechnicalModule`, `FaturasModule`, `FinanceModule`, `HRModule`, `TransformationView` — 7 módulos com toast `z-50` inline. No PDV o toast nem sequer é renderizado na tab «Relatórios». |
| J | **`window.confirm` / `window.prompt` bloqueados em iframes sandbox** (o próprio código do PDV já tem um comentário a admitir isto) → botões que «não fazem nada» | `TechnicalModule` (7 usos: limpar sessões, backup, zerar sistema, fechar exercício, novo exercício, restaurar backup…), `StockModule` (2 usos: gerar referências), `TransformationView` (1 uso: anular transformação). O PDV/Faturas já usam diálogos próprios — os restantes não. |
| K | **IDs por `Date.now()`** (62 ocorrências) — colisões silenciosas de vendas, logs de auditoria, utilizadores, clientes, sessões | Todos os módulos + utilitários. |
| L | **Ordenações com `campo.localeCompare()` sem proteção** — um único registo legado sem `date`/`createdAt` rebenta `getSales()`/`getLosses()`/etc. e todas as operações dependentes falham com erro invisível | `firebaseDB.ts` (24 sorts). Ex.: `getPausedSales` ordena por `b.date` enquanto o listener usa `createdAt \|\| date`. |
| M | **Caches com `length >= 0`** — devolvem arrays vazios congelados para sempre (dados novos nunca aparecem sem reiniciar) | `getSales`, `getLosses`, `getTransformations`, `getPayrollPayments`, `getPausedSales`. |
| N | **`testConnection()` devolve sempre sucesso falso** (`{ success: true, latencyMs: 38 }` hardcoded) | Painel de Técnico → Nuvem: o técnico acredita que a ligação está boa quando não está. |
| O | **`getProducts()` devolve referências partilhadas da cache** — módulos que fazem `prod.stockQty = …` sujam a cache mesmo quando a gravação falha | `firebaseDB.ts`. |
| P | **Auditoria pode deitar abaixo a operação principal** e mensagens de erro genéricas («Erro ao gravar.») sem causa nem acção | Vários módulos. |
| Q | Sem indicador global de **«Sem ligação à internet»** — o operador não sabe que as escritas estão a acumular pendências | `App.tsx`. |

---

## 2. Plano de Correcção (executado nesta sessão)

### Fase 1 — Infraestrutura de feedback (novos ficheiros)
- [x] `src/utils/idHelper.ts` — `uid(prefix)` com timestamp + sequência + aleatório (fim das colisões **K**).
- [x] `src/utils/errorHelper.ts` — `describeError()` traduz códigos do Firestore (`permission-denied`, `unavailable`, …) para mensagens accionáveis em PT (**H/P**).
- [x] `src/components/Toast.tsx` — toast global via `createPortal` para `document.body` com `z-[9999]` (fica **sempre por cima** dos modais) (**A/I**).
- [x] `src/components/ConfirmDialog.tsx` — diálogo de confirmação próprio (substitui `window.confirm` bloqueado em iframes) (**J**).

### Fase 2 — Bug 1: venda retroativa
- [x] Estado de gravação no botão («A gravar…», duplo-clique bloqueado) (**B**).
- [x] **Erro visível dentro do modal** (nunca depende só do toast) (**A**).
- [x] Validação da data/hora (inválida ou futura) antes de gravar (**D**).
- [x] Watchdog de 8 s: se o Firestore não responder, o operador é avisado («a ligação está lenta…») em vez de ver um botão morto (**C**).
- [x] IDs únicos via `uid()` (**E**) + `createdAt` separado da data real da venda.
- [x] Escrita atómica venda+stock mantida (já existente), auditoria não bloqueante.

### Fase 3 — Bug 2: utilizadores
- [x] Na edição, o campo da palavra-passe **fica vazio** — vazio = manter a palavra-passe atual (**F**).
- [x] A política oficial (4–6 caracteres) só é aplicada a uma palavra-passe **nova**; hashes/senhas legadas deixam de bloquear a gravação (**F**).
- [x] Validação de username duplicado (case-insensitive) (**G**).
- [x] `hashPassword` dentro do `try`; erros traduzidos e accionáveis (**H**).

### Fase 4 — Problemas idênticos no resto do sistema
- [x] `Toast` portal em todos os módulos com notificações (PDV, Stock, Technical, Faturas, Finance, HR, TransformationView) — o toast do PDV passa a ser global (visível em qualquer tab e sobre qualquer modal) (**I**).
- [x] `ConfirmDialog` + `askConfirm` em todos os `window.confirm` restantes (Technical ×7, Stock ×2, TransformationView ×1) (**J**).
- [x] Substituição sistemática de IDs `Date.now()` por `uid()` em todo o código (62 pontos) (**K**).
- [x] `firebaseDB.ts`: ordenações defensivas (1 registo inválido já não rebenta listas), caches `length > 0`, `getProducts()` com cópias, `addAuditLog` nunca lança, `testConnection`/`probeDatabaseHealth` com sonda real de escrita+leitura, `isOnline()` (**L/M/N/O/P**).
- [x] `App.tsx`: banda global «Sem ligação à internet» quando `navigator.onLine` é falso (**Q**).

### Fase 5 — Verificação
- [x] `npx tsc --noEmit` sem erros.
- [x] `npm test` (suite master + novos testes das helpers de id/erro/decisão de palavra-passe).

---

## 3. Riscos e decisões técnicas

1. **Não abortamos escritas do Firestore por timeout** — um watchdog que cancelasse a
   escrita poderia duplicar vendas (o operador repetia). O watchdog apenas **informa**;
   a escrita continua em segundo plano e o fluxo trata do resultado quando ele chegar.
2. **Palavra-passe vazia na edição = manter atual** — comportamento padrão de painéis de
   administração; evita rejeitar contas antigas e evita reescrever hashes sem necessidade.
3. **IDs únicos com `uid()`** são retro-compatíveis (`prefixo + base36 + sequência + aleatório`)
   e não alteram a semântica de IDs existentes — apenas impedem colisões futuras.
4. **`window.confirm` substituído** por diálogo React próprio: em iframes sandbox (e em
   navegadores com políticas restritivas) o `confirm()` nativo é bloqueado ou suprimido,
   o que se traduz em botões que «não fazem nada».

---

## 4. Recomendações futuras (fora do âmbito desta correcção)

- Migrar o estado global de toasts para um único `ToastProvider` (React Context) e
  simplificar o estado duplicado em cada módulo.
- Adicionar testes E2E (Playwright) sobre os fluxos críticos: venda PDV, venda retroativa,
  gravação de utilizador, cancelamento/liquidação de fatura.
- Revisar as regras do Firestore (`firestore.rules` está `allow read, write: if true`) —
  em produção deve existir autenticação e regras por coleção.
- Introduzir fila offline persistente com reenvio automático para operações críticas.
