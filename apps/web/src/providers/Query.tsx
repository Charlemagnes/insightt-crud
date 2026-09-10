"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";

/**
 * TanStack Query owns the fetched Tasks — Zustand owns only what the person is
 * looking at (PLAN.md §12). Duplicating rows into a store would mean two caches
 * to reconcile on every mutation.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client would be
  // shared across requests during prerender.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Retrying a rejected token or a Task the Actor does not own just
            // spends three round trips arriving at the same answer.
            retry: (failureCount, error) =>
              error instanceof ApiError && error.status < 500
                ? false
                : failureCount < 2,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
