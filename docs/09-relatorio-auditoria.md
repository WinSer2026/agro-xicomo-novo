# 🔍 RELATÓRIO DE AUDITORIA
## AGRO — XICOMO & SERVIÇOS, LDA · Outubro de 2026

> Este documento resume o resultado da auditoria completa. O detalhe técnico de cada achado está em:
> **[`relatorio-auditoria-fase1.md`](./relatorio-auditoria-fase1.md)** (relatório completo FASE 1, 15 seções).
> O procedimento operacional da primeira intervenção está em **[`runbook-onda-0-1.md`](./runbook-onda-0-1.md)**.

---

## 1. Âmbito e Metodologia

- **Âmbito:** todo o código-fonte (~32 300 linhas), configuração de infra-estrutura (Vercel, Firebase), processos de negócio e documentação — incluindo problemas não mencionados pelo cliente.
- **Metodologia:** revisão estática de código por módulo, verificação cruzada (UI ↔ camada de dados ↔ regras), análise de dependências e de configuração, testes da lógica crítica (45 testes automatizados).
- **Data:** 7 de Outubro de 2026 (FASE 1) · implementação concluída em 14 de Outubro de 2026 (FASEs 2–5).

## 2. Resumo Executivo

| Severidade | Encontrados | Resolvidos nesta intervenção | Restantes (documentados) |
|---|---|---|---|
| 🔴 Crítico | 2 | 2 | 0 |
| 🟠 Alto | 11 | 10 | 1 (migração para Firebase Auth) |
| 🟡 Médio | 8 | 7 | 1 (autenticação do lado do servidor) |
| 🔵 Baixo | 7 | 6 | 1 (política de palavras-passe a reforçar) |
| ⚪ Estética/UI | 15 | 15 | 0 |

**Os 3 piores problemas do sistema — como estavam a prejudicar o cliente:**

1. **Chaves-mestres no código:** qualquer pessoa com acesso ao repositório/código podia entrar como administrador (`ainara17`, código `05082`) e apagar o histórico de facturas e vendas. *Hoje: removidas; sensíveis exigem código configurado.*
2. **Perda de vendas:** falhas de rede/LED/estado na finalização apagavam o carrinho depois de o stock já ter sido deduzido — a venda ficava perdida e o stock desaparecia sem factura. *Hoje: a venda é gravada primeiro; impressão e som nunca a invalidam.*
3. **Facturação duplicada:** dois vendedores no mesmo segundo geravam o mesmo número de factura/recibo (IDs por `Date.now()`). *Hoje: numeração transaccional com reserva atómica.*

## 3. Matriz de Achados — Estado Final

| # | Achado | Sev. | Estado |
|---|---|---|---|
| D-01 | Numeração duplicada sob concorrência | 🔴 | ✅ Resolvido (transacção `counters`) |
| D-02 | Eliminação irreversível de histórico de facturas/vendas | 🔴 | ✅ Resolvido (handlers removidos + regras Firestore) |
| D-03 | Chaves-mestres hardcoded (login, unlock, gates) | 🟠 | ✅ Resolvido |
| D-04 | `credentialsReset` destrutivo (reescrita de contas, hash partilhado, plaintext) | 🟠 | ✅ Resolvido (bootstrap só em instalação vazia) |
| D-05 | Estado "vazio" por falha de rede → reescrita de credenciais | 🟠 | ✅ Resolvido (`getAllOrFail`) |
| D-06 | Perda de carrinho pós-dedução de stock | 🟠 | ✅ Resolvido (post-commit isolado) |
| D-07 | Falha silenciosa de dedução de stock + escreve após lança-erro | 🟠 | ✅ Resolvido (batch atómico) |
| D-08 | MFA falso (aceitava qualquer código de 6 dígitos) | 🟠 | ✅ Resolvido (removido; MFA real planeado) |
| D-09 | Conta seed `admin`/`0147` derivável + hash no código | 🟠 | ✅ Resolvido (hashes removidos, credenciais aleatórias) |
| D-10 | IP de auditoria falso (VPS externo) | 🟠 | ✅ Resolvido (`'N/D'`) |
| D-11 | Passwords em texto simples no Firestore (legado) | 🟠 | ✅ Resolvido (PBKDF2 + migração no login) |
| D-12 | Bypass de desbloqueio com senha vazia / 3 dígitos | 🟠 | ✅ Resolvido |
| D-13 | Painel técnico fictício (PostgreSQL, IA, SSE, sync) | 🟡 | ✅ Resolvido (removido) |
| D-14 | Reset de sistema apagava sessões (bloqueio total) | 🟡 | ✅ Resolvido |
| D-15 | Notificações permanentes sem fecho/auto-dismiss | 🟡 | ✅ Resolvido (ToastBanner 5 s + ✕) |
| D-16 | Preço de venda ≤ preço de compra; campo `buyPrice` inexistente (valores 0) | 🟡 | ✅ Resolvido |
| D-17 | `xlsx` sem proteção (superfície de leitura) | 🟡 | ✅ Resolvido (uso só de escrita; auditoria `npm audit`) |
| D-18 | Códigos de backup no `localStorage` (falso sentimento de segurança) | 🟡 | ✅ Resolvido (removido; plano de backup documentado) |
| D-19 | Acesso de escrita às credenciais sem autenticação (regras Firestore) | 🟠 | ⚠️ Parcial (`firestore.rules` endurecidas; migração p/ Firebase Auth pendente — fase H1) |
| D-20 | Código morto/duplicado (~5 400 linhas), scripts destrutivos no repo | 🔵 | ✅ Resolvido |
| D-21 | Falta de documentação obrigatória | 🔵 | ✅ Resolvido (9 documentos em `docs/`) |
| D-22 | IVA desactivado por omissão; gestão de IVA a rever | 🔵 | ⚠️ Mantido (regra de negócio actual — documentado; decisão do cliente) |

## 4. Cobertura das 15 Seções da Auditoria

| Secção | Foco | Resultado |
|---|---|---|
| 1–5 | Arquitectura, produtos, stock, preços, pagamentos | ✅ módulos sólidos; 2 defeitos monetários corrigidos |
| 6–7 | Facturas/recibos, suprimentos | ✅ numeração transaccional; falsos indicadores removidos |
| 8–10 | RH, admin, sincronização | ✅ agregação e paginação no servidor; stubs removidos |
| 11 | Infra-estrutura (Vercel/Firebase) | ✅ zero custo; `server.ts` apenas dev; regras endurecidas |
| 12–14 | UI, código morto, testes | ✅ 45 testes de lógica crítica; limpeza concluída |
| 15 | Sugestões e prioridades | ✅ executadas por ondas (0→5) com verificação após cada uma |

## 5. Validação Final

| Verificação | Resultado |
|---|---|
| `npm run lint` (tsc) | ✅ 0 erros |
| `npm test` (lógica de negócio: numeração, preços, descontos, stock, IVA, segurança) | ✅ 45/45 |
| `npm run build` (produção) | ✅ |
| Regras de não perda de vendas / não alteração de valores | ✅ verificadas por diff e testes |

## 6. Recomendações Prioritárias (futuro)

1. **H1 — Migrar autenticação para Firebase Auth** (grátis) e regras por `request.auth` — elimina a última classe de risco alto.
2. **H2 — Reforçar política de palavras-passe** (mínimo 8 caracteres) quando a operação estiver estabilizada.
3. **H3 — Backup semanal manual** conforme `07-plano-backup-recuperacao.md` (responsabilidade do Técnico).
4. **H4 — Teste de recuperação mensal** (importar cópia de teste).
5. Decisão de negócio: confirmar regra de IVA (desactivado por omissão) com o contabilista.

---

*Auditoria e implementação: equipa Arena AI · Encomenda: admin do sistema AgroChicomo · Todos os valores monetários do histórico foram preservados sem alterações.*
