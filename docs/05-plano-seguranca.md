# 🛡️ PLANO DE SEGURANÇA
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026 · Estado: plano em execução (ondas 0–4 concluídas)

## 1. Objectivo

Proteger: (a) o histórico de vendas e valores monetários; (b) as credenciais dos utilizadores; (c) os dados de clientes e funcionários; (d) a continuidade do serviço — dentro da restrição de **custo zero**.

## 2. Estado Actual (pós-auditoria)

### 2.1. O que já está implementado

| Área | Controlo |
|---|---|
| Palavras-passe | PBKDF2-SHA256, 120 000 iterações, sal aleatório por utilizador (`securityHelper.ts`). Migração automática de formatos legados (texto simples/sha256) no login. |
| Sem chaves-mestres | Removidos os *bypasses* hardcoded (login, desbloqueio de sessão, gates de módulos, código 05082). Sensíveis de stock exigem o código de gestor **configurado**. |
| Bootstrap | A conta inicial só é criada em instalação **vazia**, com palavra-passe temporária **aleatória** exibida uma vez. Nunca reescreve contas existentes. |
| Histórico de vendas | `firestore.rules`: `sales` sem operações de eliminação para clientes. Nenhuma eliminação de vendas na interface. |
| Numeração fiscal | Facturas/recibos reservados transaccionalmente em `counters` — sem duplicação sob concorrência. |
| Auditoria | Logs de eventos (utilizador, acção, IP `'N/D'` honesto, estado) com arquivo histórico e eliminação bloqueada na UI. |
| Sessões | Bloqueio por inactividade; isolamento por separador; gestão de sessões activas. |
| Dados sensíveis no código | Removidos hashes de credenciais, códigos e segredos do repositório. `.env.example` sem valores reais. |
| Dependências | `xlsx` usado apenas para escrita (sem superfície de leitura); remoção de código morto (~5 400 linhas). |

### 2.2. Limitações conhecidas (honestas)

| Limitação | Risco | Mitigação planeada |
|---|---|---|
| Autenticação **no cliente** (credenciais na coleção `credentials` lida pelo navegador) | Um atacante com o URL da base poderia teoricamente ler hashes; regras `allow read: if true` em várias coleções | Migrar para **Firebase Auth** (free) e regras `request.auth` + custom claims |
| Rate limiting só no `server.ts` (desenvolvimento) | Força-bruta remota não bloqueada no servidor | O limite local (3→CAPTCHA, 5→bloqueio 15 min) é o principal controlo; endurecer com Firebase Auth |
| MFA inexistente | — | Só com Firebase Auth (TOTP/telefone); a UI fictícia foi removida |
| IP de auditoria `'N/D'` | Menos forense | Sem servidor próprio não há IP fiável; obter via serviço gratuito é viável mas pode ser enganoso |

## 3. Políticas

1. **Palavra-passe:** mínimo de 4 caracteres (letras/números) — política histórica da empresa; recomenda-se evoluir para 8+.
2. **Troca obrigatória** no primeiro acesso de contas criadas por um Técnico (`mustChangePassword`).
3. **Nunca** alterar valores monetários de vendas gravadas.
4. **Backups antes de qualquer alteração estrutural** (ver `07-plano-backup-recuperacao.md`).
5. **Princípio do menor privilégio:** perfis com acesso mínimo (matriz em `04-matriz-permissoes-rbac.md`).
6. **Transparência:** sem indicadores falsos; a UI mostra apenas o que o sistema faz de facto.

## 4. Plano de Endurecimento (próximas fases)

| Fase | Acção | Custo | Dependências |
|---|---|---|---|
| H1 | Firebase Auth (email/password ou custom tokens) com claims de perfil | 0 | configuração na consola Firebase |
| H2 | Regras Firestore por coleção com `request.auth.token.role` | 0 | H1 |
| H3 | Regras para `credentials`/`settings` só por admin; hashes nunca acima do necessário | 0 | H1 |
| H4 | MFA real (TOTP) via Firebase Auth | 0 | H1 |
| H5 | Monitorização de acessos (relatório mensal de auditoria) | 0 | — |

> Nota: as operações de consola (activar Auth, publicar regras com `npx firebase-tools deploy --only firestore:rules --project gen-lang-client-0896153566`) são passos manuais do cliente — ver `docs/runbook-onda-0-1.md`.

## 5. Resposta a Incidentes

1. **Suspeita de compromisso de conta:** Técnico → Utilizadores → repor palavra-passe; revogar sessões em Sessões.
2. **Suspeita de adulteração de dados:** exportar backup imediato; comparar com backups anteriores; auditar `audit_logs`.
3. **Perda de acesso administrativo:** conta `admin` de recuperação (não eliminável); credenciais de bootstrap exibidas apenas na instalação — guardar com segurança.
4. **Indisponibilidade da Vercel/Firebase:** a aplicação mantém caches locais; operação crítica (vendas) continua e sincroniza quando o serviço volta.

## 6. Conformidade

- **Lei moçambicana de protecção de dados (Lei n.º 11/2021):** dados pessoais de clientes/funcionários com acesso restrito por perfil; sem exportação não autorizada.
- **AT/INSS:** documentos fiscais gerados com numeração sequencial contínua e sem alteração retroactiva de valores.
