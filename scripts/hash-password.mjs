#!/usr/bin/env node
/**
 * Gera um hash de palavra-passe no formato usado pela aplicação
 * (`sha256:salt:hash`), compatível com `src/utils/securityHelper.ts`.
 *
 * Uso:
 *   node scripts/hash-password.mjs "minha-palavra-passe"
 *
 * O resultado deve ser guardado no campo `passwordHash` da credencial
 * (Firestore → coleção `credentials`) ou em `stockPasswordHash` das definições.
 * É assim que se repõe o acesso de um operador sem voltar a introduzir
 * palavras-passe em texto simples no código.
 */
import { randomBytes, createHash } from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('Uso: node scripts/hash-password.mjs "palavra-passe"');
  process.exit(1);
}

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const bytes = randomBytes(16);
let salt = '';
for (let i = 0; i < 16; i += 1) {
  salt += chars[bytes[i] % chars.length];
}

const hash = createHash('sha256').update(salt + password, 'utf8').digest('hex');
console.log(`sha256:${salt}:${hash}`);
