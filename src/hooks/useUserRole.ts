import { getApiUrl, getToken } from "@/config";
import { useQuery } from "@tanstack/react-query";

export type UserRole = 'admin' | 'member' | null;

export const useUserRole = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['user-role', userId],
    queryFn: async (): Promise<UserRole> => {
      if (!userId) return null;
      const token = getToken();
      if (!token) return null;
      try {
        const res = await fetch(`${getApiUrl()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return 'member';
        const data = await res.json();
        return (data.role as UserRole) ?? 'member';
      } catch {
        return 'member';
      }
    },
    enabled: !!userId,
  });
};
