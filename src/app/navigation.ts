import { createContext, useContext } from "react";

export type Route =
  | "tracker"
  | "timesheet"
  | "calendar"
  | "reports"
  | "projects"
  | "clients"
  | "tags"
  | "settings";

export interface NavigationValue {
  route: Route;
  navigate: (route: Route) => void;
  search: string;
  setSearch: (value: string) => void;
  requestNewEntry: (defaults?: { date?: string; projectId?: string; description?: string }) => void;
  focusSearch: () => void;
}

export const NavigationContext = createContext<NavigationValue | null>(null);

export function useNavigation(): NavigationValue {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation must be used inside NavigationContext");
  return context;
}
