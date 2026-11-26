import { create } from "zustand";

interface ConnectionUIState {
  newConnectionOpen: boolean;
  openNewConnection: () => void;
  closeNewConnection: () => void;
}

export const useConnectionUI = create<ConnectionUIState>((set) => ({
  newConnectionOpen: false,
  openNewConnection: () => set({ newConnectionOpen: true }),
  closeNewConnection: () => set({ newConnectionOpen: false }),
}));
