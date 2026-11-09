# Publicar as regras — pacote pronto

Tudo o que precisa para fechar a base de dados, na ordem certa. O detalhe completo está em
`docs/seguranca.md` §3; isto é a versão operacional.

---

## O que mudou agora

As regras passaram a cobrir **`cash_sessions`** — a colecção nova dos turnos de caixa (abertura e
fecho). Sem esta regra publicada, o botão "Trocar de turno" abre mas o fecho falha com
`permission-denied`: o Firestore recusa tudo o que não esteja listado.

```javascript
match /cash_sessions/{docId} {
  allow read, create: if request.auth != null;
  // Fecho imutável: só se actualiza enquanto o turno estiver aberto.
  allow update: if request.auth != null && resource.data.status == 'Aberto';
  allow delete: if false;
}
```

O fecho de um turno é prova assinada (contagem por método, diferença, quem contou, quem conferiu).
Um erro corrige-se com um movimento contrário em `cash_movements` — nunca reescrevendo o fecho.

Anteriormente (e continua válido) ficou coberta a `cash_movements`: dinheiro que sai ou entra sem
venda, também só de leitura e criação.

## Antes de publicar — 3 verificações

```bash
npm run test:all
```

Todas as suites têm de terminar com **0 falhas** (o número de verificações muda a cada entrega —
o que interessa é não haver linha `FALHOU:` nem `FAIL`). O `rules_coverage_test` varre o código,
lista as colecções usadas e compara com `firestore.rules` — se uma colecção nova não estiver
protegida, falha ali e não em produção.

| # | Verificação | Como |
|---|---|---|
| 1 | Login anónimo ativo | Console → **Segurança → Authentication → Sign-in method** → *Anónimo* ligado |
| 2 | Aplicação carrega dados **com as regras antigas ainda** | Abrir, F12 → Console, sem `Missing or insufficient permissions` |
| 3 | Testes verdes | `npm run test:all` |

Se o passo 2 falhar, **pare**: o problema é o login anónimo, e publicar as regras agora fecha a
porta com a chave do lado de dentro.

## Publicar

**Consola** (recomendado, não instala nada). Atalho que salta os menus:

<https://console.firebase.google.com/project/gen-lang-client-0896153566/firestore/rules>

1. **Bancos de dados e armazenamento → Firestore**. Se o separador "Regras" não aparecer, é porque
   falta escolher a base de dados: este projeto usa uma base **com nome**
   (`ai-studio-remixagroxicomoe-5bee6408-7aeb-4603-9bb5-b56ad6507335`), não a `(default)`.
   Use o seletor de base de dados no topo da página. Confirmação: na aba "Dados" veem-se
   `products`, `sales`, `cash_movements`, `audit_logs`.
2. Separador **Regras** (em inglês, *Rules*) — fica ao lado de "Dados", "Índices", "Utilização".
   Antes de substituir, copie o texto atual para um ficheiro local (serve de reversão).
3. Copiar **todo** o `REGRAS-FIRESTORE-PARA-COLAR.txt` (cópia exata do `firestore.rules`) e colar.
4. **Publicar** (*Publish*) e esperar pela confirmação com hora.

**Consola do Google Cloud** (só se tiver caído em `console.cloud.google.com`):

`https://console.cloud.google.com/databases?project=gen-lang-client-0896153566` → clicar no ID da
base de dados → **Segurança** → separador **Firestore Rules** → *New ruleset* / *Clone ruleset* →
colar → **Publicar**.

**Linha de comandos** (a documentação oficial confirma suporte a bases com nome, desde que o
`firebase.json` as declare — e declara):

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project gen-lang-client-0896153566
# ou, apenas para esta base:
npx firebase-tools deploy --only firestore:ai-studio-remixagroxicomoe-5bee6408-7aeb-4603-9bb5-b56ad6507335 --project gen-lang-client-0896153566
```

Tem de terminar com `✔ firestore: released rules`. A propagação leva alguns minutos;
em bases com nome, o histórico da consola pode não registar publicações feitas pela CLI — nesse caso
a reversão faz-se repondo o texto guardado no passo 2.

## Provar depois de publicar — 6 testes

| # | Teste | Resultado esperado |
|---|---|---|
| 1 | Rules Playground: pedido **sem** autenticação a `products` | **Denied** |
| 2 | Rules Playground: pedido **autenticado** a `products` | **Allowed** |
| 3 | PDV: venda de teste | Grava; aparece em Faturas; stock desce |
| 4 | Stock → Movimentos | A linha da venda está lá |
| 5 | Faturas → anular factura paga **com devolução** | Livro de Caixa mostra a saída |
| 6 | Contabilidade → Livro de Caixa → sangria de 100 MT | Saldo desce 100 MT; auditoria regista |
| 7 | Botão "Trocar de turno" → abrir turno com a contagem da gaveta | Turno aberto, sem erro |
| 8 | Fechar o turno com a mesma contagem | Diferença 0,00 MT e turno seguinte aberto |

Os testes 7 e 8 são os novos: **se falharem com `permission-denied`, a regra de `cash_sessions` não
foi publicada** (copiou o ficheiro antigo). Os testes 5 e 6 confirmam `cash_movements`.

## Se algo falhar — reverter em 30 segundos

1. Console → Firestore → **Regras** → ícone de histórico
2. Escolher a versão anterior → **Publicar**

Depois corrigir a causa — quase sempre: login anónimo desligado, ou colecção nova sem regra.
Nunca publicar `firestore.rules.legacy-open`: é exatamente a configuração aberta que se está a
corrigir.

## Colecções cobertas (21)

`products` · `sales` · `losses` · `transformations` · `employees` · `attendance` · `customers` ·
`paused_sales` · `active_cart` · `settings` · `counters` · `deletions` · `payroll_payments` ·
`active_sessions` · `credentials` · `audit_logs` · `audit_logs_archive` · `stock_movements` ·
`cash_movements` · `debts` · `cash_sessions`

Para copiar sem risco de ficar a meio, use `REGRAS-FIRESTORE-PARA-COLAR.txt` (cópia exacta do
`firestore.rules`, com cabeçalho de instruções). O passo a passo do dono está em
`PASSO-A-PASSO-PUBLICAR-REGRAS.txt`.

Tudo o que não está nesta lista é **negado** — é esse o objetivo.
