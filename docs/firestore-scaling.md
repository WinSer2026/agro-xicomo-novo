# Escalabilidade Firestore: faturas, produtos e auditoria

Esta aplicação passou a separar **listas operacionais** de **exportações e operações globais**:

- **Faturas** consulta 30 documentos de cada vez, já filtrados por período e estado no Firestore. Os cartões de resumo usam agregações do servidor; não dependem da página visível.
- **Auditoria técnica** consulta 50 registos de cada vez, já filtrados por período. Pode alternar entre `audit_logs` (ativos) e `audit_logs_archive` (arquivo histórico).
- **Exportações** são explícitas: percorrem todas as páginas do período selecionado para que PDF/Excel não exportem apenas a página visível.
- **Inventário** pagina a tabela em blocos de 50 para manter a interface leve. O catálogo completo continua disponível nas operações que precisam dele de propósito (PDV, reconciliação física, transformação e ações em lote).
- A inicialização geral já não abre subscrições em tempo real para todas as vendas e todos os produtos. PDV, Stock, Dashboard e Finanças ativam essa sincronização completa apenas quando entram nos fluxos que realmente dependem dela; o alerta da barra superior consulta somente artigos abaixo do nível crítico.

## Índices

`firestore.indexes.json` contém os índices compostos usados pela paginação de vendas:

1. `sales`: `status ASC`, `date DESC` — estado + período + ordenação da lista e dos agregados;
2. `products`: `category ASC`, `name ASC` — preparado para a consulta paginada por categoria.

As consultas por data/hora de auditoria (`timestamp`) usam o índice simples automático do Firestore, tanto em `audit_logs` como em `audit_logs_archive`.

### Publicar os índices

O ficheiro `firebase.json` aponta para a base Firestore usada pela aplicação. Depois de confirmar que a CLI está autenticada na conta Firebase correta, execute a partir da raiz do projeto:

```bash
npx firebase-tools deploy --only firestore:indexes --project gen-lang-client-0896153566
```

A criação dos índices pode demorar alguns minutos. Enquanto um índice estiver em construção, o Firestore devolve na consola um link de criação; não substitua o ficheiro de índices por esse link — deixe a criação terminar e mantenha este ficheiro versionado.

## Arquivo seguro de auditoria

No painel **Técnico → Registos**, o botão **Arquivar lote seguro** move até 200 registos anteriores à data indicada por clique.

Para cada registo, a aplicação faz no mesmo `writeBatch` atómico:

1. grava uma cópia integral em `audit_logs_archive`, com `archivedAt` e `archivedFrom`;
2. remove a cópia da coleção operacional `audit_logs`.

Como são duas escritas por registo, o lote fica abaixo do limite Firestore de 500 escritas. Se o commit falhar, nenhuma das duas alterações é confirmada: o registo ativo não se perde. Repita o botão enquanto a confirmação informar que ainda existem mais registos.

O arquivo **não é eliminação definitiva**. Utilize o seletor **Arquivo histórico** e o mesmo filtro por período para consultar ou exportar os registos antigos. Os backups completos passam a incluir `audit_logs_archive` e a restauração aceita essa coleção; importações grandes são divididas em commits de até 450 documentos.

## Retenção sugerida

Uma política prática é manter 6 a 12 meses em `audit_logs` e arquivar mensalmente o período mais antigo. Antes de um arquivo volumoso, exporte o período para PDF/Excel ou faça o backup administrativo habitual.

## Limites intencionais

- A pesquisa livre por texto no catálogo continua local porque Firestore não oferece pesquisa parcial/case-insensitive nativa. Para volumes muito grandes, o próximo passo é indexar termos de pesquisa ou integrar um motor de pesquisa dedicado.
- Relatórios financeiros completos e backups continuam a ler todos os dados necessários de forma deliberada; não devem ser trocados silenciosamente por uma única página, pois isso alteraria os seus totais.
- Este documento não altera regras de acesso Firestore. A proteção das regras deve ser tratada como uma tarefa de segurança separada.
