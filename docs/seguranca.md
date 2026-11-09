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

## 3. Regras do Firestore — ficheiro pronto, publicação é decisão sua

`firestore.rules` deixou de ser `allow read, write: if true` (que expunha vendas, credenciais e
salários a qualquer pessoa com o *projectId*, que está no bundle) e passa a exigir
`request.auth != null`, com auditoria imutável e credenciais sem eliminação.

**O ficheiro não é publicado automaticamente.** Antes de correr
`firebase deploy --only firestore:rules`:

1. Firebase Console → Authentication → *Sign‑in method* → ativar **Anónimo**.
2. Confirmar que a app arranca e sincroniza (a sessão anónima é criada em `firebaseDB.ts`).
3. Só então publicar as regras.

As regras antigas ficaram em `firestore.rules.legacy-open`, apenas para consulta. Não publicar.

Se publicar as regras antes de ativar o login anónimo, a sincronização com o Firestore para de
funcionar (a aplicação cai para os fallbacks locais).

## 4. Ainda por fazer

- `window.prompt()` nas confirmações destrutivas (K‑01) — em iframe/ambiente embebido devolve
  `null` e a operação desaparece sem aviso. Deve passar a modal próprio.
- Palavras‑passe por omissão (`05082`) quando não existe nenhuma configurada: primeiro arranque
  deve obrigar à definição de uma.
- Bloqueio de conta após N tentativas (existe limitação de ritmo, mas não bloqueio persistente).
