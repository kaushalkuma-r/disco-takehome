"use client";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { supabase } from "./supabase";
import type { Catalog, CreditsInfo, Me, MutationResponse } from "./types";
import { ToastProvider } from "./ui";

type SessionState = { session: Session | null; loading: boolean };
const SessionCtx = createContext<SessionState>({ session: null, loading: true });

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } }));
  const [state, setState] = useState<SessionState>({ session: null, loading: true });
  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setState({ session, loading: false });
      if (!session) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);
  return (
    <QueryClientProvider client={qc}>
      <SessionCtx.Provider value={state}>
        <ToastProvider>{children}</ToastProvider>
      </SessionCtx.Provider>
    </QueryClientProvider>
  );
}

export const useSession = () => useContext(SessionCtx);

export function useMe() {
  const { session } = useSession();
  return useQuery<Me>({ queryKey: ["me"], queryFn: api.me, enabled: !!session });
}
export function useCatalog() {
  const { session } = useSession();
  return useQuery<Catalog>({ queryKey: ["catalog"], queryFn: api.catalog, enabled: !!session, staleTime: Infinity });
}
export function useCampaign(id: string | null) {
  const { session } = useSession();
  return useQuery<MutationResponse>({ queryKey: ["campaign", id], queryFn: () => api.campaign(id!), enabled: !!session && !!id });
}

/** Every mutating response carries the new balance; write it into the `me` cache so the pill updates instantly. */
export function useApplyResponse() {
  const qc = useQueryClient();
  return useMemo(() => ({
    campaign(resp: MutationResponse) {
      qc.setQueryData(["campaign", resp.campaign.id], resp);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["activity", resp.campaign.id] });
      this.credits(resp.credits);
    },
    credits(c: CreditsInfo) {
      qc.setQueryData<Me>(["me"], (old) => (old ? { ...old, credit_balance: c.balance } : old));
      qc.invalidateQueries({ queryKey: ["credits"] });
    },
    invalidate(key: string[]) { qc.invalidateQueries({ queryKey: key }); },
  }), [qc]);
}
