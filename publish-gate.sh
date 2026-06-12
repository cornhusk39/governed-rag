#!/usr/bin/env bash
# The hard gate before any human publish. It must never be edited to pass; if it
# fails, fix the finding. Every check here is something that, if wrong, would
# either leak a secret or ship a broken build. Exit non-zero on any problem so
# the failure is unambiguous.
set -uo pipefail

cd "$(dirname "$0")"

fail=0
section() { printf "\n=== %s ===\n" "$1"; }
ok() { printf "  ok: %s\n" "$1"; }
bad() { printf "  FAIL: %s\n" "$1"; fail=1; }

section "Secret hygiene"

# A tracked .env is the single most common way real keys reach a public repo.
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  bad ".env is tracked by git"
else
  ok ".env is not tracked"
fi

# .gitignore must actually ignore .env, not just by convention.
if git check-ignore -q .env; then
  ok ".env is gitignored"
else
  bad ".env is not gitignored"
fi

# The example file documents required env without holding secrets.
if [ -f .env.example ]; then
  ok ".env.example present"
else
  bad ".env.example missing"
fi

# The secret-scanning hook must be wired up, not just present on disk.
if [ "$(git config core.hooksPath)" = ".githooks" ] && [ -x .githooks/pre-commit ]; then
  ok "gitleaks pre-commit hook is installed and executable"
else
  bad "gitleaks pre-commit hook is not wired (core.hooksPath / executable bit)"
fi

section "Full-history secret scan (gitleaks)"
if ! command -v gitleaks >/dev/null 2>&1; then
  bad "gitleaks not installed"
else
  if gitleaks git --redact --no-banner --config .gitleaks.toml .; then
    ok "no secrets found in history"
  else
    bad "gitleaks found secrets in history (rotate, then scrub before publishing)"
  fi
fi

section "Full-history secret scan (trufflehog)"
# A second, independent scanner. Different engines catch different patterns; for
# a regulated-domain public repo the redundancy is worth the extra seconds.
if ! command -v trufflehog >/dev/null 2>&1; then
  bad "trufflehog not installed"
else
  if trufflehog --no-update git "file://$(pwd)" --only-verified --fail >/tmp/governed-rag-trufflehog.log 2>&1; then
    ok "no verified secrets found in history"
  else
    bad "trufflehog found verified secrets in history (see /tmp/governed-rag-trufflehog.log)"
  fi
fi

section "Working tree is clean"
if [ -z "$(git status --porcelain)" ]; then
  ok "no uncommitted changes"
else
  bad "uncommitted changes present (commit or stash before gating)"
fi

section "Install, typecheck, lint, test"
if pnpm install --frozen-lockfile >/tmp/governed-rag-gate-install.log 2>&1; then
  ok "pnpm install (frozen lockfile)"
else
  bad "pnpm install failed (see /tmp/governed-rag-gate-install.log)"
fi

if pnpm -r typecheck >/tmp/governed-rag-gate-typecheck.log 2>&1; then
  ok "typecheck"
else
  bad "typecheck failed (see /tmp/governed-rag-gate-typecheck.log)"
fi

if pnpm lint >/tmp/governed-rag-gate-lint.log 2>&1; then
  ok "lint"
else
  bad "lint failed (see /tmp/governed-rag-gate-lint.log)"
fi

if pnpm test >/tmp/governed-rag-gate-test.log 2>&1; then
  ok "tests"
else
  bad "tests failed (see /tmp/governed-rag-gate-test.log)"
fi

section "Build"
if pnpm build >/tmp/governed-rag-gate-build.log 2>&1; then
  ok "build (includes the Next.js demo, proving it compiles for the hosted demo)"
else
  bad "build failed (see /tmp/governed-rag-gate-build.log)"
fi

section "Result"
if [ "$fail" -eq 0 ]; then
  echo "publish-gate: PASS"
  exit 0
else
  echo "publish-gate: FAIL"
  exit 1
fi
