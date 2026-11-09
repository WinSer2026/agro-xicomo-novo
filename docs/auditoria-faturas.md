# Auditoria — Módulo de Gestão de Facturas

**Alvo:** `src/components/FaturasModule.tsx` (1 696 linhas)
**Dependências lidas na íntegra:** `utils/saleStatus.ts`, `utils/taxHelper.ts`, `utils/authorization.ts`, `utils/sequenceHelper.ts`, `utils/dateRangeHelper.ts`, `utils/postCommit.ts`, `utils/pdfGenerator.ts` (assinaturas + blocos de totais/IVA/rodapé), `utils/firebaseDB.ts` (`getSalesPage`, `getSalesForPeriod`, `getSalesSummary`, `nextDocumentNumber`, `addSale`, `addSaleWithStockDeduction`, `cancelSaleWithStockRestoration`, `clearSystemData`), `types.ts` (`Sale`, `SystemSettings`), `firestore.indexes.json`.
**Método:** leitura bloco a bloco, do primeiro import ao último `</div>`, com verificação cruzada de cada caminho de escrita contra o que é mostrado/impresso.

---

## Legenda

| Nível | Significado |
|---|---|
| **P0** | Erro fiscal ou de dinheiro: documento errado emitido, valor errado somado, obrigação legal em falta. |
| **P1** | Erro funcional provável: o utilizador fará algo errado sem aviso, ou a operação falha em condições normais. |
| **P2** | Inconsistência, fragilidade ou perda de informação: não corrompe dados, mas engana ou atrapalha. |
| **P3** | Cosmético, desempenho marginal, código morto, acessibilidade. |

Tudo o que está marcado como "verificado" foi confirmado por leitura de código. Nada aqui foi deduzido da interface.

---

## B1 — Arranque, carregamento e sincronização (linhas 29–201)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-01** | P1 | 116–120, 494 | Se a agregação do servidor falhar (offline, campo `total` não numérico em registo antigo), `getSalesSummary` devolve `null` e `periodSummary` passa a ser `pageSummary` — a soma da **página carregada** (30 facturas). | Os cartões passam a mostrar totais do período calculados sobre 30 facturas, sem qualquer aviso. O texto por baixo diz "os totais referem-se ao período completo". Mentira silenciosa. |
| **FT-02** | P2 | 168–176 | O listener `db-update` recarrega a lista de facturas também quando o evento é de `products`. | Uma venda no PDV ou um ajuste de stock provoca releitura da página de facturas: leituras a mais (custo real no plano Spark) e perda da posição de scroll durante o trabalho. |
| **FT-03** | P3 | 86–91 | `showToast` agenda `setTimeout` sem guardar o identificador. | Dois avisos seguidos: o temporizador do primeiro apaga o segundo antes dos 4 s. |
| **FT-04** | P3 | 105–143 | `loadData` não é cancelado no unmount (a versão do pedido protege a ordem, não a desmontagem). | `setState` em componente desmontado ao mudar de módulo durante o carregamento; aviso no console. |
| **FT-05** | P2 | 110–125 | `loadData` engole o erro de agregação com `console.warn`, mas propaga o erro da página. | Duas falhas diferentes produzem o mesmo comportamento visível para o utilizador ("erro ao carregar") ou nenhum. |

## B2 — Filtros, separadores e pesquisa (173–180, 471–480, 745–775)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-06** | P1 | 471–476, 577 | O separador de estado compara `sale.status !== faturasFilter` diretamente, ignorando `isProformaSale()` / `isCancelledSale()` de `saleStatus.ts`. | Uma proforma antiga gravada com `documentType: 'FaturaProforma'` e estado diferente de `'Proforma'` aparece em "Pagas"/"Pendentes" e entra na dívida. O helper que existe exatamente para isto não é usado neste módulo. |
| **FT-07** | P1 | 475, 602, 940 | O estado legado `'canceled'` (inglês) não é reconhecido em nenhum ponto deste ficheiro; só `saleStatus.ts` o trata. | Um registo assim: (a) aparece na lista mas não em nenhum separador nem contagem; (b) mostra o botão **Cancelar** porque `status !== 'Cancelada'`; (c) se for cancelado, o stock é **estornado uma segunda vez**. Depende de existirem registos com esse valor — não é possível confirmar aqui, mas o código defensivo em `saleStatus.ts` indica que já existiram. |
| **FT-08** | P2 | 449–467 | A pesquisa textual só percorre a página carregada. Existe aviso no ecrã, mas não existe a ação óbvia: "procurar em todo o período". | Quem procura `FAC-2026-0042` de há três meses conclui que a factura não existe. |
| **FT-09** | P2 | 452–457 | A pesquisa não abrange **número de recibo**, **número de nota de crédito** nem posto (`terminalId`). | Não é possível encontrar uma factura a partir do recibo entregue ao cliente, nem a NC, nem o que foi emitido num caixa. |
| **FT-10** | P3 | 749 | Separadores com texto em linha (`{tab === 'Todas' ? ...}`) repetido três vezes no mesmo ficheiro (contagem, rótulo, cartões). | Qualquer estado novo exige alteração em três sítios — já divergiu uma vez (ver FT-06). |

## B3 — Cartões de resumo (481–525, 660–706)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-11** | P2 | 484–507 | `pageSummary.totalInvoiced` usa `isFinancialSale` (exclui proformas), mas `totalCount: sales.length` conta tudo. | Com a agregação em baixo (fallback), o cartão "Total Facturado" e a contagem "Todas (N)" medem universos diferentes no mesmo painel. |
| **FT-12** | P2 | 694–700, 787 | Valores monetários nos cartões usam `toLocaleString('pt-MZ')` sem casas decimais; o PDF usa 2. | 1 234,56 MT aparece como "1.235 MT" no ecrã e "1.234,56 MT" no documento. Arredondamentos divergentes sobre o mesmo número. |
| **FT-13** | P3 | 509–522 | Com o filtro `Paga` ativo, `pendingInvoiced`/`canceledInvoiced` passam a 0, mas o cartão "Em dívida" continua a mostrar a dívida do período inteiro. | Mistura de critérios no mesmo painel: três cartões filtrados, um não. Está comentado no código, mas não é explicado ao utilizador. |
| **FT-14** | P2 | 484–507 | `sumByStatus('Paga')` soma `sale.total` de vendas `'canceled'` legadas? Não — mas soma proformas com `status: 'Paga'` se existirem. | Ver FT-06: a divergência entre agregado do servidor (só `status`) e os helpers é o defeito de fundo. |

## B4 — Tabela de facturas (778–960)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-15** | P1 | 797 | `key={sale.id}` sem fallback. | Vendas antigas sem `id` produzem chaves duplicadas; o React reutiliza linhas e pode mostrar dados trocados ao filtrar. |
| **FT-16** | P2 | 780–788 | Não há coluna de **recibo** nem de **nota de crédito**; `terminalId` não é mostrado em lado nenhum. | Não se sabe, na lista, se a factura foi liquidada nem em que posto foi emitida. A NC só aparece como rodapé do badge de estado. |
| **FT-17** | P2 | 833–836 | Data/hora formatadas com `new Date(sale.date)` direto, em vez do dia local (`dateKey`/`toLocalDateKey`) usado no resto do sistema. | Vendas entre 22:00 e 24:00 podem aparecer com a data do dia seguinte à indicada nos relatórios que usam `dateKey`. |
| **FT-18** | P2 | 847–852 | O número da NC aparece sob o badge, mas sem ação (não é clicável, não abre documento). | Ver FT-26: o número existe referenciado, o documento não existe. |
| **FT-19** | P3 | 796–950 | Tipografia entre 8,5 px e 10,5 px em números fiscais. | Legibilidade fraca no balcão; quem confere valores aperta o zoom. |
| **FT-20** | P2 | 867 | Não há ação "ver detalhes" por linha (itens, troco, IVA por linha, operador, posto). A única forma de ver o conteúdo é abrir uma pré-visualização de impressão. | Para responder "o que levou esta factura?" é preciso abrir um documento de impressão. |
| **FT-21** | P3 | 790–793 | Estado vazio ("Nenhuma factura localizada") não distingue entre período sem vendas, filtro a esconder tudo e pesquisa sem resultados. | O utilizador não sabe o que corrigir. |
| **FT-22** | P3 | 900–920 | Tooltip do badge explica o significado de cada estado — bom — mas o badge de vendas `'canceled'` cai no `else` e usa o texto "anulada com nota de crédito" sem que exista NC. | Afirmação sem suporte (ver FT-07/FT-26). |

## B5 — Liquidação de facturas (212–256)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-23** | P1 | 219–234 | A liquidação grava apenas `status: 'Paga'` e `receiptNumber`. **Não grava data/hora do pagamento, operador que recebeu, nem forma de pagamento real.** | Não há forma de saber quando foi paga, por quem, nem em dinheiro ou transferência. Num litígio com o cliente, só existe o recibo em papel. |
| **FT-24** | P1 | 212–256 | A liquidação **não escreve registo de auditoria**, ao contrário da anulação (356) e do restauro (415). | Receber dinheiro é a operação financeira mais sensível do módulo e é a única sem rasto. |
| **FT-25** | P1 | 232 | `dbService.addSale(updatedSale)` é um *upsert* cego (última escrita ganha). Não há transação nem verificação do estado atual. | Dois postos a liquidar a mesma factura: dois números de recibo queimados, um perdido. Pior: se a factura tiver sido anulada entretanto, o pagamento **desfaz a anulação** em silêncio. |
| **FT-26** | P2 | 213, 219 | A proteção contra duplo clique é só `isProcessing` (estado React). | Duplo clique rápido antes do re-render pode emitir dois recibos. |
| **FT-27** | P2 | 228, 1400 | `paymentMethod` não é atualizado ao liquidar: uma venda a crédito paga em dinheiro continua a imprimir "FORMA PAGAMENTO: Crédito". | O recibo diz uma forma de pagamento que não foi a usada. |
| **FT-28** | P2 | 222 | `dbService.getSales()` lê a **coleção inteira** de vendas só para calcular um número candidato que `nextDocumentNumber` ignora (usa o contador transacional). | Leitura de toda a coleção a cada liquidação — custo e latência desnecessários, sobretudo com histórico grande. |
| **FT-29** | P3 | 226–229 | `parseInt(candidate.slice(...)) - 1 || 0` depende do formato exato devolvido por `generateNextReceiptNumber`. | Se o formato mudar, o fallback cai para 0 silenciosamente (sem consequência fiscal, porque o contador manda, mas é frágil). |
| **FT-30** | P3 | 236–241 | O recibo é gerado e descarregado, mas não fica arquivado na aplicação. | Reimpressão futura depende do ficheiro no disco do posto. |

## B6 — Anulação e restauro (258–420)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-31** | **P0** | 296–308 | O número de nota de crédito é obtido **antes** de qualquer verificação do tipo de documento. Anular uma **proforma** ou uma cotação queima um número `NC-AAAA-NNNN` e o registo de auditoria afirma "Nota de crédito emitida". | Série de NC com números consumidos por documentos que nunca existiram; sequência fiscal com buracos injustificados (que a verificação de numeração do módulo Técnico vai assinalar). |
| **FT-32** | **P0** | — | **Não existe documento de nota de crédito.** O número é guardado em `sale.creditNoteNumber` e mostrado na lista, mas nenhum gerador em `pdfGenerator.ts` produz uma NC. | Anulação sem documento de retificação: obrigação fiscal em falta. O cliente fica com uma factura válida no dossier e a empresa com um número de NC que não existe em papel. |
| **FT-33** | P1 | 369–378 | No restauro, `restoredStatus` só aceita `Paga`, `Crédito`, `Pendente`; qualquer outro valor cai em `'Pendente'`. `Sale['previousStatus']` nem admite `'Proforma'`. | Proforma anulada + restaurada passa a ser **dívida do cliente** (`Pendente`), com botão "Pagar" ativo. |
| **FT-34** | P1 | 383–406 | O restauro recalcula a conversão a partir do **catálogo atual** (`prod.parentUnit && prod.conversionRate`), enquanto a anulação usa `item.conversionRate` gravado na linha (D-04). | Se o fator saco→quilo mudar entre a venda e o restauro, o stock reposto e o re-deduzido não coincidem: sobra ou falta stock permanentemente. |
| **FT-35** | P1 | 358–362 | O restauro não limpa `creditNoteNumber` nem `cancelledAt` (usa `...sale`). | Factura restaurada continua a mostrar número de NC na lista, como se estivesse anulada. |
| **FT-36** | P1 | 300–310 | Anular uma factura **paga** não reverte a liquidação: o `receiptNumber` mantém-se e o recibo entregue ao cliente continua válido. | Dinheiro recebido, factura anulada, recibo válido: três documentos contraditórios sem documento de estorno. |
| **FT-37** | P2 | 383–406 | O restauro chama `addSaleWithStockDeduction`, que **volta a gravar movimentos de stock negativos** do tipo `Venda`; o estorno positivo anterior fica no livro. | O saldo fica certo, mas o livro mostra `Estorno` + `Venda` para a mesma factura sem qualquer referência ao restauro. |
| **FT-38** | P2 | 275, 1295 | Duplo-clique em "Confirmar Anulação" pode executar duas vezes (só `isProcessing`, sem `useRef`). | Duas NC emitidas e stock estornado duas vezes. |
| **FT-39** | P2 | 313 | `if (!prod \|\| prod.isService) continue` — se o produto foi eliminado do catálogo, o stock não é reposto e não há aviso. | Estorno parcial silencioso; a diferença só aparece na reconciliação de stock. |
| **FT-40** | P2 | 297–312, 1602 | `restockItems` não leva `productName` nem `unit`; `recordStockMovements` faz `productName: item.productName \|\| item.productId`. | O livro de movimentos grava o **ID** do produto nos estornos (os movimentos de venda têm nome). |
| **FT-41** | P2 | 355, 372 | O texto do toast e do registo de auditoria do restauro diz sempre "restaurada para o estado Pendente", mesmo quando restaurou para `Paga` ou `Crédito`. | Auditoria a afirmar um estado que não é o gravado. |
| **FT-42** | P2 | 296–300 | O ano da NC vem da data da **venda** (`new Date(sale.date).getFullYear()`). | Anular em 2026 uma factura de 2025 emite a NC na série de 2025, já fechada. Decisão fiscal a confirmar com a contabilidade (comportamento consistente ou não, conforme a política adotada). |
| **FT-43** | P3 | 356, 415 | `ipAddress: '127.0.0.1'` fixo nos registos de auditoria. | O campo existe para responder "de onde?", e a resposta é sempre falsa. |
| **FT-44** | P3 | 258–283 | Sem limite de tentativas no modal de palavra-passe. | Tentativa exaustiva local sem travão (mitigado pelo custo de cada tentativa em `verifyPassword`, mas sem registo de falhas). |
| **FT-45** | P3 | 262–283 | O modal não diz **qual** palavra-passe é pedida (gestor, técnico?) além do placeholder. | O operador não sabe a quem pedir autorização. |

## B7 — Exportações Excel e PDF (525–600)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-46** | **P0** | 569–572 | O "Total Facturado" do mapa PDF soma tudo o que não é `'Cancelada'` — **incluindo as proformas**. No ecrã, `isFinancialSale` exclui-as. | O mesmo período dá dois totais diferentes: um no ecrã, outro no documento assinado que se entrega à direção ou ao banco. |
| **FT-47** | P1 | 545 | O Excel inventa `NUIT: 999999999` para clientes sem NUIT. | Um NUIT que não existe num relatório fiscal. Deve ficar vazio ou "Consumidor Final", nunca um número. |
| **FT-48** | P1 | 536–546 | O Excel exporta 8 colunas: número, data, cliente, NUIT, operador, método, total, estado. Falta IVA, desconto, nota de crédito, recibo, posto. | Não serve para reconciliação fiscal nem para apurar IVA do período. |
| **FT-49** | P1 | 536–598 | Nenhuma exportação mostra o número da NC das anuladas nem o número de recibo das pagas. | O contabilista não consegue cruzar factura ↔ recibo ↔ NC a partir dos ficheiros. |
| **FT-50** | P2 | 569–598 | O mapa PDF não tem totais por estado, não numera páginas, não separa por operador e não mostra a NC nem o recibo. | Documento de uma página por cada 40 facturas, sem fecho de contas. |
| **FT-51** | P2 | 690–692, 734 | `isExporting` bloqueia a lógica, mas os botões do `DateRangeFilter` continuam ativos. | Segundo clique é ignorado sem feedback: o utilizador pensa que falhou. |
| **FT-52** | P3 | 549, 594 | Nome dos ficheiros com datas ISO (`2026-11-01`). | Ficheiros fora da convenção `pt-MZ` usada em todo o interface. |
| **FT-53** | P3 | 525–598 | Exportação sem qualquer verificação de perfil. | Qualquer operador com sessão descarrega o histórico completo de facturação. Decisão do dono. |

## B8 — Pré-visualização A4 / Proforma (960–1150)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-54** | **P0** | 881–888, 1047–1049 | O botão **"F. Proforma"** está disponível em **qualquer** factura e reimprime-a com o **mesmo número** e o título "FACTURA PROFORMA". | Uma factura definitiva `FAC-2026-0007` pode ser impressa como proforma com o mesmo número: dois documentos de natureza diferente com a mesma referência. |
| **FT-55** | P1 | 1051 | Forma de pagamento **fixa**: "Transferência Bancária", ignorando `paymentMethod`. | Factura paga em dinheiro ou M-Pesa sai a declarar transferência bancária. |
| **FT-56** | P1 | 1077 | "Sessão Offline Validada" **fixo**. | Afirmação técnica sem base: a venda pode ter sido online. |
| **FT-57** | P1 | 1116–1118, 1388 | O IVA é recalculado a **16 %** sobre `(subtotal − desconto)` quando `ivaAmount` não existe, ignorando `taxRate` por linha (`taxHelper`). Rótulo fixo "IVA (16 %)". | Venda com linhas isentas ou a 5 % imprime um valor de IVA errado e um rótulo errado. |
| **FT-58** | P1 | 1011–1014, 1167–1170 | `invoiceToPrint.items.length` sem guarda. | Venda antiga sem `items` rebenta o modal (ecrã branco) em vez de mostrar a factura. |
| **FT-59** | P1 | 866–929 | Numa factura **cancelada** os botões de impressão são escondidos. | Não há forma de reimprimir o documento anulado — precisamente o que uma inspeção pede. |
| **FT-60** | P2 | 1088, 1139, 1196, 1305 | Nome da empresa por omissão inconsistente: `AGRO - XICOMO & SERVIÇOS,EI`, `...LDA`, `AGRO - XICOMO & SERVIÇOS, LDA`. | Cabeçalhos diferentes conforme o bloco onde falha a definição. |
| **FT-61** | P2 | 1071, 1222 | Endereços fixos ("Província de Maputo, Moçambique", "Maputo, Moçambique"), ignorando `companyAddress` e `customerAddress`. | Dados do documento que não vêm dos dados. |
| **FT-62** | P2 | 1116–1118 | IVA numa única linha, sem discriminação por taxa (16 %, isento, etc.). | Não cumpre o requisito de discriminar taxas num documento fiscal com linhas mistas. |
| **FT-63** | P2 | 1013, 1169 | Paginação fixa de 8 itens por página, com `min-h-[297mm]` e `pageBreakAfter: always`. | Nomes longos ou descrições em duas linhas transbordam a página; impressão pode gerar folhas em branco. Só se confirma no papel. |
| **FT-64** | P3 | 1090, 1104 | `(settings as any)` desnecessários — `banco2`, `numero_conta2`, `nib2` existem em `SystemSettings`. | Máscara de tipos que esconde erros futuros. |
| **FT-65** | P3 | 993–1145 | Modal sem `Escape`, sem foco preso, sem `aria-modal`, e o scroll do fundo continua ativo. | Acessibilidade e usabilidade em teclado. |

## B9 — Recibo A4 na pré-visualização (1150–1330)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-66** | P1 | 954–956 vs 240 | **Dois geradores diferentes** para o mesmo "Recibo A4": a pré-visualização chama `downloadInvoiceA4(..., true)`; a liquidação chama `downloadReceiptA4`. | O mesmo recibo sai com layouts diferentes conforme tenha sido gerado na liquidação ou reimpresso pela lista. Além disso, `downloadReceiptA4` pagina de 8 em 8 e `downloadInvoiceA4` de 12/20 em 12/20. |
| **FT-67** | P1 | 1201 | É possível abrir "Recibo A4" numa factura **não liquidada**; o documento mostra "Total Pago" e `Recibo Nº: S/N (não liquidado)`. | Recibo de um pagamento que não aconteceu. |
| **FT-68** | P2 | 1264–1274 | O recibo mostra subtotal, desconto e total, mas **não mostra IVA** (a factura mostra). | Documento de liquidação sem o imposto que a factura discriminou. |
| **FT-69** | P3 | 1295 | Nas páginas de continuação, "S/N (não liquidado)" repete-se no rodapé de cada página. | Ruído no documento impresso. |

## B10 — Recibo térmico / POS (1330–1425)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-70** | P1 | 1345, 1370, 1406 | O documento intitula-se sempre "Recibo de Pagamento POS" e imprime "TOTAL PAGO", mesmo para facturas a crédito ou pendentes. `settlementDisclaimer` não é usado. | Recibo de pagamento de uma dívida que continua em aberto. O mesmo defeito existe no gerador real (`pdfGenerator.ts`, linha 804). |
| **FT-71** | P2 | 1394–1404 | Rodapé fixo "Validade até à reposição de stock". | Texto comercial que não se aplica a serviços nem a vendas já liquidadas. |
| **FT-72** | P3 | 1424 | O "código de barras" é decorativo (`\|\|\|\| \| \|\|\|\|\| ...`). | Parece um código e não é legível por leitor nenhum. |

## B11 — Duplicado A5 (1425–1520)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-73** | P2 | 930–935, 1017 | `printType === 'DoubleA5'` existe no tipo e no modal, mas **nenhum botão da lista o define**. | Caminho morto: o layout é mantido e nunca usado, ou seja, não é testado. |
| **FT-74** | P2 | 1470–1500 | O A5 duplicado não tem IVA, não tem NUIT do cliente e não tem nome do operador. | Documento incompleto se um dia for usado. |

## B12 — Modais e código morto (1520–1696)

| ID | Nív. | Linha | Achado | Consequência |
|---|---|---|---|---|
| **FT-75** | P1 | 184–206 | `handleClearAllHistory` **não é chamado em lado nenhum** (verificado por grep em `src/`). Se for ligado a um botão, apaga 6 coleções — incluindo `payroll_payments` (salários) e `attendance` (assiduidade), que o texto de confirmação **não menciona** — sem palavra-passe de gestor e sem registo de auditoria. `clearSystemData` apaga documento a documento (sem transação). | Código morto perigoso: um clique futuro num botão "limpar histórico" destrói folha de salários. Deve ser removido ou reescrito (senha + auditoria + lote atómico + texto verdadeiro). |
| **FT-76** | P2 | 76–90 | `confirmModal.onConfirm` executa a ação e fecha o modal de imediato. | Se a operação falhar depois, o utilizador só vê um toast, sem o contexto da ação que falhou. |
| **FT-77** | P3 | 627 | Toast com `animate-bounce` permanente enquanto está visível. | Movimento contínuo no ecrã durante 4 s, na zona onde se clica. |
| **FT-78** | P3 | 1560–1580 | Modal de confirmação sem `Escape` nem foco preso (o de segurança tem `autoFocus`, o de confirmação não). | Teclado sem saída rápida. |

## B13 — Fluxos em falta (não existem, não estão partidos)

| ID | Nív. | Achado | Consequência |
|---|---|---|---|
| **FT-79** | P1 | **Não existe conversão de proforma em factura definitiva.** O PDV grava proformas com `status: 'Proforma'` (`PDVModule.tsx:1618`), e neste módulo não há ação para emitir a factura definitiva correspondente. | O único caminho é repetir a venda de raiz no PDV, com risco de erro de preços/quantidades e com a proforma a ficar para sempre sem contrapartida. |
| **FT-80** | P2 | Não existe vista de **conta-corrente do cliente** (todas as facturas de um cliente, saldo, antiguidade da dívida). Verificado: nenhum componente implementa extrato por cliente. | Cobrança feita à vista sobre uma lista paginada por data, sem saber quanto um cliente deve ao todo. |
| **FT-81** | P3 | O módulo chama-se "Gestão de Facturas" mas gere facturas, proformas, recibos e notas de crédito sem separar essas naturezas na navegação. | O utilizador procura "Recibos" e não encontra. |

---

## Contagem

**81 achados** — 4 P0, 24 P1, 32 P2, 21 P3. (Contado por script sobre as tabelas; IDs de FT-01 a FT-81, sem duplicados nem lacunas.)

| Nível | Qtd. | IDs |
|---|---|---|
| **P0** | 4 | FT-31, FT-32, FT-46, FT-54 |
| **P1** | 24 | FT-01, FT-06, FT-07, FT-15, FT-23, FT-24, FT-25, FT-33, FT-34, FT-35, FT-36, FT-47, FT-48, FT-49, FT-55, FT-56, FT-57, FT-58, FT-59, FT-66, FT-67, FT-70, FT-75, FT-79 |
| **P2** | 32 | FT-02, FT-05, FT-08, FT-09, FT-11, FT-12, FT-14, FT-16, FT-17, FT-18, FT-20, FT-26, FT-27, FT-28, FT-37, FT-38, FT-39, FT-40, FT-41, FT-42, FT-50, FT-51, FT-60, FT-61, FT-62, FT-63, FT-68, FT-71, FT-73, FT-74, FT-76, FT-80 |
| **P3** | 21 | FT-03, FT-04, FT-10, FT-13, FT-19, FT-21, FT-22, FT-29, FT-30, FT-43, FT-44, FT-45, FT-52, FT-53, FT-64, FT-65, FT-69, FT-72, FT-77, FT-78, FT-81 |

### Estado da execução

**34 fechados · 2 parciais · 45 abertos.** Detalhe e justificação em `docs/plano-melhoria.md`.

| Situação | IDs |
|---|---|
| **Fechados** (34) | FT-01, FT-06, FT-07, FT-15, FT-23, FT-24, FT-25, FT-26, FT-27, FT-28, FT-31, FT-32, FT-33, FT-34, FT-35, FT-39, FT-40, FT-41, FT-42, FT-46, FT-47, FT-48, FT-49, FT-54, FT-55, FT-56, FT-57, FT-58, FT-59, FT-66, FT-67, FT-70, FT-75, FT-79 |
| **Parciais** (1) | FT-38 (liquidação já é atómica; a anulação ainda só tem guarda de estado) |

> **FT-36 fechado**: o reembolso ao cliente passou a ser registado em `cash_movements`, com palavra-passe de gestor, limite ao valor efetivamente pago e espelho no Livro de Caixa. Ver `docs/reembolso-caixa.md`.
| **Abertos** (45) | FT-02, FT-03, FT-04, FT-05, FT-08, FT-09, FT-10, FT-11, FT-12, FT-13, FT-14, FT-16, FT-17, FT-18, FT-19, FT-20, FT-21, FT-22, FT-29, FT-30, FT-37, FT-43, FT-44, FT-45, FT-50, FT-51, FT-52, FT-53, FT-60, FT-61, FT-62, FT-63, FT-64, FT-65, FT-68, FT-69, FT-71, FT-72, FT-73, FT-74, FT-76, FT-77, FT-78, FT-80, FT-81 |

## O que já está correto (para não regredir)

1. **Numeração fiscal transacional** — `nextDocumentNumber` usa `runTransaction` sobre `counters/document_numbers`; dois postos nunca recebem o mesmo número e o contador nunca recua (`firebaseDB.ts:884`).
2. **Índice composto presente** — `sales(status ASC, date DESC)` em `firestore.indexes.json`, que é exatamente o que o separador por estado exige. Sem ele, os separadores falhavam em produção.
3. **Lista paginada com cursor opaco** e totais por agregação do servidor: abrir a lista não descarrega o histórico inteiro.
4. **Proteção contra páginas obsoletas** — `salesRequestVersion` descarta respostas de consultas antigas.
5. **Anulação com estorno de stock na mesma transação** (`writeBatch` com `increment`) e tratamento correto de produtos híbridos saco/quilo.
6. **Palavra-passe de autorização vinda das definições** (hash com salt), sem palavras-passe universais no bundle.
7. **`runPostCommitTask`** separa corretamente "operação gravada" de "falha ao atualizar o ecrã".
8. **`settlementDisclaimer`** existe e é correto — o problema é não ser usado no térmico (FT-70).

## O que só se prova no local

- FT-63: paginação real no papel (A4, 8 itens, nomes longos).
- FT-66: comparar no papel o recibo da liquidação com o recibo reimpresso.
- FT-72: leitura do código de barras no leitor do balcão.
- FT-53/FT-75: decisão de quem pode exportar e quem pode limpar histórico.

## Decisões que dependem do dono

1. **FT-42** — NC de uma factura de ano anterior: série do ano da venda ou do ano da anulação?
2. **FT-53** — exportação restrita a Gestor/Técnico?
3. **FT-79** — a conversão de proforma em factura deve consumir o número da proforma como referência (campo `sourceProformaNumber`)?
4. **FT-75** — o "limpar histórico" deve existir na interface? Se sim, com palavra-passe de gestor e auditoria obrigatória.
