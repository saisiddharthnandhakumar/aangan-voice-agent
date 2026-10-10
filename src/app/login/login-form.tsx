"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="password">
        Password
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-describedby={state.error ? "login-error" : undefined}
          className="h-11 rounded-lg border border-line bg-surface px-3 text-base font-normal"
        />
      </label>
      {state.error && (
        <p id="login-error" role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad-ink">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="h-11 rounded-lg bg-accent text-base font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
