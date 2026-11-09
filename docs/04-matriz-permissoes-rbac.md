# 🔐 MATRIZ DE PERMISSÕES (RBAC)
## AGRO — XICOMO & SERVIÇOS, LDA

Versão 1.0 · 14/10/2026

## 1. Perfis do Sistema

| ID | Perfil | Missão |
|---|---|---|
| `Operador` | Operador de Caixa | Vendas no PDV e consulta de facturas |
| `Gestor de Stock` | Gestor de Stock | Inventário, entradas/saídas, quebras, transformações |
| `Gestor de RH` | Gestor de Recursos Humanos | Funcionários, assiduidade, salários |
| `Contabilista` | Contabilista e Financeiro | Contabilidade, caixa, relatórios financeiros |
| `Gestor Geral` | Gestor Geral | PDV + Stock + RH + Finanças (sem painel técnico) |
| `Técnico` | Técnico | Acesso total, incluindo Painel Técnico |

> Um utilizador pode ter **vários perfis** (ex.: Operador + Gestor de Stock).

## 2. Matriz de Acesso a Módulos

| Módulo | Operador | Gestor Stock | Gestor RH | Contabilista | Gestor Geral | Técnico |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| PDV (Vendas) | ✅ | — | — | — | ✅ | ✅ |
| Facturas | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Stock & Inventário | — | ✅ | — | — | ✅ | ✅ |
| Recursos Humanos | — | — | ✅ | — | ✅ | ✅ |
| Finanças & Contabilidade | — | — | — | ✅ | ✅ | ✅ |
| Painel Técnico | — | — | — | — | — | ✅ |

Regra de implementação (`App.tsx · isModuleAccessible`): Técnico acede a tudo; Gestor Geral a tudo excepto `tecnico`; os restantes aos módulos do(s) seu(s) perfil(s).

## 3. Matriz de Operações

| Operação | Operador | Gestor Stock | Gestor RH | Contabilista | Gestor Geral | Técnico |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Registar venda / emitir recibo | ✅ | — | — | — | ✅ | ✅ |
| Pausar/recuperar venda | ✅ | — | — | — | ✅ | ✅ |
| Liquidar factura | ✅* | ✅* | — | ✅* | ✅* | ✅ |
| Cancelar factura (estorno stock) | ✅* | ✅* | — | ✅* | ✅* | ✅ |
| Cadastrar/editar produto | — | ✅ | — | — | ✅ | ✅ |
| Eliminar produto | — | ✅* | — | — | ✅* | ✅ |
| Ajustar stock manual | — | ✅* | — | — | ✅* | ✅ |
| Registar quebra | — | ✅ | — | — | ✅ | ✅ |
| Contagem física / transformações | — | ✅* | — | — | ✅* | ✅ |
| Gerir preços | — | ✅ | — | — | ✅ | ✅ |
| Gerir funcionários / salários | — | — | ✅ | — | ✅ | ✅ |
| Relatórios financeiros | — | — | — | ✅ | ✅ | ✅ |
| Exportar Excel/PDF (facturas) | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Criar/editar utilizadores | — | — | — | — | — | ✅ |
| Eliminar utilizador | — | — | — | — | — | ✅ |
| Repor palavra-passe de terceiros | — | — | — | — | — | ✅ |
| Definições da empresa | — | — | — | — | — | ✅ |
| Código de gestor de stock | — | — | — | — | — | ✅ |
| Backups (exportar/importar) | — | — | — | — | — | ✅ |
| Ver logs de auditoria | — | — | — | — | — | ✅ |
| Gerir sessões activas | — | — | — | — | — | ✅ |
| Fechar ano fiscal | — | — | — | — | — | ✅ |
| **Apagar vendas** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (não existe na interface) |

`*` = requer o **código de gestor de stock** (configurado em Painel Técnico → Sistema).

## 4. Regras Transversais

1. **Hierarquias** só mudam por acção deliberada de um Técnico (Painel Técnico → Utilizadores). Nenhum processo automático altera perfis.
2. **Palavra-passe própria** é sempre necessária para: login, desbloqueio de sessão e desbloqueio de módulos.
3. **Histórico de vendas** é imutável para todos os perfis (regra inviolável do negócio; reforçada pelas regras do Firestore).
4. **Conta `admin`** não pode ser eliminada.
5. Contas novas exigem **troca de palavra-passe no primeiro login** (quando definido pelo Técnico).

## 5. Compatibilidade com o Futuro (Firebase Auth)

Quando a autenticação migrar para o Firebase Auth, cada perfil passará a corresponder a *custom claims* (`role: 'operador' | 'gestor_stock' | …`) validados nas regras do Firestore — a matriz acima mantém-se como contrato funcional.
