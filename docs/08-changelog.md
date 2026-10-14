# 📝 CHANGELOG — AGRO — XICOMO & SERVIÇOS, LDA

Formato inspirado em Keep a Changelog · Sistema: AgroChicomo (ERP/POS)

---

## [Não publicado] — 2026-10-14 · Auditoria e Melhorias (FASE 1–5)

### Adicionado
- **Numeração transaccional de facturas e recibos** (contadores Firestore + transacção): elimina números duplicados quando vários vendedores finalizam vendas ao mesmo tempo (achado D-01 da auditoria).
- **IDs de venda com UUID** (substitui `Date.now()` — sem colisões).
- **ToastBanner unificado** (`src/components/ToastBanner.tsx`): notificações com auto-fecho de 5 segundos e botão de fechar, acessíveis (`aria-live`), em todos os módulos.
- **Bootstrap seguro de credenciais:** em instalação nova, conta `admin` com palavra-passe temporária **aleatória** exibida no ecrã de login.
- **Política de troca de palavra-passe** (`mustChangePassword`) no primeiro acesso.
- **Documentação obrigatória** (9 documentos em `docs/`): SRS, manual do utilizador, arquitectura, matriz RBAC, plano de segurança, API, plano de backup/recuperação, changelog e relatório de auditoria.

### Corrigido
- **Defeito monetário:** valores de quebras e contagens físicas calculados com campo de preço inexistente (`buyPrice`) → sempre 0 MT; agora usam `buyingPrice`/`sellingPrice` reais.
- **Ameaça D-01 (concorrência):** numeração de recibos com timestamps locais gerava colisões e renumerava recibos antigos.
- **Notificações permanentes** que bloqueavam a interface e exigiam F5 (PDV, Faturas, Stock, RH, Finanças, Painel Técnico).
- IP de auditoria falsificado (VPS externo) substituído por `'N/D'` honesto.
- Preço de venda podia ser ≤ preço de compra → validação corrigida.
- Manifest PWA apontava para ícones inexistentes (`pwa-192x192.png`) → 404 no `vite-preview` e no deploy.
- `stockPasswordHash` perdia-se entre sessões do Painel Técnico.

### Segurança
- **Removidas todas as chaves-mestres hardcoded** (login, desbloqueio de sessão, gates de módulos de factura/stock, código `05082`).
- **Palavras-passe com PBKDF2-SHA256 (120k iterações)** e migração automática de formatos legados no login.
- **Removido MFA falso** que aceitava qualquer código de 6 dígitos.
- **Removida reescrita automática de contas** (o `credentialsReset` destrutivo que repunha `admin`/`0147` e eliminava contas novas).
- Removidos hashes de credenciais oficiais do código-fonte.
- `console.log` de debug removidos (vazavam nomes de produtos, códigos e consultas).

### Removido (limpeza)
- ~5 400 linhas de código morto: `src/utils/indexedDB.ts`, `StockAIEntry.tsx`, `src/data/credentialsReset.ts`, scripts `fix_*.cjs`, `replace_double_a5.cjs`, `pdv.patch`, `update_stock.patch`, `bun.lock`.
- Tabs fictícias do Painel Técnico ("Nuvem e Sincronização" com PostgreSQL local, "Assistente IA") e stubs que fingiam conectividade (`testConnection`, `syncAll`, `reconcileStock`, indicadores SSE falsos).
- Handlers destrutivos ("Limpar Facturas e Recibos", "Limpar Contas") que apagavam vendas.
- Reset de senha de 3 tentativas por 3 dígitos; bypass de desbloqueio com senha vazia; constantes sensíveis pré-preenchidas.
- Base histórica de produtos embutida (~2 100 linhas).

### Melhorado (onde o cliente já estava a ser prejudicado, sem alterar valores)
- Leituras críticas (`products`, `credentials`) usam `getAllOrFail`: falha de rede nunca é interpretada como "base vazia".
- Vendas: commit atómico venda+stock; tarefas secundárias (PDF, gaveta, som) isoladas pós-commit — a venda nunca se perde por falha de impressão.
- Páginação de facturas e agregações no servidor; estado local por separador; exports (antes leituras completas que estouravam memória em PCs de balcão).
- Relatórios sem truncagem a meio (cabeçalho repete por página).
- Hardware POS: Web Serial (Chrome) com fallback térmico compatível.

---

## [Base] — até 2026-10-07
Sistema em produção com os módulos: PDV, Facturas, Stock & Inventário, Preços, RH, Finanças, Painel Técnico — sincronização multi-dispositivo via Firebase Firestore, deploy na Vercel. Histórico desta fase está no repositório Git (`main`).
