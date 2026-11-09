# Segurança — o que mudou e o que falta fazer

Documento operacional. Complementa `docs/auditoria-pdv.md` (achados L‑01 a L‑04 e K‑01).

## 1. Palavras‑passe que estavam no código (corrigido)

| Onde | Antes | Agora |
|---|---|---|
| Login | `Mazive` / `admin` entravam com `0147`, `admin` ou `05082` | Removido. Só entra quem tiver a palavra‑passe guardada em hash na credencial. |
| Desbloqueio de sessão | Mesma chave mestra | Removido. Valida a palavra‑passe do utilizador da sessão. |
| Autorização de stock (eliminar produto, inventário físico, ajuste manual) | `settings.stockPasswordHash` em texto simples **ou** `05082` **ou** `0147` | `verifyAuthorizationPassword()`: hash com salt quando existe, texto simples legado caso contrário. As palavras‑passe universais `05082`/`0147` deixaram de ser aceites. |
| Cancelamento de fatura | Idem | Idem. |
| Ecrã de esquema da base | `INSERT ... '0147'` | Removido. |

### Repor o acesso de um operador

Sem a chave mestra, a reposição faz‑se gerando um hash novo e gravando‑o na credencial:

```bash
node scripts/hash-password.mjs "nova-palavra-passe"
# → sha256:xxxxxxxxxxxxxxxx:9f2c...
```

1. Firebase → Firestore → coleção `credentials` → documento do utilizador → campo `passwordHash`.
2. O utilizador entra com essa palavra‑passe e o sistema pede a troca, como já acontecia.

O mesmo serve para `settings.stockPasswordHash` (palavra‑passe de autorização do gestor de stock).

## 2. API local (`server.ts`) — corrigido

`/api/sync/save`, `/api/sync/save-batch`, `/api/sync/delete`, `/api/sync`, `/api/backup*` não tinham
qualquer verificação: qualquer cliente que alcançasse o servidor podia substituir ou apagar a base
local (`data/db.json`).

Agora cada pedido tem de provar uma de duas coisas:

- `x-sync-token` igual a `SYNC_API_TOKEN` (integrações, scripts, outros postos);
- ou ser um pedido da mesma origem (`Sec-Fetch-Site: same-origin` ou `Origin` == `Host`).

Além disso, só é possível escrever nas coleções conhecidas (`SYNCABLE_STORES`), o que impede criar
chaves arbitrárias no ficheiro de dados a partir do corpo do pedido.

Para integrações externas, defina as duas variáveis com o **mesmo** valor:

```bash
SYNC_API_TOKEN=<segredo>            # servidor
VITE_SYNC_API_TOKEN=<segredo>       # build do frontend
```

Sem `SYNC_API_TOKEN`, o servidor avisa no arranque e aceita apenas pedidos da mesma origem.

## 3. Regras do Firestore — passo a passo da publicação

O ficheiro `firestore.rules` deixou de ser `allow read, write: if true` (que expunha vendas,
credenciais e salários a qualquer pessoa com o *projectId*, que está no bundle) e passa a exigir
`request.auth != null`.

**A ordem importa.** Se publicar as regras antes de ativar o login anónimo, a aplicação deixa de
conseguir ler e escrever no Firestore.

- Projecto: `gen-lang-client-0896153566`
- Base de dados Firestore (nomeada): `ai-studio-remixagroxicomoe-5bee6408-7aeb-4603-9bb5-b56ad6507335`
- Ficheiro de regras: `firestore.rules` (o `firebase.json` já aponta para esta base)

### Passo 1 — Ativar o login anónimo

1. Abra <https://console.firebase.google.com> e escolha o projecto **gen-lang-client-0896153566**.
2. No menu lateral: **Authentication** (criar utilizadores e sessões).
3. Separador **Sign-in method** (método de início de sessão).
4. Na lista de fornecedores, clique em **Anónimo**.
5. Ligue o interruptor **Ativar** e clique em **Guardar**.

Fica a **Authentication → Users** com um utilizador anónimo novo por cada navegador/posto. É normal:
a aplicação cria a sessão no arranque e reutiliza-a.

### Passo 2 — Confirmar que a aplicação continua a funcionar (ainda com as regras antigas)

1. Abra a aplicação e entre com um utilizador.
2. Confirme que produtos, vendas e definições aparecem.
3. Abra as ferramentas do programador (F12) → **Console**. Não deve haver
   `Missing or insufficient permissions`.

Se houver esse erro aqui, o problema é do login anónimo — volte ao Passo 1 antes de continuar.

### Passo 3 — Publicar as regras

**Opção A — pela consola (sem instalar nada, recomendada):**

1. Console Firebase → **Firestore Database** → separador **Rules**.
2. Abra o ficheiro `firestore.rules` do projecto, copie **todo** o conteúdo e cole no editor,
   substituindo o que lá está.
3. Clique em **Publish** (publicar).
4. Confirme que o painel mostra a data/hora da publicação e que o conteúdo é o novo.

**Opção B — pela linha de comandos:**

```bash
npx firebase-tools login           # abre o browser; autentique-se com a conta do projeto
npx firebase-tools deploy --only firestore:rules
```

O `firebase.json` já define a base de dados nomeada, por isso o comando publica no sítio certo.
No fim deve aparecer `✔ firestore: released rules` com o nome da base.

### Passo 4 — Provar que ficou seguro e funcional

Na consola do Firebase → Firestore → **Rules** existe um **simulador** (Rules Playground):

- Pedido **não autenticado** a `products` → deve dar **Denied**. É a prova de que a base deixou de
  estar aberta.
- Pedido **autenticado** (simular autenticação) a `products` → **Allowed**.

Na aplicação, faça o teste completo:

1. Entrar, abrir o PDV, registar uma venda de teste.
2. Confirmar que a venda aparece nas Faturas e que o stock baixou.
3. Stock → **Movimentos** num artigo → deve aparecer a linha da venda (livro de movimentos).
4. Módulo técnico → **Verificar numeração** (deve abrir sem erro) e **Arquivar lote seguro**
   de auditoria (usa permissão de eliminação em `audit_logs`).

### Passo 5 — Se algo falhar (reverter)

Sintoma típico: a aplicação abre mas listas vazias e o console mostra `permission-denied`.

1. Console → Firestore → **Rules** → ícone de histórico (versões) → restaurar a versão anterior →
   **Publish**.
2. Corrigir a causa (normalmente: login anónimo não ativado, ou uma coleção nova sem regra) e
   repetir.

O ficheiro `firestore.rules.legacy-open` tem as regras antigas **apenas para consulta** — não deve
ser publicado, porque é exatamente a configuração insegura que se está a corrigir.

### Regras que exigem atenção quando se cria uma coleção nova

Qualquer coleção nova usada pela aplicação tem de ser acrescentada a `firestore.rules`, senão as
escritas passam a ser recusadas. Já estão cobertas: `products`, `sales`, `losses`,
`transformations`, `employees`, `attendance`, `customers`, `paused_sales`, `active_cart`,
`settings`, `counters`, `deletions`, `payroll_payments`, `active_sessions`, `credentials`,
`audit_logs`, `audit_logs_archive`, `stock_movements`.

## 4. Ainda por fazer

- `window.prompt()` nas confirmações destrutivas (K‑01) — em iframe/ambiente embebido devolve
  `null` e a operação desaparece sem aviso. Deve passar a modal próprio.
- Palavras‑passe por omissão (`05082`) quando não existe nenhuma configurada: primeiro arranque
  deve obrigar à definição de uma.
- Bloqueio de conta após N tentativas (existe limitação de ritmo, mas não bloqueio persistente).
