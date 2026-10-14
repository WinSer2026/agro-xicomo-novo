# 💾 PLANO DE BACKUP E RECUPERAÇÃO
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026 · Custo: **0 MT**

## 1. Objectivos

| Objectivo | Meta |
|---|---|
| RPO (ponto de perda aceitável) | ≤ 24 h (com exportação diária) |
| RTO (tempo de recuperação) | ≤ 1 h |
| Regra de ouro | **Sempre** um backup antes de qualquer operação estrutural ou correção de dados |

## 2. Camadas de Protecção

| Camada | Mecanismo | Onde fica | Automático? |
|---|---|---|---|
| 1. Replicação nativa | Firestore (réplicas Google) | nuvem | ✅ |
| 2. Cache local do navegador | `localStorage` (produtos, vendas) | computador do operador | ✅ |
| 3. Backups automáticos locais | Últimas **3 cópias** por utilizador (`backup_auto_0/1/2` no `localStorage`) | computador | ✅ |
| 4. **Backup completo manual** | Painel Técnico → Backups → *Descarregar Backup Completo* (JSON) | ficheiro do utilizador | manual |
| 5. Deploy | Repositório Git (`main` ↔ Vercel) | GitHub | ✅ |

## 3. Procedimento de Backup Manual (SEMANAL recomendado)

1. Login como **Técnico** → **Painel Técnico** → **Definições** → **Backups**.
2. Botão **⬇ Descarregar Backup Completo** — descarrega `backup-completo-<data>.json`.
3. Guarde o ficheiro em **dois** locais (ex.: pen drive + Google Drive gratuito).
4. Confirme que o ficheiro não está vazio (tamanho ≈ dezenas de KB a MB).
5. **Antes de qualquer correção de dados ou manutenção: faça este backup.**

### Conteúdo do backup JSON
Todas as coleções: `products`, `sales`, `customers`, `paused_sales`, `losses`, `transformations`, `employees`, `attendance`, `payroll_payments`, `credentials`, `active_sessions`, `settings`, `audit_logs` (e arquivo).

## 4. Recuperação

### 4.1. Recuperar dados completos
1. Login como Técnico → Painel Técnico → Backups.
2. **Importar Backup** → escolha o ficheiro JSON → confirmar.
3. O sistema repõe as coleções; os caches locais são limpos e a app recarrega.
4. Valide: nº de produtos, últimas 5 vendas, utilizadores, definições.

### 4.2. Recuperar apenas o catálogo de produtos
- Painel Técnico → Sistema → **Repor Catálogo Inicial** (apenas produtos — não toca em vendas).

### 4.3. Repor palavra-passe de um utilizador
- Painel Técnico → Utilizadores → repor palavra-passe.

### 4.4. Perda total do serviço (Vercel/Firebase)
1. Os dados vivem no Firestore — a app pode ser reinstalada a partir do GitHub (`git clone` → `npm ci` → `vercel deploy`).
2. Reconfigurar o `firebase-applet-config.json` se necessário (já no repositório).
3. Publicar regras: `npx firebase-tools deploy --only firestore:rules --project gen-lang-client-0896153566`.

### 4.5. Corrupção/dados errados introduzidos
1. **Não continuar a operar sobre os dados corrompidos.**
2. Exportar um backup do estado actual (para análise).
3. Importar o último backup íntegro (ver 4.1).
4. Repor manualmente o que faltar (vendas entre o backup e a corrupção — consulte o `audit_logs` e o histórico de facturas).

## 5. Responsabilidades

| Quem | O quê | Quando |
|---|---|---|
| Técnico | Backup completo manual | semanalmente + antes de manutenção |
| Técnico | Teste de recuperação (importar cópia de teste em ambiente seguro) | mensalmente |
| Gestor Geral | Confirmar que o Técnico fez o backup | mensalmente |
| Todos | Nunca pedir/colocar palavras-passe em documentos partilhados | sempre |

## 6. Limites Conhecidos (honestos)

- **Camadas 2–3 (localStorage)** ficam no computador do operador — limpar o navegador apaga-nas. A camada 4 (ficheiro) é a verdadeira.
- O backup manual **não** é versionado; guarde várias datas (pelo menos as 4 últimas semanas).
- `exportFullBackup` inclui hashes de palavras-passe — trate o ficheiro como **confidencial**.

## 7. Checklist de Emergência

```
☐ Parar operações que escrevem dados
☐ Exportar backup do estado actual
☐ Identificar o último backup íntegro (data/tamanho)
☐ Importar e validar (produtos, últimas vendas, utilizadores)
☐ Documentar o incidente (data, sintoma, acções, resultado)
☐ Ajustar o plano (o que evitar da próxima vez)
```
