import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import "./theme/design.css";

import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { IconContext } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { cssVariablesResolver, iconDefaults, theme } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      networkMode: "always",
    },
  },
});

const colorSchemeManager = localStorageColorSchemeManager({
  key: "ch-gui-color-scheme",
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="dark"
      colorSchemeManager={colorSchemeManager}
    >
      <IconContext.Provider value={iconDefaults}>
        <QueryClientProvider client={queryClient}>
          <Notifications position="bottom-right" />
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </QueryClientProvider>
      </IconContext.Provider>
    </MantineProvider>
  </React.StrictMode>,
);
