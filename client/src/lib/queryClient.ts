import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

// VITE_API_BASE is set at build time for the Render-hosted backend.
// Falls back to __PORT_5000__ (replaced by deploy_website for proxy routing),
// then to "" (same-origin, used in local dev).
const RENDER_API = import.meta.env.VITE_API_BASE as string | undefined;
const PROXY_API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const API_BASE = RENDER_API || PROXY_API;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (data) headers["Content-Type"] = "application/json";
  // Attach Supabase session token if available
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
