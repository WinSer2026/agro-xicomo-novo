/**
 * Teste de cobertura das regras do Firestore.
 *
 * Porque existe: as regras negam tudo o que não esteja listado. Uma colecção
 * nova usada pelo código e esquecida no ficheiro de regras funciona em
 * desenvolvimento (onde as regras afrouxadas ainda estão publicadas) e falha em
 * produção — em silêncio, ou pior, a meio de uma operação de dinheiro.
 *
 * Este teste varre o código à procura dos nomes de colecção e compara com
 * `firestore.rules`. Também recusa o regresso das regras abertas.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

function ficheiros(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) ficheiros(caminho, acc);
    else if (/\.(ts|tsx)$/.test(caminho)) acc.push(caminho);
  }
  return acc;
}

const nomesUsados = new Set<string>();
const padroes = [
  /(?:collection\(db,\s*|doc\(db,\s*|upsert\(\s*|getAll<[^>]*>\(\s*)'([a-z_]+)'/g,
  /(?:upsert|getAll|addDoc|setDoc)\(\s*'([a-z_]+)'/g
];

for (const caminho of ficheiros('src')) {
  const conteudo = readFileSync(caminho, 'utf-8');
  for (const padrao of padroes) {
    let m: RegExpExecArray | null;
    while ((m = padrao.exec(conteudo)) !== null) nomesUsados.add(m[1]);
  }
}

const regrasCruas = readFileSync('firestore.rules', 'utf-8');
// Comentários fora: o ficheiro fala das regras antigas e não deve disparar o teste.
const regras = regrasCruas
  .split('\n')
  .map(linha => linha.replace(/\/\/.*$/, ''))
  .join('\n');
const listadas = new Set<string>();
let m: RegExpExecArray | null;
const regexRegras = /match\s+\/([a-z_]+)\/\{docId\}/g;
while ((m = regexRegras.exec(regras)) !== null) listadas.add(m[1]);

const faltam = [...nomesUsados].filter(nome => !listadas.has(nome)).sort();

ok('há colecções detetadas no código', nomesUsados.size > 5);

// A cópia pronta a colar na consola é o que uma pessoa não técnica vai usar.
// Se ficar desactualizada, publica-se meia fechadura — este teste evita isso.
const ficheiroCola = 'REGRAS-FIRESTORE-PARA-COLAR.txt';
if (existsSync(ficheiroCola)) {
  const cola = readFileSync(ficheiroCola, 'utf-8');
  const semCabecalho = cola.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
  ok('a cópia para colar coincide com firestore.rules', semCabecalho === regrasCruas.trim());
  ok('a cópia para colar começa em rules_version', semCabecalho.startsWith("rules_version = '2';"));
  ok('a cópia para colar termina na chave final', semCabecalho.endsWith('}'));
  ok('a cópia para colar inclui cash_sessions', semCabecalho.includes('match /cash_sessions/{docId}'));
}
ok(`todas as colecções usadas estão nas regras (faltam: ${faltam.join(', ') || 'nenhuma'})`, faltam.length === 0);
ok('cash_movements está protegida', listadas.has('cash_movements'));
ok('sales está protegida', listadas.has('sales'));
ok('credentials está protegida', listadas.has('credentials'));
ok('audit_logs está protegida', listadas.has('audit_logs'));

ok('não há "allow read, write: if true"', !/allow\s+read\s*,\s*write\s*:\s*if\s+true/.test(regras));
ok('não há negação em falta (match /{document=**})', regras.includes('match /{document=**}'));
ok('o ficheiro nega por omissão', /match\s+\/\{document=\*\*\}\s*\{[^}]*if\s+false/.test(regras));
ok('as regras exigem autenticação', regras.includes('request.auth != null'));
ok('o livro de caixa é imutável', /match\s+\/cash_movements\/\{docId\}\s*\{[^}]*allow update, delete: if false/.test(regras));
ok('o livro de stock é imutável', /match\s+\/stock_movements\/\{docId\}\s*\{[^}]*allow update, delete: if false/.test(regras));

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
