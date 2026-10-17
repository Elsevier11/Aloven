#!/usr/bin/env bash
# Esegue le suite browser una dopo l'altra e stampa una riga di esito per ciascuna.
# Uso: PLAYWRIGHT_PATH=... ALOVEN_NOW=2026-10-07T06:00:00Z ./run-regression.sh [suite ...]
cd "$(dirname "$0")" || exit 1
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(planning-week planning-drag planning-clarity planning-unified planner-fluidity statistics interface premium reparto planning-live planning-density planner planning-workflow maintenance operator release-operator insights mes operational ui desktop-flow resilience design)
for s in "${suites[@]}"; do
  out=$(timeout 300 npm run "test:$s" 2>&1 | grep -vE "Experimental|trace-warn|^>|^$")
  if echo "$out" | grep -qE "FAIL|AssertionError|Error:|TimeoutError"; then status="KO"; else status="OK"; fi
  echo "$status $s :: $(echo "$out" | grep -E "FAIL|AssertionError|passed|PASS" | tail -2 | tr '\n' ' ' | cut -c1-220)"
done
printf "%s task-list :: " "$(timeout 200 node task-list-check.mjs >/dev/null 2>&1 && echo OK || echo KO)"; echo
