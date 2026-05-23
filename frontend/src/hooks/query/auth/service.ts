import { apiBase } from '@/lib/config';
import { UserType } from '@/types/user';
import { IServerResponse, LoginRequest } from '@/types/api';

export const login = async (data: LoginRequest) => {
	const response = await apiBase.post<
		IServerResponse<{ user: UserType; accessToken: string }>
	>('/user/login', data);
	return response.data;
};

export const logout = async () => {
	const response = await apiBase.get<IServerResponse<null>>('/user/logout');
	return response.data;
};

export const getProfile = async () => {
	const response = await apiBase.get<IServerResponse<UserType>>('/user/me');
	return response.data;
};

export const register = async (data: any) => {
	const response = await apiBase.post<
		IServerResponse<{ user: UserType; accessToken: string }>
	>('/user', data);
	return response.data;
};
