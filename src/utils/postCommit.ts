/**
 * Helpers for work that happens only after the main database mutation succeeds.
 *
 * A sale, stock adjustment or payment must never be reported as failed merely
 * because a secondary task (refreshing the screen, generating a PDF, etc.)
 * fails afterwards.  These helpers keep those secondary failures observable in
 * the console without changing the outcome of the already-committed action.
 */

export type PostCommitTask = {
  label: string;
  task: () => Promise<unknown> | unknown;
};

/**
 * Runs a non-critical task and returns whether it completed. It deliberately
 * never throws: callers can continue to confirm the committed business action.
 */
export async function runPostCommitTask(task: PostCommitTask): Promise<boolean> {
  try {
    await task.task();
    return true;
  } catch (error) {
    console.warn(`[PostCommit] ${task.label} falhou depois de a operação principal ter sido gravada.`, error);
    return false;
  }
}

/**
 * Runs independent post-commit tasks and returns the labels of tasks that did
 * not finish. Tasks are allowed to run in parallel because none of them is
 * responsible for the persisted business result.
 */
export async function runPostCommitTasks(tasks: PostCommitTask[]): Promise<string[]> {
  const results = await Promise.all(
    tasks.map(async (task) => ({
      label: task.label,
      completed: await runPostCommitTask(task)
    }))
  );

  return results.filter(result => !result.completed).map(result => result.label);
}
