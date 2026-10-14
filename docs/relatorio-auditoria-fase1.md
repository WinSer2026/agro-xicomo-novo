# 📋 RELATÓRIO DE AUDITORIA COMPLETA — SISTEMA AGROCHICOMO
## FASE 1: Auditoria e Diagnóstico do Código-Fonte

| | |
|---|---|
| **Sistema** | AGRO — XICOMO & SERVIÇOS, LDA (ERP/POS agrícola) |
| **Repositório** | `WinSer2026/agro-xicomo-novo` (privado) |
| **Branch analisada** | `arena/057f0ece-agro-xicomo-novo` (base: `main` @ `bb2ef4d`) |
| **Produção** | https://agro-xicomo-novo.vercel.app (Vercel, plano free) |
| **Data da auditoria** | 14 de Outubro de 2026 |
| **Âmbito** | Auditoria linha-por-linha de 100% do código-fonte (~32.300 linhas em 66 ficheiros) |
| **Estado do build** | ✅ `tsc --noEmit` sem erros · ✅ 41/41 testes unitários a passar |
| **Classificação geral** | 🔴 **RISCO ALTO EM PRODUÇÃO** — dados de venda e credenciais expostos a qualquer pessoa com acesso à aplicação |

> **Nota de método:** esta auditoria foi feita com acesso directo ao repositório clonado (a forma mais eficaz, conforme autorizado pelo cliente). Cada achado indica o ficheiro e a linha do código que o comprova. Nenhum dado de produção foi alterado — a auditoria é 100% de leitura.

---

## ÍNDICE

1. [Sumário Executivo](#1-sumário-executivo)
2. [Diagnóstico Técnico Real do Sistema](#2-diagnóstico-técnico-real-do-sistema)
3. [Causa Raiz dos Três Problemas Críticos Reportados](#3-causa-raiz-dos-três-problemas-críticos-reportados)
4. [Achados de Segurança](#4-achados-de-segurança)
5. [Achados de Funcionalidade e Notificações](#5-achados-de-funcionalidade-e-notificações)
6. [Auditoria do Painel Técnico](#6-auditoria-do-painel-técnico)
7. [Auditoria de Base de Dados e Concorrência](#7-auditoria-de-base-de-dados-e-concorrência)
8. [Auditoria de Qualidade de Código e Dependências](#8-auditoria-de-qualidade-de-código-e-dependências)
9. [Achados Adicionais (não reportados pelo cliente)](#9-achados-adicionais-não-reportados-pelo-cliente)
10. [Mapa de Funcionalidades Actuais](#10-mapa-de-funcionalidades-actuais)
11. [Riscos às Regras Invioláveis](#11-riscos-às-regras-invioláveis)
12. [Resumo de Prioridades (entrada para a FASE 2)](#12-resumo-de-prioridades-entrada-para-a-fase-2)
13. [Apêndices](#13-apêndices)

---

## 1. SUMÁRIO EXECUTIVO

Foram identificados **48 problemas**, dos quais **7 críticos**, **14 graves**, **16 moderados** e **11 baixos/informativos**. Os três problemas que o cliente descreve como "diários" — perda de credenciais, alteração espontânea de hierarquias e perda de sessões — **têm causa raiz identificada e comprovada no código**, descrita na [Secção 3](#3-causa-raiz-dos-três-problemas-críticos-reportados). Não é aleatório nem "misterioso": é um conjunto de defeitos concretos e reproduzíveis.

### 🔴 Os 7 achados críticos

| ID | Achado | Impacto directo |
|----|--------|-----------------|
| **S-01** | Regras do Firestore totalmente abertas: `allow read, write: if true` (`firestore.rules:5`) | **Qualquer pessoa** que abra a aplicação pode ler/apagar TODAS as vendas, credenciais e dados, directamente da nuvem |
| **S-02** | Chave mestre de emergência hardcoded no código do navegador (`admin`/`mazive` + `0147`/`admin`/`05082`) (`LoginPanel.tsx:164`) | Qualquer pessoa que veja o código da página entra como **Técnico** sem credenciais |
| **S-03** | Códigos de desbloqueio de stock `05082`/`0147` embutidos no código **e escritos na própria interface** (`StockModule.tsx:165-167, 2987`) | Qualquer operador (ou intruso) autoriza ajustes e eliminações de stock |
| **A-01** | O "reset de credenciais" corre em **todos os computadores**, no arranque, e reescreve contas/roles quando a leitura falha (`credentialsReset.ts` + `App.tsx:194`) | **É a causa da perda diária de passwords e da mudança "mágica" de hierarquias** |
| **A-02** | `getAll()` engole erros de rede e devolve `[]`; o sistema interpreta "vazio" como "sem dados" e **grava dados por cima** (`firebaseDB.ts:388-397`, `1294-1316`) | Em qualquer falha temporária de rede, contas e catálogo podem ser reescritos |
| **D-01** | Numeração de facturas/recibos calculada **no navegador** de cada vendedor (`sequenceHelper.ts`) | Dois vendedores simultâneos geram **facturas com o mesmo número** |
| **T-05** | Botões "Eliminar Histórico de Teste" / "Zerar Sistema" apagam **TODAS as vendas reais** sem backup (`firebaseDB.ts:1548+`, `FaturasModule.tsx:181-198`) | Risco directo de destruição do histórico de vendas (viola a regra inviolável nº 1) |

### Resposta directa às perguntas do cliente

| Pergunta | Resposta |
|----------|----------|
| Por que perco as credenciais todos os dias? | O reset automático de credenciais reescreve as contas oficiais (password temporária + role do "seed") sempre que a leitura da base falha ou falta o campo `passwordResetVersion` — ver **A-01/A-02**. |
| Por que as hierarquias mudam sozinhas? | O mesmo reset **repõe os roles para os valores fixos da lista oficial** (`src/data/credentialsReset.ts`), revertendo alterações feitas pelo gestor — ver **A-01**. |
| Por que perco as sessões? | Bloqueio automático por 5 min de inactividade (`App.tsx:141`), sessão guardada em `sessionStorage` (perdida em crash de aba) e remoção forçada em erros de parse — ver **A-04**. |
| Por que as notificações não desaparecem? | Não existe sistema unificado de notificações: 8 caminhos de código lançam toasts **sem timer de auto-fecho** (ex.: `StockModule.tsx:280, 2368, 2553, 3026`) e nenhum tem botão de fechar — ver **F-01**. |
| O que sobra no painel técnico? | Proposta de painel limpo na [Secção 6.3](#63-proposta-de-painel-técnico-limpo): remover 2 tabs inteiras ficcionais (Nuvem/PostgreSQL, IA), os botões destrutivos e os indicadores falsos. |

---

## 2. DIAGNÓSTICO TÉCNICO REAL DO SISTEMA

### 2.1. Stack real (confirmada no código — não é Next.js)

| Camada | Tecnologia real | Observação |
|---|---|---|
| **Frontend** | React 19 + Vite 6 + TypeScript 5.8 + Tailwind CSS 4 | SPA (aplicação de página única) |
| **Backend** | **Não existe em produção** | O `server.ts` (Express) só serve o ambiente de desenvolvimento. A Vercel publica apenas ficheiros estáticos (`vercel.json`) |
| **Base de dados** | **Firebase Firestore** (projecto `gen-lang-client-0896153566`, base `ai-studio-remixagroxicomoe-...`) | Configuração em `firebase-applet-config.json` |
| **Autenticação** | **Implementação própria** (coleção `credentials` no Firestore) | **Não** usa Firebase Auth / NextAuth / Supabase Auth |
| **Sincronização** | Listeners `onSnapshot` do Firestore (tempo real) + cache em `localStorage` | Multi-dispositivo real funciona via Firestore |
| **Deploy** | Vercel (plano gratuito, `framework: vite`) | ✅ dentro do requisito de custo zero |
| **Extras** | PWA (`vite-plugin-pwa`), jsPDF (facturas), html5-qrcode (scanner), recharts (gráficos), xlsx (Excel), `@google/genai` (IA) | Ícones PWA em falta (**O-01**) |

**Origem do projecto:** `metadata.json` indica que a aplicação foi importada do Google AI Studio ("Remix … Imported from GitHub"), o que explica resíduos de outras stacks (`.env.example` fala de Supabase; o painel técnico fala de "Firebase PostgreSQL").

### 2.2. Estrutura real do repositório (66 ficheiros de código/configuração)

```
agro-xicomo-novo/
├── server.ts                    ← Express DE DEV (não vai para produção)
├── vite.config.ts · tsconfig.json · vercel.json · package.json
├── firebase-applet-config.json  ← config Firebase (contém web API key)
├── firestore.rules              ← 🔴 REGRAS ABERTAS
├── firestore.indexes.json · firebase.json · firebase-blueprint.json
├── fix_pdv.cjs · fix_pdv.js · fix_pdv_more.cjs · fix_stock_loss.cjs
│   replace_double_a5.cjs · pdv.patch · update_stock.patch   ← lixo técnico (Q-02)
├── public/logo.png              ← Ícones PWA do manifest NÃO existem
├── src/
│   ├── App.tsx                  ← shell, sessão, gate de módulos, alertas
│   ├── types.ts                 ← modelos de dados
│   ├── components/
│   │   ├── LoginPanel.tsx           (722)   ← 🔴 chave mestre, MFA falso
│   │   ├── PDVModule.tsx            (4559)  ← ponto de venda
│   │   ├── StockModule.tsx          (4288)  ← 🔴 códigos 05082/0147
│   │   ├── TechnicalModule.tsx      (2652)  ← painel técnico
│   │   ├── HRModule.tsx             (2450)  ← recursos humanos
│   │   ├── FinanceModule.tsx        (2344)  ← contabilidade
│   │   ├── FaturasModule.tsx        (1611)  ← facturas/recibos + 🔴 eliminar histórico
│   │   ├── EmployeeDetailModal · TransformationModal · TransformationView
│   │   ├── DashboardModule · DatabaseSchemaViewer · InlineHeaderSearch
│   │   ├── Barcode13 · DateRangeFilter · StockAIEntry
│   ├── utils/
│   │   ├── firebaseDB.ts          (1706)  ← camada de dados Firestore
│   │   ├── indexedDB.ts           (1993)  ← ☠️ CÓDIGO MORTO (não importado)
│   │   ├── credentialsReset.ts    (137)   ← 🔴 reset automático de contas
│   │   ├── securityHelper.ts      (116)   ← hash SHA-256 + fallback plaintext
│   │   ├── roleHelper · safeStorage · sequenceHelper · postCommit
│   │   ├── pdfGenerator · posHardware · reportExporter · migrateStock · …
│   └── data/
│       ├── credentialsReset.ts    ← 🔴 lista oficial de contas + hashes no código
│       └── initialProducts · companyInfo · stockListUpdate
├── test/master_plan_test.ts       (194)   ← 41 testes (helpers puros)
└── docs/firestore-scaling.md
```

### 2.3. Estado de saúde verificado

| Verificação | Resultado |
|---|---|
| `npm run lint` (`tsc --noEmit`) | ✅ 0 erros de tipo |
| `npm test` | ✅ 41/41 testes a passar (cobrem apenas funções auxiliares — ver **Q-08**) |
| `npm audit` (deps de produção) | 🔴 **14 vulnerabilidades** — 1 crítica, 9 altas (ver **V-01**) |
| Deploy Vercel | ⚠️ Funcional, mas sem headers de segurança (**S-12**) e com rotas `/api/*` a devolver HTML (**O-07**) |

---

## 3. CAUSA RAIZ DOS TRÊS PROBLEMAS CRÍTICOS REPORTADOS

### 3.1. 🔴 Perda frequente de credenciais — **CAUSA IDENTIFICADA (A-01 + A-02)**

**Mecanismo defeituoso, passo a passo:**

1. Em **todos** os computadores, no arranque, `App.tsx:194` chama `runCredentialsReset()`.
2. Esse reset lê as contas com `dbService.getCredentials()`.
3. **Defeito A-02:** `getAll()` (`firebaseDB.ts:388-397`) tem `catch { return [] }` — se a rede oscilar, a resposta é **lista vazia**, indistinguível de "não existem contas".
4. **Defeito A-01:** com a lista vazia (ou com contas sem o campo `passwordResetVersion`), o reset (`src/utils/credentialsReset.ts:36-52`) conclui que o reset "ainda não foi aplicado" e **reescreve todas as contas oficiais** (Mazive, admin, Salvador, gestor1, Nelson, Vanda, Ainara, Ainira, Maria) com:
   - a **palavra-passe temporária fixa** (hashes hardcoded em `src/data/credentialsReset.ts`) — a password que o operador escolheu é substituída;
   - o **role fixo da lista oficial** — a hierarquia que o gestor definiu é substituída;
   - `mustChangePassword: true` — o operador é forçado a mudar a password outra vez.
5. Como existe um listener `onSnapshot` na coleção `credentials` (`firebaseDB.ts:189-201`), esta reescrita **propaga-se instantaneamente a todos os computadores**, que também a copiam para o `localStorage` (`agro_credentials_cache`).

**Factores agravantes:**
- As contas criadas/editadas no painel técnico podem ficar **sem** `passwordResetVersion` (`TechnicalModule.tsx:455` guarda `editingUser?.passwordResetVersion`, que é `undefined` em contas antigas) → o reset ataca-as no arranque seguinte.
- Cada vez que a equipa técnica incrementar `CREDENTIALS_RESET_VERSION` (actualmente `2`), **todas** as contas voltam a ser repisas.
- O login tem ainda um "fallback" que usa as credenciais oficiais hardcoded se a base devolver lista vazia (`LoginPanel.tsx:219-223`), reforçando a ilusão de que as contas "voltaram ao original".

> **Conclusão:** os operadores não fazem nada de errado. O sistema está, por construção, a redefinir credenciais e roles em condições normais de instabilidade de rede ou de contas sem o campo de controlo.

### 3.2. 🔴 Alteração involuntária de hierarquias — **CAUSA IDENTIFICADA (A-01)**

Mesmo mecanismo: `runCredentialsReset()` **repõe sempre os roles da lista oficial** para qualquer conta oficial que considere "não-resetada". Exemplo concreto: se o gestor promover `Maria` de *Operador* a *Gestor de Stock*, o próximo reset com `passwordResetVersion` em falta devolve-a a *Operador*; se mudar `Salvador` para outro perfil, volta a *Gestor Geral*. O usuário vê exatamente o sintoma relatado: "acordei e o sistema tinha-me atribuído outro perfil".

**Agravante de segurança (S-07 + F-01):** o "Assistente IA" do painel técnico também cria contas (`TechnicalModule.tsx:814`) com `passwordHash: u.password || u.passwordHash || '123456'` — ou seja, **palavra-passe em texto plano ou `123456` por defeito**, que depois interagem com o mesmo sistema de resets.

### 3.3. 🔴 Perda de sessões — **CAUSA IDENTIFICADA (A-04)**

| Causa | Evidência | Efeito |
|---|---|---|
| Bloqueio automático após **5 minutos** de inactividade (mouse/teclado) | `App.tsx:141` (`diff >= 300000`) | O operador é "desligado" a meio do trabalho; o carrinho parcial só sobrevive porque há um autosave local |
| Sessão guardada em `sessionStorage` | `App.tsx:200, 286` | Crash de aba/navegador = sessão perdida |
| Qualquer erro de parse do utilizador guardado remove a sessão | `App.tsx:231-234` | Logout silencioso |
| Registo de sessões activas (`active_sessions`) sem heartbeat/limpeza robusta | `firebaseDB.ts:1201-1230` | Sessões órfãs acumulam; o painel mostra contagens enganadoras |

Nota: **não existe** expiração de token nem invalidação server-side — a "sessão" é apenas um objecto em `sessionStorage` (**S-14**), o que também significa que é forjável por qualquer utilizador do browser.

---

## 4. ACHADOS DE SEGURANÇA

### 4.1. Matriz completa

| ID | Gravidade | Achado | Evidência |
|----|-----------|--------|-----------|
| **S-01** | 🔴 Crítico | **Regras do Firestore completamente abertas** — `allow read, write: if true` para qualquer documento. Com a web API key presente no bundle da aplicação (que é pública por natureza), qualquer visitante pode, com 10 linhas de JavaScript, **ler, alterar ou apagar todas as vendas, credenciais, salários e dados da empresa** | `firestore.rules:5` |
| **S-02** | 🔴 Crítico | **Chave mestre de emergência hardcoded**: `mazive` ou `admin` + `0147`/`admin`/`05082` entra como **Técnico**, ignora lockout e CAPTCHA. Está no JavaScript entregue ao navegador | `LoginPanel.tsx:164-167` |
| **S-03** | 🔴 Crítico | **Códigos de stock hardcoded** `05082` e `0147` aceites como fallback em TODAS as operações sensíveis de stock (ajuste, eliminação, sincronização) — e **escritos na própria UI** ("Insira a senha … (código: 05082 ou 0147)") | `StockModule.tsx:165-167, 207-209, 1446-1448, 1577-1579, 2987, 3079` |
| **S-04** | 🔴 Crítico | **Credenciais expostas**: coleção `credentials` legível por qualquer um (ver S-01); hashes copiados para `localStorage` (`agro_credentials_cache`); backups completos do sistema incluem credenciais (`exportAllData`, `firebaseDB.ts:1379-1420`) e são guardados no `localStorage` a cada 10 min | `firebaseDB.ts:189-201, 1379+, 1520+` |
| **S-05** | 🟠 Grave | **Passwords fracas por desenho**: SHA-256 rápido (sem KDF tipo bcrypt/Argon2), política de **4 a 6 caracteres**, sem símbolos obrigatórios, reutilização permitida (`securityHelper.ts:85-100`); **fallback de texto plano** na verificação (`password === storedHash`) | `securityHelper.ts:27-29` |
| **S-06** | 🟠 Grave | **MFA/2FA é teatro**: `if (mfaCode === '123456' || mfaCode === '000000' || true)` — **qualquer código de 6 dígitos passa**; o "QR Code" é um desenho SVG decorativo; `mfaSecret = 'MAZIVE2FA'+Date.now()` não é TOTP | `LoginPanel.tsx:351, 354, 648-700` |
| **S-07** | 🟠 Grave | O assistente IA cria utilizadores com **password em texto plano** ou default `'123456'` | `TechnicalModule.tsx:814` |
| **S-08** | 🟠 Grave | **Anti-brute-force só no browser** (contador e lockout em `localStorage` — basta limpar o armazenamento) e no `server.ts`, que **não existe em produção** | `LoginPanel.tsx:36-60, 258-263` |
| **S-09** | 🟠 Grave | **IPs de auditoria falsos**: `'197.218.10.' + Math.random()` nos logs de login; `127.0.0.1` noutras operações. Os registos de auditoria não servem para investigação real | `LoginPanel.tsx:161, 323, 348`; `App.tsx:146` |
| **S-10** | 🟡 Moderado | `stockPasswordHash` guarda o código de stock em **texto plano** (nome enganoso); default `'05082'` | `firebaseDB.ts:1236`, `TechnicalModule.tsx:559` |
| **S-11** | 🟡 Moderado | CSP do `server.ts` com `'unsafe-inline' 'unsafe-eval'` e qualquer `https:` — e mesmo isso só existe em dev | `server.ts:90-95` |
| **S-12** | 🟡 Moderado | **Sem headers de segurança em produção** (o `vercel.json` não define `X-Frame-Options`, `CSP`, `HSTS`, etc.) | `vercel.json` |
| **S-13** | 🟠 Grave | `importAllData` reescreve vendas/credenciais sem validação nem transacção única; `exportAllData` exporta hashes de passwords para ficheiros JSON | `firebaseDB.ts:1444-1510` |
| **S-14** | 🟡 Moderado | Sessão = objecto não assinado em `sessionStorage` (`agro_current_user`); editável pelo utilizador do browser para elevar perfis na interface | `App.tsx:200, 286` |

### 4.2. Nota sobre a web API key do Firebase

O ficheiro `firebase-applet-config.json` (com `apiKey`) está no repositório e no bundle. **Isto é normal e esperado no Firebase** — a segurança deveria vir das regras do Firestore. O problema não é a chave em si: é a combinação **chave pública + regras abertas (S-01)**, que equivale a uma base de dados sem porta.

---

## 5. ACHADOS DE FUNCIONALIDADE E NOTIFICAÇÕES

| ID | Gravidade | Achado | Evidência |
|----|-----------|--------|-----------|
| **F-01** | 🟠 Grave | **Sistema de notificações defeituoso (o defeito reportado)**: não existe serviço unificado — cada módulo tem o seu próprio toast. Vários caminhos chamam `setToastMessage()` **sem timer de auto-fecho**, ficando visíveis para sempre; nenhum toast tem botão de fechar; não há fila (timers concorrentes limpam toasts novos). | Sem auto-fecho: `StockModule.tsx:280, 2368, 2384, 2553, 2570, 2682, 2737, 3026`. Com timer (3-4s): `PDVModule.tsx:763-766`, `FaturasModule.tsx:75-80`, `FinanceModule.tsx:93-96`, `HRModule.tsx:346-349`, `TechnicalModule.tsx:288-291` |
| **F-02** | 🟡 Moderado | O banner "Venda Anterior não Finalizada" e o sino de "Alertas de Stock Crítico" não têm auto-fecho (comportamento aceitável, mas contribuem para a sensação de acumulação visual) | `PDVModule.tsx:1788+`; `App.tsx` (sino) |
| **F-03** | 🟠 Grave | **Login cruzado `ainara`/`ainira`**: entra-se com o username errado, e o registo de auditoria mostra o nome introduzido, não o real | `LoginPanel.tsx:228-229` |
| **F-04** | 🟠 Grave | **MFA inoperante** (ver S-06) — a interface promete Google Authenticator que não existe | `LoginPanel.tsx:337-366` |
| **F-05** | 🟡 Moderado | Indicador "Sincronização" do cabeçalho é **falso**: `isSSEActive()` devolve sempre `true`, `getPendingCount()` sempre `0`, `getLastSyncTime()` devolve o relógio actual | `firebaseDB.ts:1662-1664` |
| **F-06** | 🟡 Moderado | `reconcileStock()` ("Reconciliação de Stock") devolve **sempre** `difference = 0` com o comentário `// Synchronized baseline` — o relatório de discrepância nunca encontra problemas | `firebaseDB.ts:1620-1645` |
| **F-07** | 🟡 Moderado | MFA: fluxo nunca termina em `mfaEnabled` real; `show2FASetup` apresenta QR falso | `LoginPanel.tsx:648-700` |

---

## 6. AUDITORIA DO PAINEL TÉCNICO

### 6.1. Inventário actual (tab por tab)

| Tab / Sub-tab | Conteúdo | Veredicto | Justificação |
|---|---|---|---|
| **Definições › Empresa** | Nome, NUIT, logo, morada, contactos | ✅ **Necessária** | Configuração operacional real |
| **Definições › Bancos** | Dados bancários, M-Pesa, E-Mola | ✅ **Necessária** | Aparecem nos documentos de venda |
| **Definições › Impressoras** | Impressora térmica série, layout | ✅ **Necessária** | Operação do PDV |
| **Definições › Backups** | Exportar/importar JSON | ⚠️ **Manter, corrigir** | Útil, mas exporta credenciais (S-13) e o import não é seguro |
| **Definições › Sistema** | Código de stock, **"Eliminar Histórico de Teste"**, **"Zerar Sistema"** | ⚠️ **Parcial / 🔴 perigoso** | O código de stock é necessário (mas deve ser hash real); os botões destrutivos **apagam vendas** e devem sair da interface (T-05) |
| **Utilizadores** | Criar/editar/eliminar contas e roles | ✅ **Necessária** | Core da gestão de permissões |
| **Logs de Auditoria** | Histórico + arquivo (paginado) | ✅ **Necessária** | Monitorização real (melhorar IPs — S-09) |
| **Sessões** | Sessões activas + "Limpar sessões órfãs" | ✅ **Necessária** | Útil para suporte |
| **Cloud & Firebase PostgreSQL** | URL do servidor, "anon key", "Testar Conexão", "Sincronização em Massa (11 Tabelas)" | 🔴 **REMOVER — é ficção** | Fala de **PostgreSQL** (não existe), RLS (é do Supabase), "Modo Local (IndexedDB)" (não está em uso). Os botões estão ligados a *stubs* que **devolvem sempre sucesso** com latência inventada (`firebaseDB.ts:1680-1690`: `latencyMs: 38`) |
| **Schema (DatabaseSchemaViewer)** | Visualizador do esquema da base | ⚠️ **Manter só leitura** | Útil para diagnóstico; sem botões de alteração |
| **Assistente IA** (via `ai_assistant`) | Prompt → Gemini → "aplicar alterações" | 🔴 **REMOVER ou isolar** | O endpoint `/api/gemini/technician-ai` **não existe em produção** (o `server.ts` não é publicado) → não funciona; quando funciona em dev, aplica alterações perigosas (S-07) |

### 6.2. Funcionalidades "que parecem fazer algo e não fazem" (ilusão de controlo)

| ID | Elemento | O que promete | O que faz de facto |
|----|----------|---------------|---------------------|
| **T-01** | Tab "Gestão da Nuvem & Firebase PostgreSQL" | Configurar servidor, testar ligação, sincronizar 11 tabelas | Stubs que devolvem `{success: true}` fixo (`firebaseDB.ts:1675-1692`) |
| **T-02** | "Assistente IA" | Analisar e aplicar melhorias ao sistema | Endpoint inexistente em produção; cria contas com passwords fracas quando ativo |
| **T-03** | "Reconciliação de Stock" | Comparar stock registado vs calculado | Devolve `difference = 0` sempre (`firebaseDB.ts:1620-1645`) |
| **T-04** | Indicadores de sincronização do cabeçalho | Estado real da ligação | Constantes: `true`, `0`, relógio actual (`firebaseDB.ts:1662-1664`) |
| **T-05** | "Eliminar Histórico de Teste" / "Zerar Sistema" | Limpar dados de demonstração | **Apaga vendas reais** da base de produção sem backup (`clearSystemData`, `firebaseDB.ts:1548+`) |
| **T-06** | MFA / QR Code do login | 2 fatores real | Qualquer código passa (S-06) |

### 6.3. Proposta de Painel Técnico Limpo

```
PAINEL TÉCNICO (após limpeza)
├── Definições
│   ├── Empresa .............. ✅ manter (nome, NUIT, logo, contactos)
│   ├── Bancos ............... ✅ manter
│   ├── Impressoras .......... ✅ manter
│   ├── Backups .............. ✅ manter + corrigir (sem credenciais no export; import validado)
│   └── Sistema .............. ✅ manter APENAS: código de stock (hash real), nível de stock crítico
├── Utilizadores ............. ✅ manter (criar/editar/perfis — passa a ser a ÚNICA forma de mudar hierarquias)
├── Auditoria ................ ✅ manter (logs + arquivo, IP real)
├── Sessões .................. ✅ manter (listar + terminar sessão individual)
└── Diagnóstico .............. ✅ manter (schema em só-leitura + estado REAL da ligação Firestore)

REMOVIDO:
✗ Cloud & Firebase PostgreSQL (T-01)
✗ Assistente IA (T-02)
✗ Reconciliação fictícia (T-03 → substituir por cálculo real OU remover)
✗ "Eliminar Histórico de Teste" / "Zerar Sistema" (T-05 → nunca em produção)
✗ Indicadores falsos (T-04 → substituir por estado real ou remover)
```

**Critério aplicado (do documento do cliente):** *se a funcionalidade não pode ser efectivamente executada a partir da interface, não deve estar no painel.*

---

## 7. AUDITORIA DE BASE DE DADOS E CONCORRÊNCIA

| ID | Gravidade | Achado | Evidência |
|----|-----------|--------|-----------|
| **D-01** | 🔴 Crítico | **Numeração de facturas/recibos não atómica**: cada PDV calcula o próximo número a partir da lista local (`getSales()` + `max+1`). Com dois vendedores simultâneos (o cenário central do negócio!), **ambos geram o mesmo número** de factura/recibo | `sequenceHelper.ts:8-50`; `PDVModule.tsx:1333-1339` |
| **D-02** | 🟠 Grave | **Stock pode ficar negativo**: a dedução é atómica (`writeBatch` + `increment`, ✅ bem feito em `addSaleWithStockDeduction`), **mas não há validação server-side de stock suficiente** — a verificação é só no cliente; duas vendas simultâneas do último artigo vendem 2 unidades com stock 1 | `firebaseDB.ts:776-829` |
| **D-03** | 🔴 Crítico | **Escritas destrutivas por engano de leitura**: `getAll()` → `[]` em erro + auto-seed em `getProducts()` ("se 0 produtos, grava o catálogo inicial") e `getCredentials()` ("se 0 contas, grava o admin inicial") — qualquer falha de rede pode **injetar dados de demonstração na base real** | `firebaseDB.ts:388-397, 548-556, 1294-1316` |
| **D-04** | 🟠 Grave | `clearSystemData()` apaga **doc-a-doc** (não atómico, lento, sem backup prévio) todas as vendas, quebras, salários, presenças, transformações e vendas pausadas | `firebaseDB.ts:1548-1560` |
| **D-05** | 🟡 Moderado | **Backup "automático" é apenas `localStorage`** do próprio navegador (máx. 3 cópias, incluindo credenciais). Se o navegador for reinstalado/purgado, perde-se tudo. O `server.ts` tem endpoints de backup em ficheiro, mas **não existem em produção** | `firebaseDB.ts:1505-1545`; `server.ts:121-180` |
| **D-06** | 🟡 Moderado | IDs de venda `sale-`+`Date.now()` e logs `log-`+`Date.now()` — colisão possível entre dispositivos no mesmo milissegundo (dois PDVs) | `PDVModule.tsx:1344`; `LoginPanel.tsx:196` |
| **D-07** | 🟡 Moderado | Só existem **2 índices compostos** (`firestore.indexes.json`); algumas consultas com filtros+ordenação não têm índice adequado à medida que as vendas crescerem | `firestore.indexes.json` |
| **D-08** | 🟡 Moderado | Integridade referencial: itens de venda guardam `productId`/`name` sem verificação; eliminação de produto não verifica vendas históricas (não quebra as vendas antigas ✅ — snapshot — mas gera "órfãos" por design) | `types.ts:38-56` |
| **D-09** | ✅ Positivo | **Bons exemplos a preservar**: dedução/estorno de stock em batch atómico; snapshot de custo por item (`costPrice` permanente na venda); pós-commit isolado (`postCommit.ts`); paginação de facturas/auditoria com cursor (docs/firestore-scaling.md) | vários |

---

## 8. AUDITORIA DE QUALIDADE DE CÓDIGO E DEPENDÊNCIAS

| ID | Gravidade | Achado | Evidência |
|----|-----------|--------|-----------|
| **Q-01** | 🟡 Moderado | **192 chamadas `console.log/warn/error`** de debug no código de produção (vazam nomes de utilizadores, IDs, totais) | grep `console.` em `src/` |
| **Q-02** | 🟡 Moderado | **Lixo técnico na raiz**: `fix_pdv.cjs`, `fix_pdv.js`, `fix_pdv_more.cjs`, `fix_stock_loss.cjs`, `replace_double_a5.cjs`, `pdv.patch`, `update_stock.patch` — scripts de "arranjo" por substituição de texto que reescreviam o `PDVModule.tsx` | raiz do repositório |
| **Q-03** | 🟡 Moderado | **`src/utils/indexedDB.ts` (1993 linhas) é código morto** — não é importado por ninguém; contém chamadas a `/api/sync/*` e `EventSource('/api/sync/events')` que não existem | não referenciado |
| **Q-04** | 🟡 Moderado | Resíduos de stacks antigas: `.env.example` com `VITE_SUPABASE_*`; `firebase-blueprint.json` com todos os documentos com `schema: "Sale"` (ficção); `metadata.json` do AI Studio | raiz |
| **Q-05** | 🟡 Moderado | **Componentes gigantes**: `PDVModule.tsx` (4.559 linhas), `StockModule.tsx` (4.288), `TechnicalModule.tsx` (2.652) — dificultam manutenção e revisão | `wc -l` |
| **Q-06** | 🟡 Moderado | `bun.lock` **e** `package-lock.json` ambos versionados (gerem-se dois gestores de pacotes) | raiz |
| **Q-07** | 🟡 Moderado | Nomes enganosos: `stockPasswordHash` (texto plano), `passwordHash: 'simulated encrypted/hashed'` (`types.ts:332`), `isSSEActive` (não há SSE) | vários |
| **Q-08** | 🟠 Grave | **Testes insuficientes para um ERP em produção**: 41 testes cobrem helpers puros (datas, hash, paginação). **Zero testes** aos fluxos críticos: login, finalização de venda, dedução de stock, numeração, resets | `test/master_plan_test.ts` |
| **Q-09** | ✅ Positivo | `tsc --noEmit` limpo; tipagem TypeScript consistente; módulos lazy-loaded; `postCommit.ts` bem desenhado | — |
| **V-01** | 🟠 Grave | **`npm audit`: 14 vulnerabilidades** (1 crítica, 9 altas, 3 moderadas, 1 baixa). Destaques: **`xlsx` (SheetJS)** — prototype pollution + ReDoS, **sem correção disponível** (usado nas exportações Excel); `firebase`/`@grpc/grpc-js`; `proxy-addr` (crítica); `dompurify` (XSS); `express` (dev) | `npm audit` |
| **V-02** | 🟡 Moderado | Dependências duplicadas: `vite` em `dependencies` **e** `devDependencies` | `package.json` |

---

## 9. ACHADOS ADICIONAIS (NÃO REPORTADOS PELO CLIENTE)

Conforme instrução ("focar também nas coisas que posso ter me esquecido"), foram ainda identificados:

| ID | Gravidade | Achado | Detalhe |
|----|-----------|--------|---------|
| **O-01** | 🟡 | **PWA quebrada**: o manifest (`vite.config.ts:20-27`) aponta para `pwa-192x192.png` e `pwa-512x512.png` que **não existem** em `public/` (só há `logo.png`) | Instalação como app falha |
| **O-02** | 🟡 | **Datas e fusos**: mistura de `new Date().toISOString()` (UTC), `getDate()` local e `formatDatePT`; relatórios podem mostrar dias errados perto da meia-noite | `PDVModule`, `dateRangeHelper` |
| **O-03** | 🟡 | **Acessibilidade**: quase sem `aria-label`, navegação por teclado limitada em módulos críticos, contraste fraco em textos `[8px]`/`[10px]` | múltiplos ficheiros |
| **O-04** | 🟡 | **Responsividade**: PDV/Stock desenhados para desktop; em tablets/telemóveis (comuns em armazém) a operação é difícil | classes Tailwind |
| **O-05** | 🟡 | **Sem modo offline real**: o cache do Firestore ajuda, mas a UI não distingue "online/offline"; o "Modo Local" do painel é fictício. Vendas offline não têm fila de reenvio dedicada (só logs de auditoria têm fila) | `firebaseDB.ts` |
| **O-06** | 🟡 | **Retenção de auditoria**: existe arquivo manual ✅, mas sem política automática (ex.: arquivar > 12 meses) e os IPs são falsos (S-09) | `TechnicalModule.tsx:295+` |
| **O-07** | 🟡 | **Rotas `/api/*` em produção devolvem o `index.html`** (rewrite `/(.*)`) — os erros do assistente IA aparecem como "Erro do Servidor (200): \<title\>…" confusos | `vercel.json:5-8` |
| **O-08** | 🟡 | **Projecto Firebase pessoal de desenvolvimento** (`gen-lang-client-...` do AI Studio) em vez de projecto produtivo dedicado, com nome de base `ai-studio-remix...` | `firebase-applet-config.json`, `firebase.json` |
| **O-09** | 🔵 | **Sem monitorização/logs server-side** (não há servidor); diagnóstico depende do que o operador relata | — |
| **O-10** | 🔵 | **Sem política de passwords para o futuro**: reutilização livre + 4-6 caracteres torna qualquer força bruta trivial (mesmo com hash corrigido) | `securityHelper.ts:85-100` |
| **O-11** | 🔵 | **`AGENTS.md` autoriza alterações automáticas sem revisão** — arriscado num sistema em produção com regras invioláveis de dados; recomendo pontos de aprovação (como o documento do cliente exige) | `AGENTS.md` |

---

## 10. MAPA DE FUNCIONALIDADES ACTUAIS

Inventário completo do que existe hoje no código (base para o futuro SRS):

| Área | Funcionalidade | Estado |
|---|---|---|
| **PDV** | Carrinho, pesquisa/scanner (html5-qrcode + EAN-13), categorias, imagens, descontos por linha, IVA opcional, pagamento múltiplo (Dinheiro/M-Pesa/E-Mola/Transferência/Crédito/Múltiplo), pausar/retomar venda, recuperação de carrinho, clientes, atalhos F1-F5 | ✅ Funcional |
| **PDV** | Finalização → factura (A4/Proforma/Double A5) / recibo térmico (ESC/POS) / recibo A4, gaveta de caixa, som "cha-ching" | ✅ Funcional (numeração com race condition — D-01) |
| **Facturas** | Listagens paginadas, filtros por período/estado, liquidar, cancelar com estorno de stock, restaurar, exportar Excel/PDF | ✅ Funcional |
| **Stock** | Catálogo paginado, CRUD produtos, unidades híbridas (saco↔kg), códigos de barras EAN-13, etiquetas, entradas/saídas/quebras, inventário físico, transformações (reembalagem) com conservação de custo, relatórios | ✅ Funcional (portas de segurança fracas — S-03) |
| **Preços** | Preço de compra/venda/atacado, validação compra < venda, snapshot de custo na venda, margens | ✅ Funcional |
| **Utilizadores** | CRUD contas, 6 perfis, multi-perfil por utilizador, MFA (falso), reset global de credenciais (defeituoso) | 🟠 Parcial (A-01, S-06) |
| **RH** | Funcionários, assiduidade, férias, disciplinar, danos, salários, subsídios, INSS/AT (Modelo 2), SISSMO, fotos | ✅ Funcional |
| **Finanças** | DRE simplificada, receitas/despesas, caixa, movimentos, relatórios por período | ✅ Funcional |
| **Painel técnico** | Ver Secção 6 | 🟠 Parcial (limpeza necessária) |
| **Notificações** | Toasts por módulo + sino de stock crítico + banner de carrinho | 🟠 Defeituoso (F-01) |
| **Auditoria** | Log de eventos + arquivo paginado | ✅ Funcional (IPs falsos — S-09) |
| **Multi-utilizador** | Listeners Firestore em tempo real, sessões activas, gate de módulos | ✅ Base funcional (correcções em A-04, D-01, D-02) |

---

## 11. RISCOS ÀS REGRAS INVIOLÁVEIS

Regra do cliente vs realidade do código:

| Regra inviolável | Situação actual | Risco |
|---|---|---|
| **"Não perder nenhuma venda"** | Existem **dois botões na interface** que apagam todas as vendas (`clearSystemData` via "Eliminar Histórico de Teste" no Faturas e no Painel Técnico, e "Zerar Sistema"). Não há backup automático real (só localStorage). Com as regras do Firestore abertas, qualquer um pode apagar vendas remotamente | 🔴 **CRÍTICO** — remover botões (T-05), fechar regras (S-01), backup real antes de qualquer intervenção |
| **"Não alterar valores monetários"** | Os cálculos de total/IVA/desconto estão correctos e testados (Test Suite 4 ✅). Não foram encontrados erros de aritmética monetária | 🟡 Risco baixo — preservar; a numeração de facturas (D-01) precisa de correção transacional sem tocar em valores |
| **"Sem agredir a base de dados"** | Os resets/migrações correm **em todos os clientes no arranque** (`runStockMigration`, `runStockListUpdate`, `runHybridPriceMigration`, `runCredentialsReset`) e escrevem na BD activa | 🔴 **CRÍTICO** — este é o mecanismo que está a "agredir" a BD diariamente (A-01/A-02/D-03) |
| **"Preservar novas funcionalidades"** | Todas as mapeadas na Secção 10 serão preservadas; a FASE 3 corrigirá sem remover (salvo as falsas, que serão substituídas por equivalentes reais ou eliminadas por serem enganadoras — a decidir pelo cliente) | ✅ |
| **"Custo zero"** | Vercel free + Firebase Spark (free tier) + bibliotecas open-source. Todas as soluções propostas na FASE 2 manter-se-ão gratuitas (o plano gratuito do Firebase Spark comporta o volume actual; se crescer, o Blaze tem custo zero até limites generosos) | ✅ |

---

## 12. RESUMO DE PRIORIDADES (ENTRADA PARA A FASE 2)

> O detalhe das soluções será apresentado na **FASE 2 — Plano de Melhorias**, para aprovação antes de qualquer alteração de código.

**Onda 0 — Imediata (segurança de dados, sem tocar no código de negócio):**
1. Fechar as regras do Firestore (S-01) — *alteração de configuração da BD, requer as devidas cautelas*;
2. Backup completo do Firestore antes de tudo (D-05);
3. Remover/esconder os botões de eliminação de vendas (T-05).

**Onda 1 — Causa raiz dos problemas diários:**
4. Corrigir `getAll()` para **falhar visivelmente** em vez de devolver `[]` (A-02/D-03);
5. Reescrever o fluxo de reset de credenciais — execução única controlada, nunca reescrever contas existentes (A-01);
6. Sessões estáveis: rever bloqueio de 5 min, persistência da sessão (A-04).

**Onda 2 — Segurança de autenticação:**
7. Remover chaves mestres hardcoded (S-02, S-03);
8. Password hashing forte + migração gradual (S-05);
9. MFA real ou remoção do MFA falso (S-06);
10. Rate limiting real e IPs de auditoria verdadeiros (S-08, S-09).

**Onda 3 — Robustez multi-utilizador:**
11. Numeração transacional de facturas/recibos (D-01);
12. Validade de stock server-side (D-02).

**Onda 4 — UX e limpeza:**
13. Sistema unificado de notificações com auto-fecho + botão fechar (F-01);
14. Painel técnico limpo (Secção 6.3);
15. Limpeza de código morto/lixo (Q-02, Q-03, Q-04), dependências (V-01), PWA (O-01).

**Onda 5 — Documentação obrigatória (FASE 4):**
16. SRS, Manual do Utilizador, Arquitectura, Matriz RBAC, Plano de Segurança, API, Backup/Recuperação, Changelog.

---

## 13. APÊNDICES

### A. `package.json` (stack declarada)

```json
{
  "name": "agro-xicomo-e-servicos-lda",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts ...",
    "lint": "tsc --noEmit",
    "test": "tsx test/master_plan_test.ts"
  },
  "dependencies": {
    "@google/genai", "@tailwindcss/vite", "@tanstack/react-query", "@vitejs/plugin-react",
    "dotenv", "express", "firebase", "html5-qrcode", "jspdf", "jspdf-autotable",
    "lucide-react", "motion", "react", "react-dom", "recharts", "vite",
    "vite-plugin-pwa", "xlsx"
  }
}
```

### B. Regras do Firestore actuais (integral)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;   // ← S-01: acesso total ao mundo
    }
  }
}
```

### C. Resumo `npm audit` (produção)

```
CRITICAL  proxy-addr (IP spoofing)
HIGH      xlsx (prototype pollution + ReDoS — SEM correção disponível)
HIGH      firebase → @firebase/firestore → @grpc/grpc-js
HIGH      brace-expansion, fast-uri, nanoid, source-map-js, dompurify
TOTAL: 14 vulnerabilidades (1 critical, 9 high, 3 moderate, 1 low)
```

### D. Resultado dos testes executados nesta auditoria

```
tsc --noEmit .............. ✅ 0 erros
npm test .................. ✅ 41 Passed, 0 Failed
   (Datas/Intervalos · Hash/Segurança · Transformações/custo · Margens snapshot ·
    Categorias/diacríticos · Unidades · Post-commit · Paginação/arquivo)
```

### E. Metodologia aplicada

1. Clonagem e navegação directa do repositório (todas as branches disponíveis);
2. Leitura integral dos 66 ficheiros de código/configuração (~32.300 linhas), com destaque para autenticação, sessões, dados e painel técnico;
3. Rastreamento estático dos fluxos: login → sessão → módulos; venda → stock → factura; reset → credenciais → roles;
4. Verificação dinâmica: `npm ci`, `tsc`, `npm test`, `npm audit`;
5. Classificação de cada achado por gravidade (🔴 Crítico · 🟠 Grave · 🟡 Moderado · 🔵 Baixo) com evidência `ficheiro:linha`.

---

**FIM DA FASE 1 — AUDITORIA E DIAGNÓSTICO**

*Próximo passo: apresentação deste relatório ao cliente → aprovação → FASE 2 (Plano de Melhorias detalhado, com soluções, ordem de implementação, riscos e mitigações).*
