import { Button, Center, Code, Stack, Text } from "@mantine/core";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <Center h="100vh" p="md">
        <Stack gap="sm" align="center" maw={560}>
          <Text fw={600}>Something went wrong</Text>
          <Text size="sm" c="dimmed">
            Reload to continue. Your open tabs are saved.
          </Text>
          <Code block className="chg-code">
            {this.state.message}
          </Code>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Stack>
      </Center>
    );
  }
}
