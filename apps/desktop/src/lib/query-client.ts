import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 0,
    },
    queries: {
      gcTime: 1000 * 60 * 5,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: 3,
      staleTime: 1000 * 60,
    },
  },
});
