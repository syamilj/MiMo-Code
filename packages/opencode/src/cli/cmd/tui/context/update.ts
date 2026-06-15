import { createContext, useContext } from "solid-js"
import type { Accessor } from "solid-js"
import type { UpdateStatus } from "../update"

export type UpdateContextValue = {
  status: Accessor<UpdateStatus>
}

export const UpdateContext = createContext<UpdateContextValue>()

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error("useUpdate must be used inside <UpdateContext.Provider>")
  return ctx
}
