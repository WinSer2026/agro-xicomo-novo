# Publicar as regras — pacote pronto

Tudo o que precisa para fechar a base de dados, na ordem certa. O detalhe completo está em
`docs/seguranca.md` §3; isto é a versão operacional.

---

## O que mudou agora

As regras passaram a cobrir **`cash_movements`** — a colecção nova do Livro de Caixa (reembolsos e
sangrias). Sem esta regra publicada, o registo de dinheiro falha com `permission-denied` em
produção.

```javascript
match /cash_movements/{docId} {
  allow read, create: if request.auth != null;
  allow update, delete: if false;   // dinheiro não se reescreve
}
```

Um movimento errado corrige-se com outro movimento contrário — nunca editando o original. É isso
que faz do livro de caixa prova utilizável.

## Antes de publicar — 3 verificações

```bash
npm run test:all
```

Tem de dar, no fim: **44 · 49 · 15 · 35 · 16 · 12**, zero falhas. O último (`rules_coverage_test`)
varre o código, lista as colecções usadas e compara com `firestore.rules` — se uma colecção nova
não estiver protegida, falha ali e não em produção.

| # | Verificação | Como |
|---|---|---|
| 1 | Login anónimo ativo | Console → **Segurança → Authentication → Sign-in method** → *Anónimo* ligado |
| 2 | Aplicação carrega dados **com as regras antigas ainda** | Abrir, F12 → Console, sem `Missing or insufficient permissions` |
| 3 | Testes verdes | `npm run test:all` |

Se o passo 2 falhar, **pare**: o problema é o login anónimo, e publicar as regras agora fecha a
porta com a chave do lado de dentro.

## Publicar

**Consola** (recomendado, não instala nada):

1. Console → **Bancos de dados e armazenamento → Firestore → separador Regras**
2. Copiar **todo** o `firestore.rules` e colar no editor
3. **Publicar**

**Linha de comandos:**

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules   # tem de dizer "released rules"
```

## Provar depois de publicar — 6 testes

| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Rules Playground: pedido **sem** autenticação a `products` | **Denied** |
| 2 | Rules Playground: pedido **autenticado** a `products` | **Allowed** |
| 3 | PDV: venda de teste | Grava; aparece em Faturas; stock desce |
| 4 | Stock → Movimentos | A linha da venda está lá |
| 5 | Faturas → anular factura paga **com devolução** | Livro de Caixa mostra a saída |
| 6 | Contabilidade → Livro de Caixa → sangria de 100 MT | Saldo desce 100 MT; auditoria regista |

Os testes 5 e 6 são os novos: **se falharem com `permission-denied`, a regra de `cash_movements`
não foi publicada** (copiou o ficheiro antigo).

## Se algo falhar — reverter em 30 segundos

1. Console → Firestore → **Regras** → ícone de histórico
2. Escolher a versão anterior → **Publicar**

Depois corrigir a causa — quase sempre: login anónimo desligado, ou colecção nova sem regra.
Nunca publicar `firestore.rules.legacy-open`: é exatamente a configuração aberta que se está a
corrigir.

## Colecções cobertas (18)

`products` · `sales` · `losses` · `transformations` · `employees` · `attendance` · `customers` ·
`paused_sales` · `active_cart` · `settings` · `counters` · `deletions` · `payroll_payments` ·
`active_sessions` · `credentials` · `audit_logs` · `audit_logs_archive` · `stock_movements` ·
`cash_movements`

Tudo o que não está nesta lista é **negado** — é esse o objetivo.
