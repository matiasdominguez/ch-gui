import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { mergeFunctionDocs, setFunctionDocs } from "../lib/chFunctions";
import { listFunctions } from "../lib/tauri";
import type {
  ConnectionConfigPayload,
  FunctionDoc,
  FunctionsResult,
} from "../types";

export function useChFunctions(
  payload: ConnectionConfigPayload | null,
  activeId: string | null,
): void {
  const [bundledFunctions, setBundledFunctions] = useState<
    FunctionDoc[] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    // Parsing this JSON during the initial load delays first paint enough that
    // WKWebView can leave the editor empty until a re-layout.
    import("../assets/ch-functions.json")
      .then((m) => {
        if (cancelled) return;
        setBundledFunctions(m.default as FunctionDoc[]);
      })
      .catch(() => {
        if (!cancelled) setBundledFunctions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectFunctions = useCallback(
    (r: FunctionsResult) => mergeFunctionDocs(r, bundledFunctions ?? []),
    [bundledFunctions],
  );
  const functionsQuery = useQuery({
    queryKey: ["ch_functions", activeId],
    queryFn: () => listFunctions(payload!),
    enabled: Boolean(payload && activeId && bundledFunctions !== null),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    select: selectFunctions,
  });
  useEffect(() => {
    if (bundledFunctions === null) return;
    setFunctionDocs(functionsQuery.data ?? bundledFunctions);
  }, [functionsQuery.data, bundledFunctions]);
}
