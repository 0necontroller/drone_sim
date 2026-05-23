'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as authService from './service';
import { LoginRequest } from '@/types/api';
import { UserType } from '@/types/user';
import { Role } from '@/lib/auth/roles';

interface UseAuthReturn {
	user: UserType | undefined;
	isLoading: boolean;
	isAuthenticated: boolean;
	login: (credentials: LoginRequest) => Promise<void>;
	logout: () => Promise<void>;
	hasRole: (role: Role) => boolean;
	refetchUser: () => void;
}

/**
 * Custom hook for authentication and user management
 * Uses React Query for caching and state management
 */
export function useAuth(): UseAuthReturn {
	const router = useRouter();
	const queryClient = useQueryClient();

	// Query for current user
	const {
		data: user,
		isLoading,
		refetch: refetchUser
	} = useQuery({
		queryKey: ['auth', 'user'],
		queryFn: async () => {
			try {
				const response = await authService.getProfile();
				return response.data;
			} catch (error: any) {
				// If 401, user is not authenticated
				if (error.response?.status === 401) {
					return null;
				}
				throw error;
			}
		},
		staleTime: Infinity, // User data doesn't change often
		retry: false // Don't retry on auth failures
	});

	// Login mutation
	const loginMutation = useMutation({
		mutationFn: authService.login,
		onSuccess: (response) => {
			// Update user cache with logged-in user
			if (response.data) {
				queryClient.setQueryData(['auth', 'user'], response.data.user);

				// Redirect based on role
				const userRole = response.data.user.role;
				if (userRole === Role.SYSADMIN) {
					router.push('/admin');
				} else {
					router.push('/dashboard');
				}
			}
		},
		onError: (error: any) => {
			console.error('Login failed:', error);
			// Error will be handled by the component
		}
	});

	// Logout mutation
	const logoutMutation = useMutation({
		mutationFn: authService.logout,
		onSuccess: () => {
			// Clear all queries
			queryClient.clear();

			// Redirect to login
			router.push('/');
		},
		onError: (error: any) => {
			console.error('Logout failed:', error);
			// Even if logout fails, clear local state
			queryClient.clear();
			router.push('/');
		}
	});

	// Helper to check if user has a specific role
	const hasRole = (role: Role): boolean => {
		if (!user) return false;
		return user.role === role;
	};

	// Wrapper functions
	const login = async (credentials: LoginRequest) => {
		await loginMutation.mutateAsync(credentials);
	};

	const logout = async () => {
		await logoutMutation.mutateAsync();
	};

	return {
		user: user || undefined,
		isLoading,
		isAuthenticated: !!user,
		login,
		logout,
		hasRole,
		refetchUser
	};
}
