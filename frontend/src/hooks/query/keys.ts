/** Centralised React Query key factory with example keys */
export const queryKeys = {
	auth: {
		user: ['auth', 'user'] as const
	},
	user: {
		me: ['user', 'me'] as const,
		all: ['user', 'all'] as const,
		search: (query: string) => ['user', 'search', query] as const
	}
};
