import { notifications } from "@mantine/notifications";

/** Mantine shows five toasts at once, so errors leave two slots free. */
const MAX_OPEN_ERRORS = 3;

/** A late onClose from a replaced toast must not drop its successor. */
const openErrors: { id: string; key: object }[] = [];

function forget(key: object) {
  const i = openErrors.findIndex((e) => e.key === key);
  if (i >= 0) openErrors.splice(i, 1);
}

export function notifyError(
  title: string,
  message: string,
  id = `error:${title}`,
) {
  const same = openErrors.find((e) => e.id === id);
  if (same) {
    forget(same.key);
    notifications.hide(id);
  }
  while (openErrors.length >= MAX_OPEN_ERRORS) {
    const oldest = openErrors.shift()!;
    notifications.hide(oldest.id);
  }
  const key = {};
  openErrors.push({ id, key });
  notifications.show({
    id,
    color: "red",
    title,
    message,
    autoClose: false,
    onClose: () => forget(key),
  });
}
