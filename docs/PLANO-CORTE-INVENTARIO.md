# Plano de Correcção — Corte de Inventário

**AGRO - XICOMO & SERVIÇOS, LDA**
Documento de gestão interna · Módulo de Stock & Facturação

---

## 1. O problema, em linguagem simples

A contagem física foi tirada a uma hora (**T0**) e só foi lançada no sistema mais tarde (**T1**).
Entre T0 e T1 a loja continuou a vender.

```
08:00  T0   Contagem física na loja  ............  contou 10 sacos de milho
09:30       Venda registada no PDV   ............  2 sacos saíram
14:15       Venda registada no PDV   ............  30 kg saíram
18:00  T1   Contagem lançada no sistema .........  sistema passou a dizer 10 sacos
```

O lançamento da contagem **substitui** o saldo (não soma, não subtrai): o sistema ficou com os
10 sacos contados às 08:00, apagando o desconto que as vendas do dia já tinham feito.

```
Stock físico real agora  =  contagem (T0)  −  vendas entre T0 e T1
Stock no sistema         =  contagem (T0)                           ← está a MAIS
Erro                     =  exactamente as vendas entre T0 e T1
```

> **Conclusão:** o sistema não está "estragado" nem a contagem está errada. Falta apenas
> descontar uma vez as vendas que aconteceram entre a contagem e o lançamento.

---

## 2. As duas formas correctas de corrigir

Existem duas vias legítimas. Ambas chegam **exactamente ao mesmo saldo final** — está provado
nos testes automáticos (`test/inventory_cutoff_test.ts`, suite 5).

### Via A — Anular as vendas e relançá-las (foi a que pediu)

1. As vendas do período são marcadas como **Cancelada** (nunca apagadas).
2. **O stock NÃO é devolvido** — este é o ponto crítico. O inventário que está no sistema foi
   contado *antes* destas vendas, logo essa saída de mercadoria já não está lá reflectida.
3. As vendas são relançadas no PDV e o stock desconta normalmente, a partir do inventário contado.

| Vantagens | Desvantagens |
|---|---|
| O histórico de vendas fica "limpo" e coerente com o novo inventário | Os números de factura originais ficam queimados (as novas vendas recebem números novos) |
| Permite corrigir ao mesmo tempo erros das próprias vendas | Recibos/facturas já entregues ao cliente deixam de corresponder ao documento activo |
| | Exige voltar a digitar todas as vendas (risco de erro humano) |
| | Afecta o fecho de caixa do dia enquanto o relançamento não estiver concluído |

> ⚠️ **O erro a evitar:** anular *com* estorno de stock. No exemplo acima o stock iria de
> 500 kg para 630 kg — ficaria 260 kg acima do real. A ferramenta vem por omissão **sem estorno**.

### Via B — Manter as vendas e descontar do stock (recomendada)

1. As facturas mantêm-se válidas: numeração, recibos e fecho de caixa intactos.
2. O sistema desconta do stock as quantidades vendidas depois da contagem.
3. Fica registado na auditoria como *Correcção de Stock por Corte de Inventário*.

| Vantagens | Desvantagens |
|---|---|
| Não mexe em documentos fiscais nem em numeração | Não corrige eventuais erros dentro das vendas |
| Não há nada para voltar a digitar (zero risco de erro) | — |
| Executa-se num minuto | — |
| Mantém o fecho de caixa e os relatórios do dia | — |

**Recomendação:** use a Via B se as vendas estiverem correctas (é só o stock que está mal).
Use a Via A apenas se quiser mesmo refazer as vendas (ex.: foram lançadas com artigos ou
preços errados). A ferramenta faz as duas.

---

## 3. Execução passo a passo

### Antes de começar (5 minutos, obrigatório)

1. **Fechar o PDV** enquanto a operação decorre — nenhuma venda nova durante a correcção.
2. **Backup:** Painel Técnico → *Backup* (ou `POST /api/backup`). Sem backup, não avance.
3. **Exportar o mapa das vendas do dia**: na própria ferramenta, botão
   *Mapa p/ relançamento (Excel)*. Este ficheiro é a sua rede de segurança — tem artigo,
   quantidade, preço, cliente e forma de pagamento de cada documento.

### Via A — Anular e relançar

| Passo | Onde | O que fazer |
|---|---|---|
| 1 | Facturas (ou Stock → Reconciliação) | Botão **Corte de Inventário** |
| 2 | Ferramenta | Escolher **"Anular vendas do período"** |
| 3 | Ferramenta | Escolher o **dia**. Se só quer anular a partir da hora da contagem, preencher **Desde** (ex.: 08:00) |
| 4 | Ferramenta | Confirmar que **"Devolver as quantidades ao stock" está DESLIGADO** (é o estado por omissão) |
| 5 | Ferramenta | Conferir a lista de documentos. Desmarcar os que não devem ser anulados |
| 6 | Ferramenta | Exportar o mapa em Excel **e** em PDF (imprimir) |
| 7 | Ferramenta | Confirmar que o cartão "Efeito no stock" diz **"Stock NÃO é alterado"** |
| 8 | Ferramenta | Botão **Anular N venda(s)** → palavra-passe de gestor → *Confirmar e executar* |
| 9 | PDV | Relançar as vendas uma a uma, a partir do mapa exportado |
| 10 | Stock → Reconciliação | Conferir 3 ou 4 artigos de maior rotação contra a prateleira |

**Ao relançar, boas práticas:**
- Manter a **mesma data** da venda original (o relatório do dia não se desloca).
- Escrever no campo de notas/referência: `Substitui FAC-2026-XXXX anulada por corte de inventário`.
- Repetir a **mesma forma de pagamento** — caso contrário o fecho de caixa não bate certo.
- Não emitir novo recibo ao cliente que já levou um; o documento novo serve de registo interno.

### Via B — Descontar sem anular

| Passo | Onde | O que fazer |
|---|---|---|
| 1 | Facturas ou Stock | Botão **Corte de Inventário** |
| 2 | Ferramenta | Escolher **"Descontar vendas do stock"** |
| 3 | Ferramenta | Escolher o dia e a hora da contagem em **Desde** |
| 4 | Ferramenta | Conferir a coluna **Stock final** artigo a artigo (é o saldo que fica gravado) |
| 5 | Ferramenta | **Corrigir stock** → palavra-passe → executar |
| 6 | Stock → Reconciliação | Conferência física por amostragem |

---

## 4. Verificação depois da correcção (checklist)

- [ ] Stock → Reconciliação: escolher 5 artigos de maior rotação e conferir com a prateleira.
- [ ] Facturas → separador *Canceladas*: confirmar que estão lá os documentos anulados (Via A).
- [ ] Finanças: o total facturado do dia corresponde ao esperado
      (Via A: só depois do relançamento estar completo; Via B: inalterado).
- [ ] Fecho de caixa do dia bate com o dinheiro/M-Pesa efectivamente recebido.
- [ ] Painel Técnico → Auditoria: existe o registo
      *Anulação em Massa (Corte de Inventário)* ou *Correcção de Stock por Corte de Inventário*.
- [ ] Nenhum artigo ficou com stock negativo ou zerado por engano.

---

## 5. Como evitar que volte a acontecer

A causa não foi erro de contagem — foi **falta de corte (cut-off)**. Três regras resolvem:

### Regra 1 — Contar com a loja parada (ideal)

Contar antes de abrir ou depois de fechar e lançar **imediatamente**. Sem vendas pelo meio,
não há diferença possível.

### Regra 2 — Registar sempre o momento da contagem (já implementado no sistema)

Em **Stock → Contagem Física & Reconciliação** existe agora o campo
**"Momento real da contagem física (corte de inventário)"**:

- Indica a data e hora em que a contagem foi tirada no armazém.
- O sistema procura sozinho todas as vendas registadas **depois** desse instante.
- Ao gravar, aplica: `quantidade contada − vendas posteriores`.
- Mostra antes de gravar quantas vendas e quantos artigos vão ser descontados.

Com este campo preenchido, pode contar de manhã e lançar à noite sem qualquer problema.

### Regra 3 — Se for mesmo preciso vender durante a contagem

Separar fisicamente a mercadoria vendida durante a contagem (caixa à parte, "zona de saída")
e anotar os talões. No lançamento, usar a Regra 2 com a hora exacta do início da contagem.

---

## 6. O que foi construído no sistema para suportar este plano

| Componente | Ficheiro | Função |
|---|---|---|
| Lógica de corte | `src/utils/inventoryCutoff.ts` | Selecciona vendas do período, agrega o impacto em stock (incluindo produtos saco+quilo), projecta saldos e documenta anulações |
| Ferramenta visual | `src/components/InventoryCutoffTool.tsx` | Painel com pré-visualização, exportação do mapa, palavra-passe e execução das duas vias |
| Acesso | `src/components/FaturasModule.tsx` · `src/components/StockModule.tsx` | Botão **Corte de Inventário** nos dois módulos |
| Contagem com data/hora | `src/components/StockModule.tsx` | Campo *Momento real da contagem* + desconto automático das vendas posteriores |
| Operações em lote | `src/utils/firebaseDB.ts` · `src/utils/indexedDB.ts` | `cancelSalesBulk()` e `applyStockCorrection()` — gravação em lotes, online e offline |
| Testes | `test/inventory_cutoff_test.ts` | 47 testes, incluindo a prova de que as duas vias dão o mesmo saldo |

### Correcções de qualidade aproveitadas no caminho

- As quebras geradas pela contagem física passaram a ter **valor de custo real**
  (antes usavam um campo inexistente e gravavam sempre `0,00 MT`).
- O motivo da quebra automática passou a ser **"Quebras de Inventário"** (o valor anterior
  não existia na lista oficial de motivos e quebrava a tipagem do sistema).
- Produtos híbridos (saco + quilo) passam a ter os saldos de **grosso e retalho** corrigidos
  em conjunto com o saldo base, deixando de ficar incoerentes.

---

## 7. Regras de ouro

1. **Nunca** anular com estorno de stock quando o inventário lançado é anterior às vendas.
2. **Nunca** lançar uma contagem sem indicar a hora a que foi tirada, se já houve vendas depois.
3. **Sempre** backup antes de qualquer operação em bloco.
4. **Sempre** exportar o mapa antes de anular — é o que permite relançar com fidelidade.
5. Documentos anulados **ficam arquivados**, nunca são apagados (exigência fiscal e de auditoria).
