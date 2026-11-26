import { notifications } from "@mantine/notifications";
import { notifyError } from "./notify";

/** `show` ignores an id already on screen, so `hide` runs first. */
export function copyWithToast(text: string, id: string): void {
  navigator.clipboard.writeText(text).then(
    () => {
      notifications.hide(id);
      notifications.show({
        id,
        message: "Copied",
        color: "teal",
        autoClose: 1200,
        withCloseButton: false,
      });
    },
    (err: unknown) => {
      notifications.hide(id);
      notifyError(
        "Copy failed",
        err instanceof Error ? err.message : String(err),
        id,
      );
    },
  );
}
