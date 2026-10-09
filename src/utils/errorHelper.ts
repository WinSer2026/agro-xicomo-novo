/**
 * Helpers de erro / feedback de operações
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Objectivo: NUNCA mostrar ao utilizador uma mensagem genérica do tipo
 * "Erro ao gravar." sem lhe dizer o que se passou nem o que fazer a seguir.
 * Firestore devolve erros com `code` (ex.: 'permission-denied', 'unavailable'),
 * que traduzimos para linguagem corrente em português de Moçambique.
 */

export interface FriendlyError {
  title: string;      // título curto para o toast/banner
  hint: string;       // o que o utilizador pode fazer
  offline: boolean;   // true quando a causa é ligação/servidor
  raw: string;        // mensagem técnica original (para o console / suporte)
}

const MESSAGES: Record<string, { title: string; hint: string; offline?: boolean }> = {
  'permission-denied': {
    title: 'O sistema não tem permissão para gravar neste momento.',
    hint: 'As regras de segurança da base de dados estão a bloquear a escrita. Contacte o técnico para publicar as regras do Firestore.'
  },
  unavailable: {
    title: 'Servidor indisponível ou sem ligação à internet.',
    hint: 'Verifique a sua ligação. Tente novamente assim que houver rede estável.',
    offline: true
  },
  'deadline-exceeded': {
    title: 'A operação demorou demasiado tempo.',
    hint: 'A ligação está muito lenta. Tente novamente.',
    offline: true
  },
  cancelled: {
    title: 'A operação foi cancelada.',
    hint: 'Tente novamente.',
    offline: true
  },
  unauthenticated: {
    title: 'Sessão expirada ou credenciais inválidas.',
    hint: 'Termine sessão e volte a entrar no sistema.'
  },
  'failed-precondition': {
    title: 'A base de dados rejeitou a operação.',
    hint: 'Pode ser necessário um índice no Firestore ou a cache local está bloqueada. Recarregue a página e tente de novo.'
  },
  'not-found': {
    title: 'Registo não encontrado na base de dados.',
    hint: 'O registo pode ter sido apagado noutro terminal. Actualize a lista e tente novamente.'
  },
  'already-exists': {
    title: 'Já existe um registo com esse identificador.',
    hint: 'Altere o código/identificador e tente novamente.'
  },
  'resource-exhausted': {
    title: 'Limite de utilização da base de dados excedido.',
    hint: 'A quota do projeto foi ultrapassada. Contacte o administrador.'
  },
  'invalid-argument': {
    title: 'Dados inválidos enviados para a base de dados.',
    hint: 'Verifique se todos os campos numéricos estão preenchidos (ex.: stock, preços).'
  },
  unimplemented: {
    title: 'Operação não suportada pela base de dados.',
    hint: 'Contacte o técnico do sistema.'
  },
  internal: {
    title: 'Erro interno da base de dados.',
    hint: 'Tente novamente dentro de alguns instantes.',
    offline: true
  }
};

/** Converte qualquer excepção numa mensagem accionável em português. */
export function describeError(err: unknown, fallbackTitle = 'Ocorreu um erro inesperado.'): FriendlyError {
  const raw = err instanceof Error
    ? `${err.name}: ${err.message}`
    : typeof err === 'string'
      ? err
      : JSON.stringify(err ?? null);

  const code = String((err as { code?: string })?.code || '')
    .replace(/^firestore\//, '')
    .replace(/^auth\//, '')
    .toLowerCase();

  const known = MESSAGES[code];
  if (known) {
    return { title: known.title, hint: known.hint, offline: Boolean(known.offline), raw };
  }

  // Falhas de rede do próprio browser (TypeError "Failed to fetch", etc.)
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(raw)) {
    return {
      title: 'Sem ligação à internet.',
      hint: 'Verifique a rede do dispositivo e tente novamente.',
      offline: true,
      raw
    };
  }

  return {
    title: fallbackTitle,
    hint: 'Verifique os dados introduzidos e tente novamente. Se persistir, contacte o técnico.',
    offline: false,
    raw
  };
}

/** Mensagem completa (título + dica) pronta para toasts. */
export function formatError(err: unknown, fallbackTitle?: string): string {
  const info = describeError(err, fallbackTitle);
  return `${info.title} ${info.hint}`.trim();
}
