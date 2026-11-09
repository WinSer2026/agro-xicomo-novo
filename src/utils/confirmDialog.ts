/**
 * Diálogos de confirmação da aplicação.
 *
 * Substituem `window.confirm` / `window.prompt` / `window.alert`, que devolvem
 * `null`/`false` sem mostrar nada quando a aplicação corre dentro de um iframe
 * ou num ambiente embebido — e a operação desaparecia em silêncio (achado K-01).
 *
 * O `DialogHost` (montado em `App`) desenha o modal; estas funções só pedem.
 */

export type DialogRequest =
  | { id: number; kind: 'confirm'; message: string; confirmLabel: string; danger: boolean }
  | { id: number; kind: 'prompt'; message: string; defaultValue: string; confirmLabel: string }
  | { id: number; kind: 'alert'; message: string; confirmLabel: string };

type Resolver = (value: boolean | string | null) => void;

let nextId = 1;
const resolvers = new Map<number, Resolver>();
const listeners = new Set<(request: DialogRequest | null) => void>();
let current: DialogRequest | null = null;

function emit(request: DialogRequest | null) {
  current = request;
  listeners.forEach(listener => listener(request));
}

export function subscribeDialogs(listener: (request: DialogRequest | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveDialog(id: number, value: boolean | string | null) {
  const resolver = resolvers.get(id);
  resolvers.delete(id);
  emit(null);
  resolver?.(value);
}

export function appConfirm(
  message: string,
  options: { confirmLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  const id = nextId++;
  return new Promise<boolean>(resolve => {
    resolvers.set(id, value => resolve(value === true));
    emit({
      id,
      kind: 'confirm',
      message,
      confirmLabel: options.confirmLabel || 'Confirmar',
      danger: options.danger !== false
    });
  });
}

export function appPrompt(message: string, defaultValue = ''): Promise<string | null> {
  const id = nextId++;
  return new Promise<string | null>(resolve => {
    resolvers.set(id, value => resolve(typeof value === 'string' ? value : null));
    emit({ id, kind: 'prompt', message, defaultValue, confirmLabel: 'Confirmar' });
  });
}

export function appAlert(message: string): Promise<void> {
  const id = nextId++;
  return new Promise<void>(resolve => {
    resolvers.set(id, () => resolve());
    emit({ id, kind: 'alert', message, confirmLabel: 'Fechar' });
  });
}
