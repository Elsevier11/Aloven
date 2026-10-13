/** Advisory checks on the existing single-activity model; no order type is inferred. */
export function taskWarnings(task, today = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Rome'}).format(new Date())) {
  const warnings = [];
  if ((task.component1ArticleId && task.component1ArticleId === task.component2ArticleId) ||
      (task.component1Code && task.component1Code.trim().toLocaleLowerCase('it') === task.component2Code?.trim().toLocaleLowerCase('it'))) {
    warnings.push('I due componenti sono uguali. Verifica che sia intenzionale.');
  }
  if (task.quantity == null) warnings.push('Quantità prevista assente: il confronto previsto/effettivo non sarà disponibile.');
  if (!task.dueDate) warnings.push('Consegna non indicata: la puntualità non sarà calcolabile.');
  else if (task.dueDate < today) warnings.push('La consegna prevista è nel passato.');
  return warnings;
}
