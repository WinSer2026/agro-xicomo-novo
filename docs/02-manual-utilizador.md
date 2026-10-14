# 📖 MANUAL DO UTILIZADOR
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026 · Aplicação: https://agro-xicomo-novo.vercel.app

> Manual prático por perfil. Se algo não funcionar como descrito, contacte o **Técnico**.

---

## 1. Primeiro Acesso e Login

1. Abra a aplicação no navegador (recomendado: Chrome/Edge actualizados).
2. Introduza o **nome de utilizador** e a **palavra-passe**.
3. **Primeiro acesso (conta nova):** o sistema obriga a definir nova palavra-passe (4 a 6 caracteres — letras e/ou números).
4. Se errar 3 vezes, aparece um teste anti-bot (soma simples). Com 5 erros, o acesso bloqueia 15 minutos.
5. **Sessão:** após 15 minutos sem actividade, a sessão **bloqueia** (não perde o trabalho — introduza a sua palavra-passe para continuar).

### Dicas
- A sua palavra-passe pode ser igual a uma antiga (política da empresa) — guarde-a com cuidado.
- Se se esquecer da palavra-passe, um **Técnico** repõe-na em Painel Técnico → Utilizadores.

---

## 2. Vendedor / Operador de Caixa (PDV)

### 2.1. Registar uma venda
1. Menu **Vendas** (PDV).
2. Adicione produtos: escreva o nome/código na pesquisa, clique nos cartões do catálogo, ou use o **scanner** (botão do scanner / leitor USB).
3. Ajuste quantidades e descontos no carrinho (à direita).
4. Escolha o **cliente** (opcional) e o **método de pagamento** (F1 Dinheiro · F3 M-Pesa · F4 E-Mola · F5 Transferência). "Múltiplo" permite dividir o pagamento.
5. Clique no formato do documento:
   - **Recibo Térmico** (talão 80mm) — venda paga;
   - **Recibo A4** — venda paga em folha A4;
   - **Factura A4 / Double A5** — fica **Pendente** (para liquidar depois);
   - **Factura Proforma** — orçamento (não deduz stock).
6. A venda é gravada **antes** de gerar o PDF/impressão — nunca repita uma venda só porque a impressão falhou: reimprima pelo histórico.

### 2.2. Pausar uma venda
- **Pausar Venda** guarda o carrinho (botão aparece se houver venda pausada). **Retomar** recupera-a.
- Se o computador fechar inesperadamente, ao voltar aparece "Venda Anterior não Finalizada" — escolha **Recuperar** ou **Descartar**.

### 2.3. Stock
- Produtos sem stock ficam acinzentados e não podem ser adicionados.
- Aviso de stock crítico aparece ao adicionar o último stock.

### 2.4. Notificações
- As mensagens ("Venda finalizada com sucesso!") desaparecem sozinhas ao fim de 5 segundos ou clique no **✕**.

---

## 3. Gestor de Stock (Inventário)

Aceda ao módulo **Stock**. Operações sensíveis pedem o **código de gestor**.

| Tarefa | Como |
|---|---|
| Cadastrar produto | Botão "Novo Produto" — nome, categoria, preços, unidades, stock, validade, imagem |
| Ajustar stock | No produto → "Ajustar" → nova quantidade + código de gestor |
| Registar quebra | Aba "Quebras" → quantidade, motivo, justificação |
| Contagem física | Aba "Contagem Física" → introduza quantidades contadas → vê desvios e valores → "Aplicar" (gera quebras automáticas) + código de gestor |
| Transformações | Aba "Transformações" — reembalar (ex.: saco 50kg → pacotes 1kg) com conservação de custo |
| Códigos de barras | Geração individual/por lote (EAN-13); etiquetas em PDF |
| Relatórios | Baixo stock, alterações recentes, quebras, inventário por categoria (PDF/Excel) |
| Eliminar produto | Requer código de gestor — **atenção:** não remove o histórico de vendas do produto |

---

## 4. Gestor de RH

Aceda ao módulo **RH**.

- **Funcionários:** cadastro com NUIT (9 dígitos), cargo, salário, foto (câmara ou ficheiro).
- **Assiduidade:** marcar presença/falta diária.
- **Férias e processos disciplinares** no detalhe do funcionário.
- **Salários:** processar vencimento mensal (subsídios, INSS, retenção) e exportar recibos.
- **Exportações oficiais:** SISSMO (Excel), Declaração INSS e Modelo 2 AT (PDF).

---

## 5. Contabilista (Finanças e Facturas)

### Módulo Facturas
- Lista paginada com filtros de período e estado (Todas/Paga/Pendente/Crédito/Cancelada).
- **Liquidar** factura pendente → gera recibo (requer código de gestor).
- **Cancelar** factura → estorna o stock (requer código de gestor); pode **restaurar** para Pendente.
- Exportar mapa de facturação em Excel/PDF.

### Módulo Finanças
- DRE simplificada do período: receita, custo de mercadoria vendida, quebras, salários, resultado.
- Resumo por método de pagamento; gráficos de evolução.

> **Importante:** o histórico de vendas é permanente. Não existe botão para apagar facturas.

---

## 6. Gestor Geral

Acesso a **Vendas, Facturas, Stock, RH e Finanças** (sem o Painel Técnico). Para desbloquear um módulo, introduza a sua palavra-passe quando pedido.

---

## 7. Técnico (Painel Técnico)

| Secção | Função |
|---|---|
| **Definições › Empresa** | Nome, NUIT, logo, contactos, nível crítico de stock, minutos de bloqueio de sessão |
| **Definições › Bancos** | Dados bancários, M-Pesa, E-Mola (aparecem nos documentos) |
| **Definições › Impressoras** | Impressora A4 e térmica (ESC-POS) |
| **Definições › Backups** | **Descarregar Backup Completo** (JSON) — faça isto antes de qualquer manutenção grande! · Importar backup |
| **Definições › Sistema** | Código de gestor de stock · Fechar ano fiscal |
| **Utilizadores** | Criar/editar contas, perfis, obrigar troca de palavra-passe, eliminar contas (excepto `admin`) |
| **Auditoria** | Todos os eventos do sistema; filtro por período; arquivo histórico |
| **Sessões** | Quem está ligado; limpar sessões órfãs |
| **Schema** | Estrutura da base de dados (só leitura) |

> O painel mostra apenas o que executa de facto. Funcionalidades fictícias foram removidas na auditoria de Outubro/2026.

---

## 8. Perguntas Frequentes

**"A minha palavra-passe deixou de funcionar."** — Desde a auditoria de Outubro/2026, as palavras-passe **não são repostas automaticamente**. Peça a um Técnico para repor. Verifique também o Caps Lock.

**"Fiz uma venda e a impressão falhou."** — A venda ESTÁ gravada. Vá a **Facturas** (ou histórico do PDV) e reimprima.

**"Dois vendedores emitiram facturas?"** — Os números são agora transaccionais (não duplicam). Se vir algo estranho, reporte ao Técnico com o número da factura.

**"A sessão bloqueou a meio de uma venda."** — O carrinho fica guardado; desbloqueie com a sua palavra-passe e recupere a venda.

**"Posso apagar vendas de teste?"** — Não através da interface (protecção do histórico). O processo de limpeza é feito pelo suporte técnico com backup obrigatório.

---

## 9. Contactos de Suporte

- **Técnico do sistema:** Mazive / admin (contas técnicas).
- **Procedimento de emergência:** backup → contacto do suporte → intervenção documentada.
