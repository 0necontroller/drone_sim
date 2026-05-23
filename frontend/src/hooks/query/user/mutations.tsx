import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserService } from './service';
import { queryKeys } from '../keys';
import { toast } from 'sonner';


/**
 * Mutation to update user profile details
 */
export const useUpdateProfileMutation = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: UserService.updateProfile,
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.user });
			toast.success(data.message || 'Profile updated successfully');
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.message || 'Error updating profile');
		}
	});
};

/**
 * Mutation to update user password
 */
export const useUpdatePasswordMutation = () => {
	return useMutation({
		mutationFn: UserService.updatePassword,
		onSuccess: (data) => {
			toast.success(data.message || 'Password updated successfully');
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.message || 'Error updating password');
		}
	});
};

/**
 * Mutation to update user phone number
 */
export const useUpdatePhoneMutation = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: UserService.updatePhone,
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.user });
			toast.success(data.message || 'Phone number updated successfully');
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.message || 'Error updating phone number');
		}
	});
};

/**
 * Mutation to delete a user (Admin only)
 */
export const useDeleteUserMutation = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: UserService.deleteUser,
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
			toast.success(data.message || 'User deleted successfully');
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.message || 'Error deleting user');
		}
	});
};
