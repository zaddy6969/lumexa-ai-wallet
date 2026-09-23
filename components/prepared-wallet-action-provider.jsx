import { useAccount } from "wagmi";
import { normalizePreparedWalletAction } from "../lib/wallet-copilot";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

const PreparedWalletActionContext = createContext(null);

export function PreparedWalletActionProvider({ children }) {
  const { address } = useAccount();
  const [storedAction, setPreparedActionState] = useState(null);

  const preparedAction = storedAction?.owner === address ? storedAction : null;
  const prepareAction = useCallback(
    (action) => {
      const validated = action?.tool ? normalizePreparedWalletAction(action) : null;
      if (!validated) return;
      setPreparedActionState({
        ...validated,
        owner: address,
        id: action.id || `${Date.now()}-${Math.random()}`
      });
    },
    [address]
  );

  const clearPreparedAction = useCallback((expectedId) => {
    setPreparedActionState((current) => {
      if (expectedId && current?.id !== expectedId) return current;
      return null;
    });
  }, []);

  const value = useMemo(
    () => ({ preparedAction, prepareAction, clearPreparedAction }),
    [clearPreparedAction, prepareAction, preparedAction]
  );

  return (
    <PreparedWalletActionContext.Provider value={value}>
      {children}
    </PreparedWalletActionContext.Provider>
  );
}

export function usePreparedWalletAction() {
  const context = useContext(PreparedWalletActionContext);
  if (!context) {
    throw new Error("usePreparedWalletAction must be used inside PreparedWalletActionProvider.");
  }
  return context;
}
