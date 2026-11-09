# Plano de melhoria — proteger o dinheiro e passar a auditoria municipal

## O objetivo, escrito como critério de decisão

Cada alteração deste plano foi aceite ou recusada por responder a uma destas perguntas:

1. **O dinheiro do cliente e do dono fica registado e reconciliável?**
2. **Pode desaparecer produto sem rasto?**
3. **Um inspector municipal consegue seguir o rasto do documento até ao dinheiro?**
4. **O que está no ecrã é exactamente o que sai no papel?**

Quando a resposta não era clara, a decisão foi **bloquear e pedir palavra-passe**, nunca adivinhar.

---

## Fase A — Fugas de dinheiro e de papel (executada)

| ID | O que estava errado | O que passou a acontecer |
|---|---|---|
| FT-25 | Liquidar era um *upsert* cego: dois postos queimavam dois recibos e o segundo apagava o primeiro; pagar uma factura já anulada **ressuscitava-a** | `payInvoiceWithReceipt` corre numa transacção: lê a factura, recusa se estiver paga/anulada, numera o recibo e grava estado + contador no mesmo passo. Ou fica tudo, ou nada. |
| FT-23 | Ninguém sabia quando, por quem, nem como a factura foi paga | Ficam gravados `paidAt`, `paidBy` e `settledPaymentMethod`; o meio de pagamento é escolhido no momento do recebimento |
| FT-24 | Receber dinheiro era a única operação sem auditoria | Registo `Liquidação de Factura` com valor, meio e nº de recibo |
| FT-31 | Anular uma proforma queimava um número de nota de crédito | A NC só é emitida para factura definitiva |
| FT-32 | A NC era **só um número**: não existia em papel | Novo documento `NOTA DE CRÉDITO` A4, com referência à factura, ao recibo e ao motivo; gerado automaticamente na anulação e reimprimível pela lista |
| FT-54 | Qualquer factura podia ser impressa como "FACTURA PROFORMA" com o mesmo número | O botão só existe em proformas |
| FT-46 | O mapa PDF somava proformas ao total facturado | Passa a usar a mesma regra do ecrã (`isFinancialSale`) |

## Fase B — Integridade do stock (executada)

| ID | O que estava errado | O que passou a acontecer |
|---|---|---|
| FT-33/35 | "Restaurar" reanimava uma factura anulada, que continuava a mostrar a NC | Deixa de existir "restaurar": existe **Reemitir** — factura nova, número novo, estado Pendente, stock deduzido outra vez. A anulada e a NC ficam intactas no histórico |
| FT-34 | O restauro calculava a conversão saco→quilo pelo catálogo de hoje | Reemissão, anulação e conversão de proforma usam a conversão **gravada na linha da venda** |
| FT-39 | Produto eliminado do catálogo não repunha stock e ninguém era avisado | O aviso final nomeia os artigos que não puderam ser repostos |
| FT-40 | O livro de movimentos gravava o **ID** do produto nos estornos | Grava nome e unidade |
| FT-07 | Estado legado `'canceled'` não era reconhecido: permitia anular de novo e **estornar stock duas vezes** | Todo o módulo usa `isCancelledSale`; o separador "Canceladas" procura o período e filtra em memória; as agregações somam as duas grafias |
| FT-38/26 | Duplo clique podia duplicar operação | Liquidação protegida pela transacção; botão desactivado durante o processamento |

## Fase C — Documentos e relatórios coerentes (executada)

| ID | Antes | Depois |
|---|---|---|
| FT-55 | "Forma de Pagamento: Transferência Bancária" fixo | Meio real da venda ou da liquidação |
| FT-56 | "Sessão Offline Validada" fixo | Posto real (`terminalId`) ou "não registado" |
| FT-57 | IVA recalculado a 16 % cego | Valor gravado ou soma das taxas por linha (`taxHelper`) |
| FT-67/70 | Recibo de factura **não paga**, com "TOTAL PAGO" | Recibos só para facturas liquidadas; o térmico diz "Comprovativo de venda" e "TOTAL EM DÍVIDA" quando é dívida |
| FT-66 | Dois geradores diferentes do mesmo "Recibo A4" | Um só (`downloadReceiptA4`) |
| FT-59 | Factura anulada não podia ser reimpressa | Imprime com faixa e título "FACTURA ANULADA" |
| FT-58 | Venda antiga sem linhas rebentava o modal | `openPreview` garante `items` |
| FT-47/48/49 | Excel com NUIT inventado e sem IVA/recibo/NC | NUIT vazio quando não existe; colunas de IVA, desconto, recibo, NC, posto, meio de liquidação |
| FT-01 | Totais da página apresentados como totais do período | Aviso explícito quando a agregação falha |
| FT-15 | Chaves React duplicadas em vendas antigas | Fallback por número de factura |

## Fase D — O que estava a destruir a auditoria (executada)

| ID | O que estava errado | O que passou a acontecer |
|---|---|---|
| FT-75 | `handleClearAllHistory` existia mas não estava ligado a nada: se fosse ligado, apagava **folhas de salário e assiduidade** sem senha e sem auditoria | Removido |
| — | **"Novo Exercício Comercial" chamava `clearSystemData()`** e apagava todo o livro de vendas | Não apaga nada: a numeração já é por ano. O texto do diálogo diz isso |
| — | "Eliminar histórico de teste" e "Zerar sistema" apagavam sem password | Exigem palavra-passe de gestor; o texto enumera exactamente o que desaparece |
| — | O apagamento deixava `stock_movements` órfãos (vendas apagadas, movimentos a apontar para elas) | Passa a apagar também o livro de movimentos, em lotes de 400, e devolve contagem por colecção |

## Fase E — Fluxo que faltava (executada)

**FT-79 — converter proforma em factura definitiva.** A proforma é uma proposta: não deduz stock nem conta como receita. Antes, a única forma de a transformar em factura era repetir a venda no PDV, com risco de preços diferentes do que o cliente autorizou. Agora existe **Emitir Factura**: número novo `FAC-`, stock deduzido, estado Pendente, e a proforma fica marcada com `→ FAC-2026-0007`.

---

## O que continua aberto (45 achados, por prioridade de dinheiro)

**Antes de operar em produção:**

1. **Reembolso de dinheiro não é registado.** A anulação devolve stock e emite NC, mas o dinheiro que sai da gaveta não fica em lado nenhum. Sem isto, o caixa nunca fecha. → Fase F, prioridade máxima.
2. **FT-38** — duplo clique em "Confirmar Anulação" ainda pode duplicar NC (só guarda de estado React). → `useRef`.
3. **FT-17** — datas na lista usam `new Date()` directo em vez do dia local (`dateKey`): vendas depois das 22h podem cair no dia seguinte.
4. **FT-62** — IVA numa única linha, sem discriminação por taxa; com linhas isentas o documento não cumpre o CIVA.
5. **FT-20** — não há vista de detalhe da factura (itens, troco, IVA, posto) sem abrir impressão.
6. **FT-80** — não existe conta-corrente por cliente: não se sabe quanto um cliente deve ao todo.

**Antes da inspecção municipal:**

7. **FT-44** — sem limite de tentativas na palavra-passe de autorização.
8. **FT-63** — paginação do A4 em papel (8 itens) por confirmar com impressora real.
9. **FT-61/60** — endereço da empresa e nome por omissão inconsistentes nalguns blocos do documento.
10. **FT-53** — exportação sem controlo por perfil.

**Dívida técnica (P3):** FT-02 a FT-05, 08–14, 16, 18, 19, 21, 22, 29, 30, 43, 45, 50–52, 64, 65, 68, 69, 71–74, 76–78, 81.

---

## Decisões que tomei e que deve conhecer

| Decisão | Porquê |
|---|---|
| **Reemitir em vez de restaurar** | Um documento anulado é nulo para efeitos fiscais. Reanimá-lo criava dois estados para o mesmo papel. Agora há sempre um documento novo e legível no dossier. |
| **NC numerada no ano da emissão**, não no ano da factura | As séries são anuais e uma NC emitida em 2026 tem de pertencer à série de 2026. Anular uma factura de 2025 emite `NC-2026-xxxx` a referenciar `FAC-2025-xxxx`. |
| **Reemissão nasce "Pendente"** | Nunca assumir que o dinheiro entrou. Se entrou, o operador carrega em Pagar e o recibo é emitido com a data real. |
| **Fecho de ano não apaga nada** | A lei obriga a conservar; a numeração já resolve a mudança de exercício. |
| **Apagar histórico exige palavra-passe** | É a única operação irreversível do sistema. |

---

## Como provar isto (checklist para a inspecção)

1. **Numeração contínua** — Técnico → "Verificar numeração": sem lacunas em FAC, FP, REC, NC.
2. **Rasto documento → dinheiro** — cada factura paga tem `paidAt`, `paidBy`, meio e nº de recibo na exportação Excel.
3. **Anulações** — cada factura cancelada tem NC impressa e arquivada, com referência à factura e ao recibo.
4. **Stock** — Stock → "Movimentos" por artigo: venda, estorno e quebra com data, operador e documento.
5. **IVA** — mapa do período com IVA por linha gravado na venda.
6. **Backup** — cópia diária do `BACKUP_DIR` (ver `docs/seguranca.md`).

## Verificação feita nesta fase

`npx tsc --noEmit` sem erros · `TZ=Africa/Maputo npx tsx test/master_plan_test.ts` 44/44 · `npx vite build` concluído · aplicação a responder `200`.

**Não verificado:** impressão real (A4/térmica), leitura do livro de movimentos no balcão e o comportamento em dois postos simultâneos. Só se fecham com impressora e dois terminais à frente.
