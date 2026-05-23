import { apiBase } from '@/lib/config';
import { IServerResponse } from '@/types/api';
import { UserType } from '@/types/user';

export const UserService = {
	getUser: async (id: string) => {
		const response = await apiBase.get<IServerResponse<UserType>>(
			`/user?id=${id}`
		);
		return response.data;
	},

	updateProfile: async (data: any) => {
		const response = await apiBase.put<IServerResponse<UserType>>(
			'/user',
			data
		);
		return response.data;
	},

	updatePassword: async (data: any) => {
		const response = await apiBase.put<IServerResponse<null>>(
			'/user/password',
			data
		);
		return response.data;
	},

	updatePhone: async (phone: string) => {
		const response = await apiBase.put<IServerResponse<{ phone: string }>>(
			'/user/phone',
			{ phone }
		);
		return response.data;
	},

	getAllUsers: async (page = 1, limit = 10) => {
		const response = await apiBase.get<
			IServerResponse<{ users: UserType[]; totalUsers: number; page: number }>
		>(`/user/all?page=${page}&limit=${limit}`);
		return response.data;
	},

	deleteUser: async (id: string) => {
		const response = await apiBase.delete<IServerResponse<null>>(
			`/user?id=${id}`
		);
		return response.data;
	},

	searchUser: async (type: 'email' | 'id', term: string) => {
		const response = await apiBase.get<IServerResponse<UserType>>(
			`/user/search?type=${type}&term=${term}`
		);
		return response.data;
	}
};
