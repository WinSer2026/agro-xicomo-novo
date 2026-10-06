import { AppRole } from '../types';

/**
 * RESET OFICIAL DE CREDENCIAIS
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Estas são as ÚNICAS credenciais válidas após o reset (versão definida abaixo).
 * As palavras-passe são TEMPORÁRIAS e estão guardadas apenas em hash SHA-256 (nunca em
 * texto simples): no primeiro login o sistema obriga cada operador a definir uma nova
 * palavra-passe com 4 a 6 caracteres (letras e/ou números), sem símbolos obrigatórios e
 * podendo repetir uma palavra-passe antiga.
 *
 * Lista de contas abrangidas pelo reset (versão atual):
 *   Mazive (Técnico) · admin (Técnico) · Salvador (Gestor Geral) · gestor1 (Gestor Geral)
 *   Nelson (Gestor Geral) · Vanda (Gestor Geral) · Ainara (Contabilista)
 *   Ainira (Contabilista) · Maria (Operador)
 */

export const CREDENTIALS_RESET_VERSION = 2;

export interface ResettableCredential {
  id: string;
  username: string;
  /** Hash SHA-256 da palavra-passe temporária (formato: sha256:salt:hash) */
  passwordHash: string;
  role: string;
  roles: AppRole[];
}

export const OFFICIAL_RESET_CREDENTIALS: ResettableCredential[] = [
  { id: 'usr-mazive', username: 'Mazive', passwordHash: 'sha256:AXmazive2026:1c1c585795b1b2e566ae4087022ec4561d1771d3108d0e0f8d52c5940bf27e3f', role: 'Técnico', roles: ['Técnico'] },
  { id: 'usr-admin', username: 'admin', passwordHash: 'sha256:AXadmin2026:ffe6646a86429864a103ddd12a441381390e88eee2e1d639268c4360b0e67e02', role: 'Técnico', roles: ['Técnico'] },
  { id: 'usr-salvador', username: 'Salvador', passwordHash: 'sha256:AXsalvador2026:7fed5686171c53903adb151b06b46cbf6d5ec424ee13090a5adb3f21a0e32c9a', role: 'Gestor Geral', roles: ['Gestor Geral'] },
  { id: 'usr-gestor1', username: 'gestor1', passwordHash: 'sha256:AXgestor12026:adf9296fccf31e2a16de103a0987f73417a788e4b6219390f64704cd3ceb8d5a', role: 'Gestor Geral', roles: ['Gestor Geral'] },
  { id: 'usr-nelson', username: 'Nelson', passwordHash: 'sha256:AXnelson2026:dd2d3ae8b2a1877de03293bc88ef9b64e5101d738397aecc0ef27d9abc97eb7d', role: 'Gestor Geral', roles: ['Gestor Geral'] },
  { id: 'usr-vanda', username: 'Vanda', passwordHash: 'sha256:AXvanda2026:a52f13ad00ef5eab091286d6701a929a6f995d9138803c5f35e2580b3128b5b7', role: 'Gestor Geral', roles: ['Gestor Geral'] },
  { id: 'usr-ainara', username: 'Ainara', passwordHash: 'sha256:AXainara2026:74312de262fa52c190ec8c43c2643631a91dd4e5a816e9ea302a6b0e770a9c76', role: 'Contabilista', roles: ['Contabilista'] },
  { id: 'usr-ainira', username: 'Ainira', passwordHash: 'sha256:AXainira2026:950e073ba0742e873693f6379ba8931cf20f89786676b1e6d45fcd95873db6e6', role: 'Contabilista', roles: ['Contabilista'] },
  { id: 'usr-maria', username: 'Maria', passwordHash: 'sha256:AXmaria2026:812d9a65b00eda810ec0209c5dbc697fcde4cd8b60e025b4dc35061a7504c0af', role: 'Operador', roles: ['Operador'] }
];
