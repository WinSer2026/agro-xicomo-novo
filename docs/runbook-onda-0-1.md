# 🛠️ RUNBOOK — ONDA 0/1 (Correcções de Emergência)
## Implantação segura das correcções aprovadas após a FASE 1

> **Escopo aprovado pelo cliente:** remoção dos botões destrutivos, correcção da
> causa raiz da perda de credenciais/hierarquias, sessões mais estáveis e
> protecção inicial do histórico de vendas. Nenhuma alteração toca em valores
> monetários nem na estrutura das vendas.

---

## 1. O que mudou (resumo)

| # | Alteração | Achado | Ficheiro |
|---|-----------|--------|----------|
| 1 | Removidos os botões/handlers "Eliminar Histórico de Teste", "Zerar Sistema" e "Novo Exercício Fiscal" (apagavam vendas reais) | T-05 | `src/components/TechnicalModule.tsx`, `src/components/FaturasModule.tsx` |
| 2 | `clearSystemData()` agora exige frase de confirmação explícita (`APAGAR VENDAS`) — sem entrada na interface | T-05 | `src/utils/firebaseDB.ts` |
| 3 | Leituras críticas (`products`, `credentials`) falham em vez de devolver listas vazias — elimina a reescrita de contas/catálogo por falha de rede | A-02 / D-03 | `src/utils/firebaseDB.ts` |
| 4 | Reset de credenciais **nunca mais** reescreve palavra-passe/perfis de contas existentes nem recria contas eliminadas; só cria contas iniciais em instalação nova | A-01 | `src/utils/credentialsReset.ts` |
| 5 | Bloqueio de sessão por inactividade: 15 min por predefinição (antes 5), configurável no Painel Técnico → Definições → Sistema | A-04 | `src/App.tsx`, `src/components/TechnicalModule.tsx`, `src/types.ts` |
| 6 | Gravação de vendas resiliente: falha ao ler o catálogo de produtos não impede registar a venda | D-02 | `src/utils/firebaseDB.ts` |
| 7 | Novas regras do Firestore: **eliminações na coleção `sales` proibidas**; apenas colecções legítimas existem | S-01 (parcial) | `firestore.rules` |
| 8 | Painel técnico: substituída a caixa de reset destrutivo por atalho de backup + aviso de protecção do histórico | T-05 | `src/components/TechnicalModule.tsx` |

---

## 2. Procedimento de implantação (por ordem)

### Passo 1 — ⚠️ BACKUP OBRIGATÓRIO ANTES DE TUDO

1. Abrir a aplicação em produção → **Painel Técnico → Definições → Backups**;
2. Clicar em **Descarregar Backup Completo Agora** (ou o botão equivalente de exportação JSON);
3. Guardar o ficheiro `*.json` em local seguro (disco externo / Google Drive da empresa);
4. **Confirmar que o ficheiro abre e contém `sales`, `products`, `credentials`** antes de prosseguir.

> Sem backup verificado, NÃO continuar.

### Passo 2 — Deploy do código (Vercel)

1. Merge do branch `arena/057f0ece-agro-xicomo-novo` para `main` (via Pull Request);
2. A Vercel faz o build automaticamente (`vite build`);
3. Verificar que o deploy terminou sem erros.

### Passo 3 — Publicar as regras do Firestore

```bash
npx firebase-tools deploy --only firestore:rules --project gen-lang-client-0896153566
```

- Requer autentação Firebase CLI na conta do projecto (`npx firebase-tools login`);
- As regras novas **proíbem eliminações de vendas** e fecham colecções desconhecidas;
- Se alguma funcionalidade deixar de funcionar após publicar as regras, ver Secção 4 (Rollback).

### Passo 4 — Verificação pós-deploy (checklist)

- [ ] Login de um operador normal funciona;
- [ ] O operador **não** é forçado a mudar a palavra-passe (o reset já não reescreve contas);
- [ ] Login de um gestor mantém o perfil correcto (sem "mudanças" de hierarquia);
- [ ] Finalizar uma venda de teste → aparece no histórico e o stock é deduzido;
- [ ] A venda de teste **aparece** no histórico de Facturas;
- [ ] Painel Técnico → Sistema: **já não existem** botões de eliminação de histórico;
- [ ] O campo "Bloqueio de Sessão por Inactividade (min)" existe e está a 15 (ou ao valor desejado);
- [ ] Após 15 min sem actividade, a sessão **bloqueia** (não termina) e o carrinho pode ser recuperado;
- [ ] Duas vendas seguidas → notificação aparece e **desaparece** (nota: o defeito completo de notificações será corrigido na Onda 4).

### Passo 5 — Comunicar aos operadores

- As palavras-passe existentes **deixam de ser repostas** sozinhas;
- Quem tiver problemas de acesso agora, deve pedir redefinição ao administrador (Painel Técnico → Utilizadores);
- O histórico de vendas passa a ser permanente — não há botão de eliminação.

---

## 3. Limites conscientes desta onda (a resolver nas próximas)

| Tema | Estado actual | Onda |
|---|---|---|
| Regras do Firestore: leituras/escritas ainda abertas (autenticação é no cliente) | Intermediário | 2 — Firebase Auth + regras por utilizador |
| Chave mestre `admin`/`0147`/`05082` no código | Mantida (remoção exige fluxo de recuperação) | 2 |
| Hash de palavras-passe SHA-256 (deveria ser Argon2/bcrypt) | Mantido (migração gradual) | 2 |
| MFA falso | Mantido | 2 |
| Numeração de facturas em race condition | Mantida | 3 |
| Notificações sem auto-fecho | Parcial | 4 |
| Painel técnico (tabs fictícias Nuvem/IA) | Parcial | 4 |

---

## 4. Rollback (se necessário)

| Problema | Acção |
|---|---|
| Login deixa de funcionar após deploy do código | Reverter o merge na `main` (a Vercel redesploya a versão anterior) |
| Regras do Firestore bloqueiam algo essencial | Reverter `firestore.rules` para `allow read, write: if true` **temporariamente** e reportar de imediato (não recomendado manter) |
| Necessidade urgente de limpar dados de teste | **Nunca** pela interface. Contactar suporte técnico: backup primeiro + procedimento documentado de manutenção |

---

*Documento produzido na FASE 1/3 do projecto de auditoria AgroChicomo — 14/10/2026.*
