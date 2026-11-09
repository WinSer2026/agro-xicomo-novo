# Auditoria da Gestão de Stock e Inventário

Verificação bloco por bloco, linha por linha, dos ecrãs e da camada de dados que lhes dá suporte.
Objectivo: nenhum valor de stock a desaparecer, nenhum movimento sem rasto, e coerência com PDV,
facturação e contabilidade.

**Âmbito:** `StockModule.tsx` (4387 linhas), `StockAIEntry.tsx` (410), `TransformationModal.tsx`
(984), `TransformationView.tsx` (683) e os métodos de stock de `firebaseDB.ts`.

---

## 1. Mapa dos blocos auditados

| Bloco | Onde | O que faz |
|---|---|---|
| **Stock** (tabela com barras) | inventário | lista, pesquisa, edição inline de quantidade, preços |
| **Alterações** | log de auditoria filtrado | histórico de alterações de stock |
| **Inventário por categorias** | exportação | listagem agrupada + PDF |
| **Novo produto** | modal | criação de artigo/serviço, código, preços, híbridos |
| **Ajuste de produto** | modal | edição completa + palavra-passe |
| **Ajuste directo** | inline na tabela | alterar quantidade com senha |
| **Registo de preço** | dentro do ajuste | compra/venda, saco e quilo |
| **Quebras** | modal + aba | registo de perda com motivo |
| **Eliminação** | modal | apagar produto com senha |
| **Requisição de sacos** | modal | passa sacos de revenda para retalho |
| **Reconciliação / contagem física** | aba | compara contagem com sistema |
| **Transformação / fraccionamento** | modal + aba | divide produto noutros, com perdas |
| **Entrada por IA** | `StockAIEntry` | lança compras a partir de texto/foto |
| **Expurgo automático de validade** | ao carregar o ecrã | move lotes vencidos para perdas |

---

## 2. Achados — bloco por bloco

### 2.1 Expurgo automático de validade (P0)

Ao **abrir** o módulo de stock, todos os produtos vencidos com stock são movidos para perdas e o
saldo é posto a zero — sem autorização, sem confirmação, a cada carregamento.

| ID | Nív. | Achado |
|---|---|---|
| **ES-01** | **P0** | **Stock zerado automaticamente ao abrir o ecrã.** `loadInventoryData` percorre os produtos: se `expiryDate <= hoje` e `stockQty > 0`, grava uma quebra e escreve `stockQty = 0`. Um erro de data (formato, fuso, digitação) apaga o stock de um artigo inteiro sem que ninguém tenha decidido nada. É exactamente o «produto que some». |
| **ES-02** | **P0** | **Só o total é zerado.** `stockQtyBulk` e `stockQtyRetail` ficam intactos: o PDV continua a vender sacos de um produto que o inventário diz ter zero. |
| **ES-03** | P1 | **Gravação dupla** — `saveProduct` dentro do `if` e outra vez no fim do ciclo. |
| **ES-04** | P1 | **Perda e stock em operações separadas**: se a gravação do produto falhar, fica quebra registada com stock por zerar (ou o contrário, no carregamento seguinte). |
| **ES-05** | P2 | Comparação de datas por texto (`expiryDate <= 'AAAA-MM-DD'`): uma data com hora (`2026-11-09T00:00`) nunca é considerada vencida nesse dia. |
| **ES-06** | P2 | Geração automática de código de barras dentro do mesmo ciclo, também gravada sem auditoria. |

> **Estado (2026-11-09):** o aviso de lotes vencidos **mantém-se** no ecrã de inventário, com baixa
> lote a lote e senha de gestor. Chegou a ser retirado para passar ao módulo do armazém, mas o
> proprietário corrigiu: o que queria retirar era outra coisa. Nada é apagado automaticamente — a
> baixa é sempre uma decisão explícita.

### 2.2 Novo produto

| ID | Nív. | Achado |
|---|---|---|
| **ES-07** | **P0** | **Nenhuma verificação de código/SKU duplicado.** Dois artigos podem partilhar o mesmo código de barras ou referência. No PDV, o scanner vende o primeiro que encontrar — o cliente leva um produto e a factura descreve outro. |
| **ES-08** | P1 | **O stock inicial não deixa movimento.** Cria-se um artigo com 500 kg e o livro de movimentos não tem uma única linha: o saldo inicial é indemonstrável. |
| **ES-09** | P1 | **Sem registo de auditoria.** Criar produto é a única operação do módulo que não fica registada — apagar, ajustar e quebrar ficam. |
| **ES-10** | P2 | `id: 'prod-' + Date.now()`: importações rápidas podem colidir e sobrepor-se. |
| **ES-11** | P2 | Quantidades negativas não são recusadas (`newProdQty`, `newProdQtyBulk`, `newProdQtyRetail`). |
| **ES-12** | P2 | Campos mortos: `newReceivedSacks`, `newSacksForWholesale`, `newSacksForRetail` são limpos mas nunca usados na criação — o formulário sugere uma funcionalidade que não existe. |
| **ES-13** | P2 | Sem aviso de nome repetido (só o código é (não) verificado). |

### 2.3 Ajuste de produto

| ID | Nív. | Achado |
|---|---|---|
| **ES-14** | **P0** | **Gravação de saldo absoluto.** `stockQty = (sacos × conversão) + retalho`, calculado a partir dos campos do formulário. Uma venda feita entre abrir o modal e gravar é apagada pelo valor do ecrã. Com dois postos, destrói stock em silêncio. |
| **ES-15** | **P0** | **Muta o objecto em estado** (`selectedProduct.name = …`) antes de gravar. Alterações não submetidas já «existem» na memória e podem propaga-se a outros ecrãs que partilhem a referência. |
| **ES-16** | P1 | **Nenhum movimento de stock.** Uma diferença de 200 kg não aparece no livro de movimentos: o stock muda sem explicação. |
| **ES-17** | P1 | **Auditoria anónima**: `username: 'Operador / Técnico'` e `ipAddress: '127.0.0.1'` fixos. Não se sabe quem ajustou. |
| **ES-18** | P1 | **O registo mente nos números**: grava `editStockQty` mas o valor gravado foi `computedStockQty` (nos híbridos, os dois diferem). |
| **ES-19** | P2 | Preços e quantidades não têm limite superior; um zero acidental em `editConversionRate` divide por zero no custo do quilo. |
| **ES-20** | P2 | Alterar o código para um já existente não é recusado (liga-se ao ES-07). |

### 2.4 Ajuste directo (inline)

| ID | Nív. | Achado |
|---|---|---|
| **ES-21** | **P0** | **Mesmo defeito do ES-14**, aqui com um clique na tabela: `product.stockQty = newQty` e gravação absoluta. |
| **ES-22** | P1 | Sem movimento de stock e sem auditoria com identidade real. |
| **ES-23** | P2 | Nos híbridos, a re-alocação (`floor`/`%`) não arredonda quantidades fraccionadas de retalho. |

### 2.5 Requisição de sacos (revenda → retalho)

| ID | Nív. | Achado |
|---|---|---|
| **ES-24** | P1 | Escreve `stockQtyBulk`/`stockQtyRetail` absolutos a partir do estado do ecrã — dois operadores a requisitar ao mesmo tempo, um deles perde a operação. |
| **ES-25** | P1 | Sem movimento de stock do tipo «Transformação»: a transferência entre formas de venda não fica registada. |
| **ES-26** | P2 | Auditoria com utilizador fixo e IP fixo. |

### 2.6 Quebras e perdas

| ID | Nív. | Achado |
|---|---|---|
| **ES-27** | **P0** | **Quebra em sacos desconta em quilos.** A dedução é sempre `hasConversion: false, qtyToReduce: lossQty`: dar baixa de 1 saco (50 kg) retira **1 kg**. O stock fica 49 kg acima do real, com a quebra registada a 50 kg no relatório — o número que a contabilidade usa para o prejuízo não é o número que saiu do stock. |
| **ES-28** | P1 | A verificação `lossQty > lossProduct.stockQty` usa o valor do ecrã (pode estar desactualizado). A dedução em si é atómica (`increment`), mas pode ficar negativa. |
| **ES-29** | P2 | Data em UTC (`toISOString().split('T')[0]`): uma quebra às 23:30 em Maputo é registada no dia seguinte. |
| **ES-30** | P2 | Auditoria com `'Operador'` fixo; motivo e justificação livres, sem mínimo. |

### 2.7 Reconciliação / contagem física

| ID | Nív. | Achado |
|---|---|---|
| **ES-31** | **P0** | **Escrita de saldo absoluto** (`stockQty = physicalQty`): as vendas feitas entre a contagem e o clique são apagadas. É o mesmo problema que o Corte de Inventário resolve — mas este caminho ignora-o. |
| **ES-32** | **P0** | **Perda gravada antes do produto, fora de transacção.** Se `saveProducts` falhar, fica quebra registada e stock por corrigir. |
| **ES-33** | P1 | Nos híbridos só o total é actualizado: `stockQtyBulk`/`stockQtyRetail` continuam a somar o valor antigo. |
| **ES-34** | P1 | **Sobras não deixam rasto.** As faltas geram `addLoss` (com movimento); as diferenças positivas só alteram o saldo — nenhum movimento «Ajuste». |
| **ES-35** | P2 | Todas as faltas levam o motivo `'Deterioração'`, o que é falso: são diferenças de inventário, não deterioração. |
| **ES-36** | P2 | Data em UTC; auditoria sem IP real. |

### 2.8 Eliminação de produto

| ID | Nív. | Achado |
|---|---|---|
| **ES-37** | P1 | **Apaga-se um artigo com stock e com histórico de vendas.** A eliminação é definitiva: as facturas antigas passam a referir um produto inexistente (os relatórios mostram `n/d`), e o stock desaparece sem movimento de saída. Devia ser desactivação (soft delete) quando há histórico. |
| **ES-38** | P2 | Não avisa quantas vendas nem quanto stock estão em causa. |

### 2.9 Transformação / fraccionamento

| ID | Nív. | Achado |
|---|---|---|
| **ES-39** | **P0** | **Dedução sem verificação de stock.** `increment(-qty)` num `writeBatch`: transformar 10 sacos quando existem 4 deixa o saldo em **−6**, sem erro. |
| **ES-40** | P1 | **Reversão incompleta.** `cancelTransformationWithStockReversal` devolve apenas `stockQty` do original: se a dedução foi em sacos, `stockQtyBulk` fica errado para sempre. |
| **ES-41** | P1 | A reversão dos produtos resultantes também só mexe em `stockQty`, deixando `stockQtyRetail` inflacionado. |
| **ES-42** | P2 | A reversão **apaga** o registo de perda em vez de o anular — apaga prova. |
| **ES-43** | P2 | O livro de movimentos tem o tipo `Transformação` e nunca o usa: as variações de stock por transformação não são explicáveis a partir do ledger. |

### 2.10 Entrada de stock por IA

| ID | Nív. | Achado |
|---|---|---|
| **ES-44** | **P0** | **Encontra o produto por substring.** `name.includes(pesquisa)`: «milho» encontra «MILHO BRANCO» ou «MILHO AMARELO», consoante a ordem da lista. Stock lançado no artigo errado, sem confirmação. |
| **ES-45** | **P0** | **`stockQty += qty` sobre o cache + gravação absoluta.** Duas entradas simultâneas → uma apaga a outra. |
| **ES-46** | P1 | **Sem palavra-passe de gestor** — a única via de alteração de stock que não a exige, e altera também preços. |
| **ES-47** | P1 | Sem movimentos de stock «Entrada»: a compra entra no saldo sem deixar rasto de mercadoria recebida. |
| **ES-48** | P2 | Auditoria com utilizador fixo e IP fixo. |

### 2.11 Alterações, categorias e exportações

| ID | Nív. | Achado |
|---|---|---|
| **ES-49** | P1 | O separador **«Alterações» lê apenas `audit_logs`** filtrados por texto. Como os ajustes e as entradas por IA registam utilizador fixo e IP fixo, a lista existe mas não identifica ninguém. |
| **ES-50** | P2 | **Inventário por categorias** e exportações leem o catálogo em memória; com dois postos, o PDF pode sair com quantidades desactualizadas sem qualquer aviso de hora de leitura. |
| **ES-51** | P2 | Categorias são texto livre por produto: «Adubos» e «adubos » são categorias diferentes nos totais. Não há lista central de categorias. |

---

## 3. O que está correcto (verificado, sem alteração)

| Item | Confirmação |
|---|---|
| Palavra-passe de gestor no ajuste, na eliminação e na contagem física | `verifyAuthorizationPassword` com hash |
| Regra de preços (compra < venda, híbridos coerentes) no novo produto e no ajuste | `validateHybridPrices` / `validateStandardPrices` |
| Deduções atómicas com `increment` nas vendas | `deductProductStock`, `addSaleWithStockDeduction` |
| Quebra grava movimento de stock (`addLoss` → F-05) | sem duplicação |
| Venda com stock insuficiente é recusada pela transacção | `InsufficientStockError` |
| Transformação: produto, perdas e registo gravados no mesmo batch | ✓ |
| Sem `allow write: if true` nas regras | coberto por `test/rules_coverage_test.ts` |
| Avisos de validade com cores e dias restantes | ✓ |

---

## 4. Ligação aos outros módulos (porque isto não é só stock)

| Achado | Efeito fora do stock |
|---|---|
| ES-02 (bulk/retail intactos no expurgo) | **PDV continua a vender** mercadoria que o inventário deu como perdida |
| ES-07 (código duplicado) | **Factura** descreve um artigo diferente do que o cliente levou |
| ES-27 (quebra em sacos) | **Contabilidade** mostra prejuízo de 50 kg, stock desceu 1 kg — a margem fica errada |
| ES-14/21/31/45 (saldo absoluto) | Vendas simultâneas apagadas; **relatórios e DRE** passam a mentir sem que nada falhe |
| ES-34 (sobras sem movimento) | **Livro de movimentos** deixa de explicar o saldo — inútil numa inspecção |
| ES-37 (eliminação definitiva) | Histórico de facturação com produtos inexistentes |
| ES-39 (transformação negativa) | Stock negativo pode chegar ao PDV como disponibilidade |

---

## 5. Plano de melhoria

### Fase 1 — parar as perdas (P0) · ~1 dia de trabalho

| # | Acção | Fecha |
|---|---|---|
| 1 | O expurgo de validade passa a **propor** em vez de executar: lista de lotes vencidos com botão «mover para perdas», com senha. Nunca ao carregar o ecrã. | ES-01, ES-03, ES-04 |
| 2 | Zerar **as três quantidades** (base, sacos, retalho) em qualquer saída de stock. | ES-02, ES-33 |
| 3 | Verificação de **código único** ao criar e ao editar (recusa com o nome do artigo que já o usa). | ES-07, ES-20 |
| 4 | Todos os ajustes passam a gravar **por diferença** (`increment`), lidos dentro de transacção. | ES-14, ES-21, ES-31, ES-45 |
| 5 | Quebras com **conversão de unidade** (saco → base) e verificação de saldo dentro da transacção. | ES-27, ES-28 |
| 6 | Transformação verifica stock antes de deduzir e recusa saldo negativo. | ES-39 |
| 7 | Entrada por IA: **correspondência exacta** (código ou nome igual), pré-visualização do que vai mudar e senha de gestor. | ES-44, ES-45, ES-46 |

### Fase 2 — rasto e responsabilidade · ~1 dia

| # | Acção | Fecha |
|---|---|---|
| 8 | Movimento de stock em **todas** as variações: `Ajuste`, `Entrada`, `Transformação`. O livro passa a explicar o saldo. | ES-08, ES-16, ES-25, ES-34, ES-43, ES-47 |
| 9 | Auditoria com **utilizador real e IP real** em todos os blocos. | ES-17, ES-22, ES-26, ES-30, ES-36, ES-48, ES-49 |

*(8 e 9 executadas em 2026-11-09 — ver secção 7.)*
| 10 | Ajuste + movimento + auditoria **numa só transacção**. | ES-04, ES-32 |
| 11 | Data em **dia de Maputo** em quebras, contagem e expurgo. | ES-05, ES-29, ES-36 |

### Fase 3 — integridade a prazo · ~meio dia

| # | Acção | Fecha |
|---|---|---|
| 12 | Eliminação de produto passa a **desactivação** quando há histórico; eliminação só para artigos sem vendas nem stock. | ES-37, ES-38 |
| 13 | Reversão de transformação devolve **as três quantidades** e **anula** a perda em vez de a apagar. | ES-40, ES-41, ES-42 |
| 14 | Categorias passam a lista central (sem duplicados por espaços/maiúsculas). | ES-51 |

*(12, 13 e 14 executadas em 2026-11-09 — ver secção 7.)*

### Fase 4 — acabamento · ~meio dia

| # | Acção | Fecha |
|---|---|---|
| 15 | Quantidades negativas recusadas em todos os formulários. | ES-11 |
| 16 | Campos mortos do formulário de novo produto: usar ou retirar. | ES-12 |
| 17 | Auditoria da criação de produto; aviso de nome repetido. | ES-09, ES-13 |
| 18 | Exportações mostram a hora e a origem dos dados. | ES-50 |
| 19 | Testes automáticos por bloco (novo produto, ajuste, quebra, contagem, transformação, IA). | todos |

**Total estimado:** 3 dias de trabalho, dos quais 1 dia para os sete P0.

---

## 6. Verificação disponível

```
npm run test:all     → 272 asserções, 0 falhas
npx tsc --noEmit     → sem erros
npx vite build       → sem erros
```

A aritmética do inventário (conversão saco↔base, derivação de sacos/retalho, travão do saldo negativo,
diferença de contagem, valor do prejuízo) vive agora em `src/utils/stockMath.ts` e é testada sem
Firestore: 50 asserções novas em `test/stock_debts_test.ts` (25 de aritmética de stock, 10 de
correspondência de artigo, 7 de perdas anuladas, 8 de categorias). O que **não** é testável daqui é o
comportamento transaccional real (dois postos a ajustar ao mesmo tempo) — isso exige dois caixas.

**O que não se pode provar daqui:** comportamentos com dois postos reais, impressão, e o efeito de
uma venda a meio de um ajuste. Esses ficam para prova no local, bloco a bloco, com uma lista de
verificação preparada no fim de cada fase.

---

## 7. Estado de execução

### Fase 1 — executada (parcial) · 2026-11-09

| # | Acção | Estado | Onde |
|---|---|---|---|
| 1 | Expurgo de validade deixa de ser automático | **feito** | `StockModule.loadInventoryData` só lista; banner «lotes vencidos» com botão por lote, senha de gestor e `expireProductBatch` (três quantidades a zero na mesma transacção) |
| 2 | Zerar as três quantidades | **feito** | `expireProductBatch` grava `stockQty = stockQtyBulk = stockQtyRetail = 0` na mesma transacção; `adjustStock`, `registerLossAtomic` e `applyPhysicalCount` derivam sempre sacos+retalho do total (ES-02, ES-33, ES-45) |
| 3 | Código único ao criar e editar | **feito** | verificação sem distinção de maiúsculas/ espaços em novo produto e no formulário de ajuste; recusa com o nome do artigo dono (ES-07, ES-20) |
| 4 | Ajustes por diferença, dentro de transacção | **feito** | `dbService.adjustStock` (`deltaBase` / `deltaBulk` / `absoluteBase` lido no `runTransaction`); usado pelo ajuste inline, pelo formulário do artigo e pelo stock inicial do novo produto (ES-04, ES-14, ES-21, ES-31, ES-32, ES-34, ES-45) |
| 5 | Quebras com conversão de unidade | **feito** | `registerLossAtomic`: selector saco/base no modal, `1 saco = N kg`, recusa acima do saldo; perda + movimento + auditoria no mesmo commit (ES-27, ES-28, ES-32) |
| 6 | Transformação verifica stock | **feito** | `addTransformationWithStockUpdate` passou de `writeBatch` (não lê nada) a `runTransaction`: lê o saldo, recusa transformar mais do que existe, sincroniza as três quantidades e grava saída/entradas/perda/guia/auditoria no mesmo commit (ES-39, ES-43, ES-47) |
| 7 | Entrada por IA com correspondência exacta | **feito** | `src/utils/productMatch.ts`: só igualdade de código ou de nome (sem acentos, sem maiúsculas); nome repetido fica «ambíguo» e não é gravado. Pré-visualização mostra o artigo real e «120 → 170 kg», e a gravação exige senha de gestor (ES-44, ES-45, ES-46) |

### Fase 2 — executada · 2026-11-09

| # | Acção | Estado | Onde |
|---|---|---|---|
| 8 | Movimento de stock em todas as variações | **feito** | `Entrada` (stock inicial e IA), `Ajuste` (inline, formulário, contagem física), `Quebra`, `Transformação` (uma saída + uma entrada por artigo) e requisição de sacos (movimento com delta 0, para o livro explicar a abertura) |
| 9 | Utilizador real e IP real na auditoria | **feito** | requisição de sacos, eliminação de produto, transformação, anulação de transformação, regeneração de código de barras e entrada por IA deixaram de escrever `'127.0.0.1'` e nomes fixos |
| 10 | Ajuste + movimento + auditoria na mesma transacção | **feito** | `adjustStock`, `registerLossAtomic`, `expireProductBatch`, `applyPhysicalCount`, `requisitionSacks`, `addTransformationWithStockUpdate`, `updateProductPrices` |
| 11 | Data em dia de Maputo | **feito** | quebras e contagem gravam o instante ISO (a hora local é derivada na leitura); a guia de transformação passou a usar `toLocalDateKey` em vez de UTC |

**Dois assuntos que ficam para o proprietário decidir (não são bugs a corrigir sozinho):**

1. **Duas gavetas ou uma?** O stock de um artigo híbrido tem três números: total, sacos e retalho.
   Desde a Fase 1, sacos e retalho são **derivados** do total (`sacos = total ÷ conversão`), o que
   garante que nunca divergem. A «Requisição de sacos» move sacos de revenda para retalho mantendo o
   total — o que só faz sentido se as duas gavetas forem independentes. Enquanto a decisão não vier,
   a requisição está transaccional e auditada, mas o próximo ajuste volta a derivar do total.
2. **A entrada por IA não está ligada a nenhum ecrã.** O componente `StockAIEntry` não é importado em
   parte alguma: o risco ES-44 estava latente, não activo. Ficou corrigido (correspondência exacta,
   pré-visualização e senha) para o dia em que for ligado.

**Também fechado nesta fase, embora estivesse atribuído a outras:**

- **ES-08 / ES-16** (livro de movimentos): o stock inicial de um artigo novo entra como movimento
  `Entrada` (`Entrada Manual`), em vez de nascer já no saldo.
- **ES-09** (auditoria da criação de produto): `Criação de Produto` com utilizador e IP reais.
- **ES-05 / ES-29 / ES-36** (dia de Maputo): a comparação de validade passou a usar `toLocalDateKey`
  em vez de `toISOString().split('T')[0]` — o corte às 22:00 UTC deixava de existir.
- **ES-11** (quantidades negativas): a contagem física recusa negativos e o servidor valida o saldo.
- Bug encontrado ao implementar: a contagem física usava `parseInt`, pelo que 12,5 kg de um artigo a
  peso era contado como 12 kg e a falta era inventada. Passou a aceitar decimais (passo 0,001).
- O *toast* do módulo passou a distinguir sucesso / erro / aviso — antes um «palavra-passe errada»
  aparecia a verde.

**Prova local que continua pendente** (não se prova num sandbox): dar baixa de um lote vencido num
posto e confirmar que o outro deixa de vender; ajustar o mesmo artigo em dois
postos ao mesmo tempo e ver um dos dois recusado (saldo insuficiente) em vez de ficar negativo;
contar 12,5 kg e ver o saldo ficar em 12,5; quebrar 1 saco e ver 50 kg no relatório; transformar 100 kg
de um artigo que só tem 40 e ser recusado; dar duas transformações simultâneas do mesmo saco.

### Fase 3 — executada · 2026-11-09

| # | Acção | Estado | Onde |
|---|---|---|---|
| 12 | Eliminação → desactivação quando há histórico | **feito** | `getProductUsage` conta vendas, quebras, movimentos e transformações; o modal mostra os números antes de decidir (ES-38). Com histórico → `deactivateProduct` (sai do PDV, fica nas facturas); sem histórico nem stock → eliminação. **Com stock > 0 recusa sempre** — mercadoria não sai do inventário por um botão de eliminar. Artigo desactivado aparece a cinzento com etiqueta «Inactivo» e botão «Reactivar» (ES-37) |
| 13 | Reversão de transformação | **feito** | `cancelTransformationWithStockReversal` em `runTransaction`: devolve **as três quantidades** (base, sacos, retalho) ao artigo de origem, retira-as dos gerados, recusa anular se os gerados já foram vendidos, deixa movimento de devolução e auditoria. A perda fica **anulada**, não apagada (ES-40/41/42) |
| 14 | Categorias como lista central | **feito** | `src/utils/categories.ts`: chave sem acentos/maiúsculas/espaços, rótulo mais usado, `canonicalCategory` ao gravar um artigo (ES-51) |

**Perdas anuladas em três sítios:** `src/utils/losses.ts` (`countedLosses`, `totalLossValue`,
`lossQuantityByProduct`). Aplicado no Financeiro (prejuízo total e gráficos), no Stock (cartões,
exportações PDF/Excel e contagem no separador). Na lista de «Quebras» a perda anulada continua
visível, riscada, com quem a anulou e porquê — é prova, não lixo.

**Prova local que continua pendente:** eliminar um artigo com vendas antigas e confirmar que a factura
antiga continua legível; anular uma transformação depois de já ter vendido um dos pacotes gerados
(deve ser recusado, não deixar stock negativo); anular uma transformação intacta e ver a perda
riscada em «Quebras» sem alterar o prejuízo total.

### Fase 4 — por executar
