# 📄 DOCUMENTO DE REQUISITOS DO SISTEMA (SRS)
## AGRO — XICOMO & SERVIÇOS, LDA · ERP/POS Agrícola

| | |
|---|---|
| **Versão** | 1.0 |
| **Data** | 14/10/2026 |
| **Estado** | Aprovado para produção (pós-auditoria FASE 1–5) |
| **Documentos relacionados** | `03-arquitectura.md`, `04-matriz-permissoes-rbac.md`, `05-plano-seguranca.md` |

---

## 1. Introdução

### 1.1. Propósito
O AgroChicomo é o sistema central de gestão da empresa AgroXicomo & Serviços, LDA (Maputo, Moçambique), que comercializa insumos agrícolas (sementes, fertilizantes, pesticidas), equipamentos e serviços. O sistema cobre o ponto de venda, stock, preços, facturação, RH, contabilidade e administração.

### 1.2. Premissas
- **Multi-utilizador real:** operadores em computadores e redes diferentes, simultaneamente, com sincronização via Firebase Firestore (tempo real).
- **Custo zero:** todas as tecnologias em planos gratuitos (Vercel + Firebase Spark + bibliotecas open-source).
- **Preservação de dados:** nenhuma venda pode ser perdida; valores monetários registados são imutáveis.

### 1.3. Definições
- **PDV** — Ponto de Venda; **FACTURA** — documento fiscal definitivo/proforma; **Recibo** — comprovativo de pagamento; **Quebra** — perda física de stock; **Transformação** — reembalagem (ex.: saco → quilos).

---

## 2. Requisitos Funcionais

### 2.1. Ponto de Venda (PDV) — RF-V
| ID | Requisito | Estado |
|---|---|---|
| RF-V01 | Carrinho de compras com pesquisa por nome, código, referência e scanner de código de barras (câmara/EAN-13) | ✅ |
| RF-V02 | Adicionar/remover/alterar quantidades; validação de stock disponível (retalho/atacado) | ✅ |
| RF-V03 | Descontos por linha (por unidade, total de linha, percentual) | ✅ |
| RF-V04 | IVA opcional (16%) sobre subtotal líquido | ✅ |
| RF-V05 | Pagamentos: Dinheiro, M-Pesa, E-Mola, Transferência, Crédito, Múltiplo (repartição por método) | ✅ |
| RF-V06 | Pausar e retomar vendas; recuperação de carrinho após crash/fecho inesperado | ✅ |
| RF-V07 | Clientes (nome, NUIT, morada) associáveis à venda | ✅ |
| RF-V08 | Finalização com emissão de: Factura A4, Factura Proforma, Recibo A4, Recibo térmico 80mm, Double A5 | ✅ |
| RF-V09 | Numeração sequencial de facturas (FAC-YYYY-NNNN / FP-YYYY-NNNN) e recibos (REC-POS/REC-A4-YYYY-NNNN) **transaccional** (sem duplicados entre vendedores) | ✅ |
| RF-V10 | Dedução atómica de stock no momento da factura definitiva (batch Firestore) | ✅ |
| RF-V11 | Registo retroactivo de vendas (data/hora e recibo manual para vendas sem energia) | ✅ |
| RF-V12 | Atalhos de teclado (F1–F5 métodos de pagamento, F2 pesquisa) | ✅ |

### 2.2. Facturação e Recibos — RF-F
| ID | Requisito | Estado |
|---|---|---|
| RF-F01 | Listagem paginada de facturas com filtros por período e estado (Paga/Pendente/Crédito/Cancelada) | ✅ |
| RF-F02 | Liquidação de facturas pendentes (gera recibo) | ✅ |
| RF-F03 | Anulação com estorno de stock (requer código de gestor) e restauro para Pendente | ✅ |
| RF-F04 | Exportação Excel/PDF do mapa de facturação | ✅ |
| RF-F05 | Histórico de vendas **permanente** — não existe operação de eliminação de vendas na interface | ✅ (regra inviolável) |

### 2.3. Gestão de Stock — RF-S
| ID | Requisito | Estado |
|---|---|---|
| RF-S01 | Catálogo de produtos com paginação, categorias, imagens, datas de validade | ✅ |
| RF-S02 | Produtos híbridos (saco ↔ kg) com taxa de conversão e preços por unidade | ✅ |
| RF-S03 | Entradas, ajustes manuais e quebras (com justificação e valor de custo) | ✅ |
| RF-S04 | Contagem física com cálculo ao vivo de desvios monetários e geração automática de quebras | ✅ |
| RF-S05 | Transformações/reembalagens com conservação de custo e registo de perdas operacionais | ✅ |
| RF-S06 | Códigos de barras EAN-13 com verificação de dígito de controlo; etiquetas | ✅ |
| RF-S07 | Operações sensíveis (ajuste, eliminação, sincronização) exigem o **código de gestor** configurado no Painel Técnico | ✅ |
| RF-S08 | Relatórios: baixo stock, alterações, quebras, inventário por categoria (PDF/Excel) | ✅ |

### 2.4. Gestão de Preços — RF-P
| ID | Requisito | Estado |
|---|---|---|
| RF-P01 | Preços de compra, venda e atacado por produto | ✅ |
| RF-P02 | Validação: preço de venda não pode ser ≤ preço de compra | ✅ |
| RF-P03 | Snapshot permanente do custo em cada item vendido (margens históricas correctas) | ✅ |

### 2.5. Utilizadores e Permissões — RF-U
| ID | Requisito | Estado |
|---|---|---|
| RF-U01 | 6 perfis: Operador, Gestor de Stock, Gestor de RH, Contabilista, Gestor Geral, Técnico; multi-perfil por utilizador | ✅ |
| RF-U02 | Login com palavras-passe fortes (PBKDF2-SHA256, 120k iterações) | ✅ |
| RF-U03 | Política de palavras-passe: 4–6 caracteres (letras/números); troca obrigatória no primeiro acesso de contas novas | ✅ |
| RF-U04 | Criação/edição/eliminação de contas pelo Painel Técnico (a única forma de mudar hierarquias) | ✅ |
| RF-U05 | Protecção anti-força-bruta: CAPTCHA após 3 falhas; bloqueio de 15 min após 5 falhas | ✅ (limite: controlo local do navegador) |
| RF-U06 | Sessão bloqueia por inactividade (15 min predefinido, configurável) sem perder o trabalho em curso | ✅ |

### 2.6. Facturação RH — RF-R
| ID | Requisito | Estado |
|---|---|---|
| RF-R01 | Cadastro de funcionários ( NUIT 9 dígitos, contactos, foto) | ✅ |
| RF-R02 | Assiduidade, férias, processos disciplinares, danos materiais | ✅ |
| RF-R03 | Processamento salarial com subsídios, INSS, retenção AT e recibos | ✅ |
| RF-R04 | Exportações: SISSMO (Excel), Declaração INSS, Modelo 2 AT (PDF) | ✅ |

### 2.7. Administração e Contabilidade — RF-C
| ID | Requisito | Estado |
|---|---|---|
| RF-C01 | DRE simplificada por período (receita, CMV, quebras, salários, resultado) | ✅ |
| RF-C02 | Receitas/despesas e movimento de caixa | ✅ |
| RF-C03 | Relatórios financeiros por intervalo de datas (presets: Hoje, Esta Semana, Este Mês, personalizado) | ✅ |

### 2.8. Painel Técnico — RF-T
| ID | Requisito | Estado |
|---|---|---|
| RF-T01 | Definições da empresa (nome, NUIT, logo, contactos, bancos, M-Pesa/E-Mola) | ✅ |
| RF-T02 | Impressoras (A4 e térmica série/ESC-POS) | ✅ |
| RF-T03 | Backups: exportação/importação JSON completa | ✅ |
| RF-T04 | Código de gestor de stock, nível crítico de stock, timeout de sessão | ✅ |
| RF-T05 | Gestão de utilizadores e perfis | ✅ |
| RF-T06 | Logs de auditoria paginados com arquivo histórico (sem eliminação) | ✅ |
| RF-T07 | Sessões activas (visualização e limpeza de órfãs) | ✅ |
| RF-T08 | Schema da base em só-leitura | ✅ |
| RF-T09 | **Sem** controles que não possam ser executados de facto (removidos: Nuvem/PostgreSQL, IA, zerar sistema) | ✅ (limpeza pós-auditoria) |

### 2.9. Notificações — RF-N
| ID | Requisito | Estado |
|---|---|---|
| RF-N01 | Toasts unificados: aparecem, desaparecem ao fim de 5 s e têm botão de fechar | ✅ (corrigido pós-auditoria) |
| RF-N02 | Sino de alertas de stock crítico (persistente até consulta) | ✅ |

---

## 3. Requisitos Não-Funcionais

| ID | Requisito | Meta |
|---|---|---|
| RNF-01 | **Concorrência:** ≥12 operadores simultâneos em redes distintas sem conflitos | Sincronização Firestore em tempo real |
| RNF-02 | **Disponibilidade:** depende da Vercel/Firebase (SLA de free tier); operação local continua com cache do Firestore | — |
| RNF-03 | **Desempenho:** catálogo e facturas paginados (30–50/página); agregados no servidor | ✅ |
| RNF-04 | **Segurança:** passwords PBKDF2; histórico de vendas imutável (regras Firestore); auditoria de eventos | ✅ (ver `05-plano-seguranca.md`) |
| RNF-05 | **Custo:** 0 MT — Vercel free, Firebase Spark, npm gratuito | ✅ |
| RNF-06 | **Usabilidade:** operação por teclado no PDV; PT de Moçambique | ✅ |
| RNF-07 | **Integridade monetária:** valores de vendas registados são imutáveis; cálculos cobertos por testes unitários | ✅ (45 testes) |
| RNF-08 | **Backup:** exportação manual JSON + backups automáticos locais no navegador (3 cópias) | ✅ (ver `07-plano-backup-recuperacao.md`) |

---

## 4. Regras de Negócio

1. **RN-01:** O histórico de vendas é permanente — não existe eliminação de vendas na interface.
2. **RN-02:** Venda de factura definitiva deduz stock atomicamente; anulação estorna o stock.
3. **RN-03:** Preço de venda > preço de compra (validação no cadastro).
4. **RN-04:** O custo registado em cada item da venda é um snapshot permanente (não muda com alterações futuras do produto).
5. **RN-05:** Números de factura/recibo são sequenciais, sem lacunas por omissão nem duplicação (reserva transaccional).
6. **RN-06:** Operações sensíveis de stock exigem o código de gestor.
7. **RN-07:** Apenas o Técnico acede ao painel técnico; o Gestor Geral acede a tudo menos ao painel técnico.
8. **RN-08:** Transformações conservam o custo total (custo do produto original = valor dos produtos resultantes + perda operacional).
9. **RN-09:** Quebras registadas na contagem física têm valor de custo calculado sobre `buyingPrice` do produto.
10. **RN-10:** Cada venda guarda o operador que a realizou e o momento do registo.

---

## 5. Requisitos de Interface

- Layout responsivo (desktop prioritário; tablets usáveis no armazém);
- Toasts no canto inferior direito, sem obstruir a operação;
- Modais de confirmação para operações críticas (anular factura, eliminar produto, eliminar utilizador);
- Impressões: A4, térmica 80mm, Double A5 — pré-visualização antes de imprimir.

---

## 6. Fora de Escopo (planeado)

- Migração para Firebase Auth + regras por utilizador (endurecimento de segurança);
- MFA real (via Firebase Auth);
- App nativo / uso offline prolongado com reenvio de fila;
- Multi-loja / multi-empresa.

---

## 7. Critérios de Aceitação Globais

1. Todos os testes unitários passam (`npm test` ≥ 45) e `npm run lint` sem erros;
2. Um operador pode finalizar uma venda de ponta a ponta com stock deduzido e documento emitido;
3. Dois operadores em computadores diferentes não geram números de factura duplicados;
4. Nenhuma notificação fica no ecrã para além de 5 s (excepto alertas de stock no sino);
5. As vendas existentes permanecem visíveis após qualquer intervenção.
