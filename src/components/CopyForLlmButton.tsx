import { Button, Tooltip } from "@mantine/core";
import { CopySimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { copyWithToast } from "../lib/clipboard";
import type { Versions } from "../lib/llmReport";
import { versionInfo } from "../lib/tauri";
import type { ConnectionConfigPayload } from "../types";

/** WebKit refuses clipboard writes after `await`, so copy synchronously. */
export function CopyForLlmButton({
  conn,
  report,
  tooltip,
  size = "compact-sm",
}: {
  conn: ConnectionConfigPayload;
  report: (v: Versions) => string;
  tooltip: string;
  size?: "compact-xs" | "compact-sm";
}) {
  const versions = useQuery({
    // These fields pick the server. The password stays out of the cache.
    queryKey: [
      "versionInfo",
      conn.id,
      conn.host,
      conn.port,
      conn.user,
      conn.secure,
      conn.default_database,
      conn.custom_ca_pem,
    ],
    queryFn: () => versionInfo(conn),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const known = versions.isFetching ? undefined : versions.data;
  return (
    <Tooltip label={tooltip} multiline w={240}>
      <Button
        size={size}
        variant="default"
        className="chg-copy-llm"
        leftSection={<CopySimpleIcon size={13} />}
        onClick={() => copyWithToast(report(known ?? {}), "llm-copy")}
      >
        Copy for LLM
      </Button>
    </Tooltip>
  );
}
