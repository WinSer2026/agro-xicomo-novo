# 📐 DOCUMENTO DE ARQUITECTURA DO SISTEMA
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026

---

## 1. Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│  NAVEGADORES (PDV balcão · armazém · gestão)                    │
│  React 19 + Vite 6 (SPA) + PWA                                 │
│  ┌───────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ │
│  │ PDVModule │ │ StockMod.│ │ Faturas│ │ RH/Fin │ │ Técnico │ │
│  └─────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ └────┬────┘ │
│        └────────────┴───────────┴───────────┴───────────┘       │
│                     src/utils/firebaseDB.ts                     │
│          (caches em memória + localStorage + listeners)          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ SDK Firebase (HTTPS/WebSocket)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  FIREBASE PROJECTO gen-lang-client-0896153566                   │
│  Firestore (base ai-studio-remixagroxicomoe-…)                  │
│  ├── products · sales · customers · paused_sales                │
│  ├── credentials · active_sessions · settings                   │
│  ├── losses · transformations · employees · attendance          │
│  ├── payroll_payments · counters                                │
│  └── audit_logs · audit_logs_archive                            │
│  Regras: firestore.rules (histórico de vendas sem eliminação)   │
└─────────────────────────────────────────────────────────────────┘

Deploy: Vercel (estáticos de `vite build`, plano free)
```

## 2. Stack Tecnológico

| Camada | Tecnologia | Justificação |
|---|---|---|
| UI | React 19, TypeScript 5.8, Tailwind CSS 4 | produtividade, tipagem |
| Build | Vite 6 (+ vite-plugin-pwa) | rápido, PWA offline-first |
| Dados | Firebase Firestore (SDK v12) | tempo real multi-dispositivo, free tier |
| Gráficos | recharts | dashboards |
| PDF | jsPDF + jspdf-autotable | facturas e relatórios |
| Excel | SheetJS (`xlsx`) | exportações (apenas escrita) |
| Scanner | html5-qrcode | leitura de código de barras pela câmara |
| Servidor dev | Express (`server.ts`) | **apenas desenvolvimento** — a produção é estática |

## 3. Arquitectura de Aplicação

### 3.1. Camada de dados (`src/utils/firebaseDB.ts`)
- Classe `FirebaseDBService` (singleton `dbService`): única porta de entrada ao Firestore.
- **Caches:** products, sales, customers, credentials, sessions, settings… com invalidação por escrita e listeners `onSnapshot` (customers, credentials, sessions, settings, losses, payroll, employees, attendance, transformations).
- **Leituras estritas (`getAllOrFail`)** para `products` e `credentials`: uma falha de rede nunca é interpretada como "base vazia" (protecção contra reescritas destrutivas).
- **Escritas:** `upsert`/`upsertBatch` (450 writes/commit), `deleteRow`, batches de venda+stock (`addSaleWithStockDeduction`), estorno (`cancelSaleWithStockRestoration`).
- **Numeração:** `nextDocumentNumber()` — transacção Firestore sobre `counters/{FAC-2026, REC-POS-2026, …}`.
- **Post-commit (`postCommit.ts`):** tarefas secundárias (PDF, gaveta, refresh) nunca invalidam uma venda gravada.
- **Fila de auditoria:** logs pendentes em localStorage reenviados quando a ligação volta.

### 3.2. Estado de sessão
- `sessionStorage`: utilizador actual + id de sessão (isolamento por separador/computador);
- Bloqueio por inactividade (configurável, 15 min) com desbloqueio por palavra-passe;
- `active_sessions` no Firestore para visibilidade multi-utilizador.

### 3.3. Segurança no cliente
- `securityHelper.ts`: PBKDF2-SHA256 (120k) + migração de formatos legados;
- `safeStorage.ts`: wrapper de localStorage/sessionStorage com fallback em memória;
- Gates de módulo com re-verificação de palavra-passe.

## 4. Modelo de Dados (coleções Firestore)

| Coleção | Documento | Campos essenciais |
|---|---|---|
| `products` | produto | code, name, category, stockQty, stockQtyBulk/Retail, buyingPrice(+Bulk), sellingPrice(+Bulk), baseUnit, parentUnit, conversionRate, expiryDate, isService |
| `sales` | venda | invoiceNumber, receiptNumber, date, customer*, items[] (com snapshot costPrice), subtotal, discount, total, paymentMethod(+Breakdown), status, documentType, operator*, includeIva, ivaAmount |
| `paused_sales` | rascunho de venda | items, customer*, documentType |
| `customers` | cliente | name, nuit, address, phone |
| `losses` | quebra | productId, quantity, reason, costValue, justification |
| `transformations` | reembalagem | original*, items[] resultantes, status |
| `employees` | funcionário | name, nuit, cargo, salário, contactos, photo |
| `attendance` | assiduidade | employeeId, date, present |
| `payroll_payments` | vencimento | employeeId, month, grossWage, deductions, finalNetWage |
| `credentials` | conta | username, passwordHash (PBKDF2), role(s), mustChangePassword |
| `active_sessions` | sessão | username, role, loginTime, ipAddress |
| `settings` | `global` | empresa, bancos, impressoras, stockPasswordHash, criticalStockLevel, sessionLockMinutes |
| `counters` | contador | value (numeração transaccional) |
| `audit_logs` / `audit_logs_archive` | evento | timestamp, username, action, status, level, details |

## 5. Fluxos Principais

### 5.1. Finalizar venda (factura definitiva)
```
carrinho → valida stock → reserva nº factura/recibo (transacção)
  → batch { incrementa stock negativo + cria sale } (atómico)
  → limpa carrinho → audit log → gaveta/som → PDF/impressão (post-commit)
```

### 5.2. Login
```
username/password → getCredentials (cache → Firestore)
  → verifyPassword (PBKDF2/legado) → [migração de hash se legado]
  → mustChangePassword? → troca obrigatória : sessão activa
```

## 6. Infra-estrutura e Deploy

| Item | Detalhe |
|---|---|
| Produção | `https://agro-xicomo-novo.vercel.app` (Vercel, `vite build` → `dist/`) |
| Repostório | `WinSer2026/agro-xicomo-novo` (privado); deploy automático a partir de `main` |
| Regras Firestore | `firestore.rules` — publicadas manualmente com `npx firebase-tools deploy --only firestore:rules` |
| Índices | `firestore.indexes.json` (sales: status+date; products: category+name) |
| CI | `npm run lint` (tsc) + `npm test` (45 testes de lógica de negócio) |

## 7. Decisões de Arquitectura

| Decisão | Razão | Alternativa rejeitada |
|---|---|---|
| SPA + Firestore directo (sem backend próprio) | custo zero, tempo real, simplicidade | servidor próprio (custo/complexidade) |
| Autenticação própria sobre `credentials` | herdada; migração para Firebase Auth planeada | Firebase Auth (requer configuração na consola) |
| Numeração via transacção em `counters` | resolve concorrência sem servidor | numeração local (duplicados) |
| Post-commit isolado | nunca perder uma venda por falha de PDF | tudo-or-nothing |
| Cache localStorage + listeners | desempenho e resiliência | queries em cada render |

## 8. Limites Conhecidos

1. **Autenticação no cliente:** as regras Firestore ainda não podem validar identidade (ver `05-plano-seguranca.md`, onda futura);
2. **`server.ts` não vai para produção:** endpoints de backup/sync e rate limiting são só de desenvolvimento;
3. **Offline:** leituras funcionam com cache; escritas offline ficam pendentes no SDK do Firestore e sincronizam quando a ligação volta (sem UI dedicada de fila).
