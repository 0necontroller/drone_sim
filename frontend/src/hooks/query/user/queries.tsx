import { useQuery } from '@tanstack/react-query';
import { UserService } from './service';
import { queryKeys } from '../keys';


/**
 * Hook to fetch any user by ID
 * @param id User ID
 */
export const useUserDetailQuery = (id: string) => {
	return useQuery({
		queryKey: ['user', 'detail', id],
		queryFn: () => UserService.getUser(id),
		enabled: !!id
	});
};

/**
 * Hook to fetch all users (Admin only)
 * @param page Page number
 * @param limit Items per page
 */
export const useAllUsersQuery = (page = 1, limit = 10) => {
	return useQuery({
		queryKey: [...queryKeys.user.all, { page, limit }],
		queryFn: () => UserService.getAllUsers(page, limit)
	});
};

/**
 * Hook to search for a user
 * @param type Search type ('email' | 'id')
 * @param term Search term
 */
export const useSearchUserQuery = (type: 'email' | 'id', term: string) => {
	return useQuery({
		queryKey: queryKeys.user.search(term),
		queryFn: () => UserService.searchUser(type, term),
		enabled: !!term
	});
};
