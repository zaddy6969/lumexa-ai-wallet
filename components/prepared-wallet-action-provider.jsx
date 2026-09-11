import { createContext, useCallback, useContext, useMemo, useState } from "react";

const PreparedWalletActionContext = createContext(null);

export function PreparedWalletActionProvider({ children }) {
  const [preparedAction, setPreparedActionState] = useState(null);

  const prepareAction = useCallback((action) => {
    if (!action?.tool) return;
    setPreparedActionState({
      ...action,
      id: action.id || `${Date.now()}-${Math.random()}`
    });
  }, []);

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
