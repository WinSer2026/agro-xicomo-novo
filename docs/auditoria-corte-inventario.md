# Vulnerabilidades — corte de inventário, anulação de vendas e devolução de stock

Âmbito: o que se passa **por trás** de "Cancelar" na Gestão de Facturas, e o corte de inventário que lhe está ligado.

---

## 1. Primeiro: o que existe de facto

Não existe nenhuma funcionalidade com o nome "corte de inventário" dentro de `FaturasModule.tsx`. Existem **três coisas diferentes** que se confundem com esse nome:

| # | O que é | Onde está | O que faz |
|---|---|---|---|
| A | **Devolução de stock na anulação** | `FaturasModule` → `dbService.cancelSaleWithStockRestoration` | Devolve ao inventário as quantidades da factura anulada. É o "devolver as quantidades ao stock" |
| B | **Corte / contagem física** | `StockModule` → `handleApplyPhysicalInventory` | O utilizador conta o que existe e o sistema ajusta o stock ao contado, gerando quebras pelas faltas |
| C | **Reconciliação** | `dbService.reconcileStock` | Só compara e mostra diferenças. **Não escreve nada** |

**A é indispensável.** Sem ela, anular uma venda deixaria o produto fora do stock para sempre e o cliente com a factura anulada — prejuízo duplo. **B não é indispensável** para vender; é indispensável para *provar* stock numa inspecção. **C é diagnóstico**, nunca corrige.

---

## 2. Anulação de vendas — vulnerabilidades

### V-01 · P0 · Estorno duplicado — **FECHADO**
`cancelSaleWithStockRestoration` não verificava o estado da venda. Chamada duas vezes (duplo clique, dois separadores, dois postos), devolvia o stock **duas vezes**. O sintoma é o pior possível: produto a mais no sistema, venda anulada uma só vez — e ninguém dá por isso até à contagem.
**Agora:** a venda é lida dentro da transacção; se já estiver `Cancelada`/`canceled`, a operação é recusada com mensagem.

### V-02 · P0 · Produtos fantasmas — **FECHADO**
O estorno usava `batch.set(doc, {stockQty: increment(n)}, {merge: true})`. Se o produto tinha sido eliminado do catálogo, o Firestore **criava um documento novo** com stock e sem nome, preço nem unidade. Stock que existe, não se vende e ninguém sabe o que é.
**Agora:** só se repõe stock de produtos que ainda existem; os restantes são devolvidos ao ecrã e nomeados ao operador.

### V-03 · P1 · Sem limite de linhas — **FECHADO**
Uma anulação com centenas de linhas distintas excedia o limite de escritas da transacção e falhava a meio. Passa a ser recusada antes de começar (200 linhas).

### V-04 · P1 · O dinheiro do reembolso não existe — **ABERTO**
A anulação devolve stock, emite nota de crédito e anula o recibo — mas **o dinheiro que sai da gaveta não é registado em lado nenhum**. O caixa fecha sempre com falta exatamente igual ao valor reembolsado, e não há como provar que saiu.
**Por fazer:** movimento de caixa/saída com valor, operador, hora e ligação à NC.

### V-05 · P1 · Anular um dia inteiro — **ABERTO (por desenho)**
Não existe anulação em lote. Para anular as vendas de um dia é preciso uma a uma, cada uma com palavra-passe e uma NC. Isso multiplica a probabilidade de deixar metade do dia por anular — e uma factura anulada a meio de um dia é pior do que um dia inteiro por corrigir.
**Por fazer:** operação "anular vendas do período" com uma única autorização, emitindo N notas de crédito e um relatório do que foi anulado e do que falhou.

### V-06 · P2 · Livro de movimentos é "melhor esforço" — **ABERTO (documentado)**
Os movimentos `Estorno` são gravados depois do commit, fora da transacção (fila local em caso de falha). O stock fica certo mesmo que o livro falhe; o livro pode ficar incompleto até a fila ser esvaziada.

---

## 3. Corte de inventário (contagem física) — vulnerabilidades

### V-10 · P0 · Produto híbrido fica com composição impossível — **ABERTO**
O corte ajusta só `stockQty` e ignora `stockQtyBulk`/`stockQtyRetail`. Num artigo vendido a saco e a quilo, depois de uma contagem a soma "sacos × fator + retalho" deixa de bater com o total, e o PDV passa a autorizar sacos que já não existem.
**Correção proposta:** o contado é a quantidade base; recalcular `bulk = floor(base / fator)` e `retail = base − bulk × fator`, gravando os três campos na mesma escrita.

### V-11 · P1 · Sobras aparecem do nada — **ABERTO**
Só as faltas geram documento (uma "quebra"). Se a contagem encontra **mais** do que o sistema diz, o stock sobe sem quebra, sem movimento e sem justificação. É dinheiro a aparecer sem origem — e numa inspecção é indistinguível de manipulação.

### V-12 · P1 · Toda a falta é "Deterioração" — **ABERTO**
O motivo é fixo no código. Furto, erro de pesagem e produto estragado ficam iguais no relatório de perdas, o que estraga a análise e a justificação fiscal da quebra.

### V-13 · P1 · Contagem negativa é escondida — **ABERTO**
`Math.max(0, contado)` transforma −5 em 0 sem avisar. Quem digitou mal nunca saberá.

### V-14 · P2 · Não é atómico — **ABERTO**
Grava uma quebra por produto (uma escrita cada) e só no fim grava os produtos. Uma falha a meio deixa quebras contabilizadas com stock por ajustar.

### V-15 · P2 · Sem limite de tentativas — **ABERTO**
A palavra-passe de gestor é verificada, mas podem ser tentadas ilimitadas vezes.

### V-16 · P2 · Não fica folha de contagem — **ABERTO**
Não há documento assinado do que foi contado, por quem e quando. Numa inspecção, o "ajuste" é uma afirmação sem prova.

---

## 4. "Descontar vendas do estoque" (PDV e reemissão)

| ID | Nív. | Estado |
|---|---|---|
| **V-20** | — | **Correcto.** Dedução e venda na mesma transacção, validação de disponibilidade por campo (`stockQty`, `stockQtyBulk`, `stockQtyRetail`), `InsufficientStockError` antes de escrever, limite de 400 linhas distintas. |
| **V-21** | P2 | **Aberto.** Produto já apagado do catálogo (`!snap.exists()`) não bloqueia a venda e não gera movimento: vende-se stock que já não existe no inventário. |
| **V-22** | P2 | **Aberto.** Quando não há custo conhecido, grava-se `unitPrice × 0.6`. É uma margem inventada que passa a valer como custo real nos relatórios de lucro. |

---

## 5. Consistência dos botões (após as correcções)

| Botão | O que faz | Condição | Consistente? |
|---|---|---|---|
| **Pagar** | Transacção: valida estado, numera recibo, grava data/operador/meio, auditoria, pré-visualização | só `Pendente`/`Crédito` | ✅ |
| **Fatura A4** | Pré-visualização; título por tipo e estado; sobrepõe "FACTURA ANULADA" | qualquer | ✅ |
| **F. Proforma** | Documento sem efeito fiscal | só proformas | ✅ |
| **POS / Recibo A4** | Recibo de liquidação | só `Paga` | ✅ |
| **Cancelar** | Senha → NC + estorno de stock + auditoria | não anuladas | ✅ |
| **Reemitir** | Factura nova, número novo, stock deduzido | anuladas definitivas | ✅ |
| **Emitir Factura** | Proforma → factura definitiva | proformas não convertidas | ✅ |
| **Nota de Crédito** | Reimpressão do documento de anulação | anuladas com NC | ✅ |

Duas fragilidades menores permanecem: o separador **Canceladas** lê o período completo (para apanhar o estado legado `'canceled'`), o que custa leituras; e a pré-visualização trabalha sobre uma cópia da venda, pelo que pode ficar desactualizada se outra pessoa alterar a factura com o modal aberto.

---

## 6. Ligação com os outros módulos

- **PDV** grava venda + stock + contador na mesma operação; a Gestão de Facturas **não reescreve** vendas do PDV excepto em liquidação, anulação, reemissão e conversão — todas numeradas e auditadas.
- **Stock** recebe os estornos e as quebras; o corte físico é o único ponto que ajusta stock **sem** movimento correspondente (V-11).
- **Contabilidade** lê estados; proformas e anuladas ficam fora da receita. A liquidação acrescenta `paidAt`, que é a data correta para o fluxo de caixa.
- **Auditoria** regista anulação, reemissão, liquidação e corte físico. **Exportações não são registadas** (quem levou que dados, quando).

---

## 7. O que foi feito nesta fase

1. V-01, V-02, V-03 fechadas na camada de dados (não apenas no ecrã).
2. Painel da Gestão de Facturas compactado para caber numa janela: altura total reduzida, cartões e filtros numa linha, tabela com scroll interno e cabeçalho fixo, textos de ajuda reduzidos a uma linha.
3. Comentários e blocos explicativos excessivos removidos do código do painel.

## 8. Plano de correção (por ordem de dinheiro em risco)

| Ordem | Item | Porquê primeiro |
|---|---|---|
| 1 | **V-04** reembolso em caixa | é dinheiro a sair sem rasto — todos os dias |
| 2 | **V-10** composição dos híbridos no corte | o PDV passa a vender o que não existe |
| 3 | **V-11 e V-12** sobras e motivo da falta | stock e perdas com origem falsa |
| 4 | **V-06** anulação em lote do período | evita meias-anulações |
| 5 | **V-14 e V-16** atomicidade e folha de contagem | prova documental para a inspecção |
| 6 | **V-21 e V-22** produto apagado e custo inventado | relatórios de lucro honestos |

Cada item entra com verificação (`tsc`, testes, build) e actualização desta lista — como nas fases anteriores.
