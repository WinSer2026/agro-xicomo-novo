/**
 * Testes de regressão — falhas silênciosas (venda retroativa e gravação de utilizadores).
 *
 * Cobrem as três helpers novas que sustentam as correcções:
 *  - uid(): identificadores únicos (fim das sobreposições silenciosas de registos);
 *  - describeError(): mensagens accionáveis em vez de "Erro ao gravar.";
 *  - decidePasswordUpdate(): a decisão de palavra-passe que impedia gravar contas antigas.
 */
import { uid } from '../src/utils/idHelper';
import { describeError, formatError } from '../src/utils/errorHelper';
import {
  decidePasswordUpdate,
  validateAccessPassword,
  hashPassword,
  verifyPassword
} from '../src/utils/securityHelper';

async function runTests() {
  console.log('--- SILENT FAILURES REGRESSION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // --- uid(): unicidade ---
  console.log('\n--- Suite A: uid() uniqueness ---');
  const ids = new Set<string>();
  for (let i = 0; i < 10000; i++) ids.add(uid('sale-'));
  assert(ids.size === 10000, '10 000 ids gerados no mesmo milissegundo são todos únicos');
  assert(uid('log-').startsWith('log-'), 'uid() preserva o prefixo pedido');

  // --- describeError(): tradução de códigos ---
  console.log('\n--- Suite B: describeError() ---');
  const perm = describeError({ code: 'firestore/permission-denied' });
  assert(perm.title.includes('permissão'), 'permission-denied traduzido para linguagem corrente');
  assert(perm.hint.length > 10, 'permission-denied inclui acção sugerida');
  assert(perm.offline === false, 'permission-denied não é classificado como offline');

  const unavail = describeError(Object.assign(new Error('backend unavailable'), { code: 'unavailable' }));
  assert(unavail.offline === true, 'unavailable é classificado como falha de ligação');

  const net = describeError(new TypeError('Failed to fetch'));
  assert(net.offline === true, 'Falhas de rede do browser são classificadas como offline');
  assert(net.title.includes('internet'), 'Falha de rede menciona a ligação à internet');

  const unknown = describeError(new Error('boom'), 'Não foi possível gravar o utilizador.');
  assert(unknown.title === 'Não foi possível gravar o utilizador.', 'Fallback customizado é respeitado');
  assert(unknown.raw.includes('boom'), 'A mensagem original fica disponível para suporte');
  assert(formatError(new Error('x')).length > 0, 'formatError devolve mensagem composta');

  // --- decidePasswordUpdate(): o bug dos utilizadores ---
  console.log('\n--- Suite C: decidePasswordUpdate() ---');
  const editingHash = { passwordHash: 'sha256:abc:def' };

  const keepEmpty = decidePasswordUpdate(editingHash, '');
  assert(keepEmpty.action === 'keep' && keepEmpty.hash === editingHash.passwordHash,
    'Edição com campo vazio mantém a palavra-passe actual');

  const keepHash = decidePasswordUpdate(editingHash, 'sha256:abc:def');
  assert(keepHash.action === 'keep', 'Edição com o hash carregado no campo mantém a palavra-passe (contas antigas voltam a gravar)');

  const keepOtherHash = decidePasswordUpdate(editingHash, 'sha256:xyz:999');
  assert(keepOtherHash.action === 'keep', 'Qualquer valor de hash no campo é tratado como "manter actual"');

  const legacy = { passwordHash: 'gestor123' };
  const keepLegacy = decidePasswordUpdate(legacy, 'gestor123');
  assert(keepLegacy.action === 'keep', 'Conta antiga com senha longa em texto simples grava sem erro de política');

  const setNew = decidePasswordUpdate(editingHash, 'ab12');
  assert(setNew.action === 'set' && setNew.password === 'ab12', 'Nova palavra-passe válida na edição é aceite');

  const invalidNew = decidePasswordUpdate(editingHash, 'ab');
  assert(invalidNew.action === 'invalid', 'Nova palavra-passe fora da política (2 caracteres) é rejeitada');

  const invalidLong = decidePasswordUpdate(editingHash, 'abcdefgh');
  assert(invalidLong.action === 'invalid', 'Nova palavra-passe fora da política (8 caracteres) é rejeitada');

  const createMissing = decidePasswordUpdate(null, '');
  assert(createMissing.action === 'invalid', 'Criação sem palavra-passe é rejeitada');

  const createOk = decidePasswordUpdate(null, 'ab12');
  assert(createOk.action === 'set', 'Criação com palavra-passe válida é aceite');

  // --- Política + hashing continuam coerentes ---
  console.log('\n--- Suite D: password policy & hashing ---');
  assert(validateAccessPassword('2060').strong === true, '4 dígitos respeita a política oficial');
  assert(validateAccessPassword('gestor123').strong === false, '8 caracteres respeitam a rejeição da política oficial');
  const hash = await hashPassword('ab12');
  assert(hash.startsWith('sha256:'), 'hashPassword gera hash salgado sha256:');
  assert(await verifyPassword('ab12', hash), 'verifyPassword valida o hash gerado');
  assert(!(await verifyPassword('ab13', hash)), 'verifyPassword rejeita palavra-passe errada');

  console.log('\n========================================');
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('========================================');
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
