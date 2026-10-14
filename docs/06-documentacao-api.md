# 🔌 DOCUMENTAÇÃO DA API
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026

O AgroChicomo é uma SPA que acede directamente ao **Firebase Firestore**. Esta documentação descreve a API interna da camada de dados (`src/utils/firebaseDB.ts` · `dbService`) e o esquema das coleções. Não existe API HTTP pública em produção.

---

## 1. Modelo de Dados (Firestore)

### 1.1. `products` — Produtos
| Campo | Tipo | Descrição |
|---|---|---|
| id | string | código (ex. `15448812`) |
| name, description, category, supplier, brand, origin | string | |
| baseUnit, parentUnit | string | ex. `kg` / `Saco` |
| conversionRate | number | unidades base por unidade-mãe |
| stockQtyBulk, stockQtyRetail, stockQty | number | stock retalho/atacado/total |
| buyingPrice, buyingPriceBulk | number | custo |
| sellingPrice, sellingPriceBulk, sellingPriceRetail | number | venda |
| isService, allowFractionalQty, isPhysicalProduct | boolean | |
| expiryDate, photoUrl, barcodeUrl, createdAt | string | |

### 1.2. `sales` — Vendas (imutáveis)
| Campo | Tipo | Descrição |
|---|---|---|
| id | string | UUID (antes: timestamp) |
| invoiceNumber, receiptNumber | string | ex. `FAC-2026-0123`, `REC-POS-2026-0456` |
| date | string | ISO local |
| items[] | ItemVenda | `{productId, code, name, quantity, unitPrice, costPrice, total, unit*}` |
| subtotal, discount, total, ivaAmount, includeIva | number/bool | valores gravados são imutáveis |
| paymentMethod, paymentMethodBreakdown | string/map | múltiplo por método |
| status | `'Pendente'\|'Paga'\|'Cancelada'` | |
| documentType | `'recibo'\|'factura'\|'proforma'` | |
| operatorId, operatorName, customer* | | |

### 1.3. Outras coleções
`paused_sales` (carrinhos pausados) · `customers` · `losses` · `transformations` · `employees` · `attendance` · `payroll_payments` · `credentials` · `active_sessions` · `settings` (doc `global`) · `counters` · `audit_logs` (+ `audit_logs_archive`).

---

## 2. API da Camada de Dados (`dbService`)

### 2.1. Produtos
```ts
getProducts(refresh = false): Promise<Product[]>       // cache + fallback
getAllOrFail('products'): Promise<Product[]>           // estrito: falha ≠ vazio
saveProduct(p: Product): Promise<void>                 // upsert
saveProducts(list: Product[]): Promise<void>           // batch
deleteProduct(id: string): Promise<void>
deductProductStock(items: ItemVenda[]): Promise<void>  // batch (dentro da venda)
```

### 2.2. Vendas
```ts
addSale(sale: Sale): Promise<void>                     // resiliente: nunca perde a venda
addSaleWithStockDeduction(sale, items): Promise<{ok: boolean}>  // atómico
cancelSaleWithStockRestoration(saleId): Promise<void>  // estorno de stock
getSales(refresh = false): Promise<Sale[]>             // cache + filtros client-side
getSalesSummaryForced(): Promise<SalesSummary[]>       // agregação com páginação do servidor
```
> **Garantia:** `addSale` guarda a venda mesmo se a numeração automática falhar (usa numeração de emergência) e nunca lança erro que invalide a venda já gravada.

### 2.3. Numeração transaccional
```ts
// src/utils/sequenceHelper.ts
generateNextInvoiceNumber(invoiceNumbers): string      // local (fallback)
reserveDocumentNumber(generatedNumber, reserver):
  Promise<string>
// reserver = (counterKey, minimumNext) => dbService.nextDocumentNumber(counterKey, minimumNext)

// src/utils/firebaseDB.ts
nextDocumentNumber(counterKey, minimumNext): Promise<number>
// runTransaction sobre counters/{key}: next = max(current+1, minimumNext)
// Chaves: 'FAC-2026', 'FP-2026', 'REC-POS-2026', 'REC-A4-2026'
```

### 2.4. Utilizadores e sessões
```ts
getCredentials(refresh = false): Promise<User[]>       // [] quando vazio (sem seeding)
saveCredential(u: User): Promise<void>
deleteCredential(id: string): Promise<void>            // 'admin' bloqueado
saveSession(s: ActiveSession): Promise<void>
removeSession(id: string): Promise<void>
```
> Hashing: `verifyPassword`/`hashPassword`/`needsPasswordRehash` em `securityHelper.ts` (PBKDF2 `pbkdf2:120000:SALT:HASH`).

### 2.5. Stock e operações
```ts
addLoss(l: StockLoss): Promise<void>
saveLosses(list): Promise<void>
saveTransformations(list): Promise<void>
deductStockFromBatch(items): Promise<void>
```

### 2.6. Definições
```ts
getSettings(): Promise<SystemSettings>                 // cache 30 s
saveSettings(s: SystemSettings): Promise<void>
```

### 2.7. Auditoria
```ts
logAudit(action, level, status, details): Promise<void>   // com fila offline
getAuditLogsPaginated(pageSize, cursor?): Promise<LogsPage>
archiveOldLogs(): Promise<void>                          // arquivo, sem eliminação
```

### 2.8. Backups
```ts
exportFullBackup(): Promise<string>                    // JSON de todas as coleções
importFullBackup(json: string): Promise<void>          // upsert por coleção
resetProductsToInitial(): Promise<void>                // repõe catálogo inicial
```

---

## 3. Endpoints de Desenvolvimento (`server.ts`)

> **Não existem em produção.** Disponíveis apenas com `npm run dev`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/backup/download` | Exporta todas as coleções para JSON |
| POST | `/api/backup/upload` | Importa backup JSON |
| POST | `/api/backup/sync-pull` | Sincroniza de outro servidor |
| POST | `/api/backup/sync-push` | Envia para outro servidor |
| GET | `/api/backup/download-log` | Log de auditoria em ficheiro |
| POST | `/api/firebase-admin/sync-all` | Sync Firebase → IndexedDB local (bloqueado por `MASTER_SYNC_KEY`) |
| POST | `/api/validate-ean13` | Validação de código de barras |

Servidor dev executa em `http://localhost:3001`.

---

## 4. Formatos de Documento (impressão)

| Documento | Formato | Notas |
|---|---|---|
| Factura A4 | jsPDF A4 | cabeçalho com logo + dados da empresa |
| Factura Proforma | jsPDF A4 | não deduz stock |
| Recibo A4 | jsPDF A4 | |
| Recibo térmico | ESC-POS (Web Serial) / PDF 80mm | |
| Double A5 | jsPDF A5 dupla | layout da empresa |

---

## 5. Erros e Resiliência

- Falhas de rede em leituras críticas → `getAllOrFail` lança erro claro (nunca "lista vazia");
- Escritas de venda → commit atómico + numeração transaccional com fallback;
- Auditoria → fila em `localStorage` reenviada quando a ligação volta;
- `safeStorage` → fallback em memória quando o armazenamento do navegador está bloqueado.
