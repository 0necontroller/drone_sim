// NOTE: This is just a template, you should update the types based on your project
import { create } from 'zustand';

interface UserStore {
	id: string;
	name: string;
	image: string;
	bio: string;
	preferences: {
		location: string;
		age: [number, number];
		body: string;
		bust: string;
	};
	stats: {
		balance: string;
		totalSpent: string;
	};
	email: string;
	phone: string;
	password: string;
	favourites: string[];
	lastLogin: Date;
	isLoggedIn: boolean;
	setBuyerDetails: (data: UpdateType) => void;
	removeFavourite: (id: string) => void;
	addFavourite: (id: string) => void;
	refreshData: () => void;
	logOut: () => void;
}

type UpdateType = {
	id: string;
	name: string;
	image: string;
	bio: string;
	preferences: {
		location: string;
		age: [number, number];
		body: string;
		bust: string;
	};
	stats: {
		balance: string;
		totalSpent: string;
	};
	email: string;
	phone: string;
	password: string;
	favourites: string[];
	lastLogin: Date;
};

export const useUserStore = create<UserStore>((set) => ({
	id: '',
	name: '',
	image: '',
	bio: '',
	preferences: {
		location: '',
		age: [18, 100],
		body: '',
		bust: ''
	},
	stats: {
		balance: '',
		totalSpent: ''
	},
	email: '',
	phone: '',
	password: '',
	favourites: [],
	lastLogin: new Date(),
	isLoggedIn: false,

	setBuyerDetails: (data: UpdateType) =>
		set({
			id: data.id,
			name: data.name,
			image: data.image,
			bio: data.bio,
			preferences: data.preferences,
			stats: data.stats,
			email: data.email,
			phone: data.phone,
			password: data.password,
			favourites: data.favourites,
			lastLogin: data.lastLogin,
			isLoggedIn: true
		}),
	removeFavourite: (id: string) => {
		set((state) => ({
			favourites: state.favourites.filter((favourite) => favourite !== id)
		}));
	},
	addFavourite: (id: string) => {
		set((state) => ({
			favourites: [...state.favourites, id]
		}));
	},
	refreshData: async () => {
		// This is a placeholder for the actual API call
		let response: any;

		if (!response) return;

		const user = response.data.user;
		set({
			id: user._id,
			name: user.name,
			image: user.image,
			bio: user.bio,
			preferences: user.preferences,
			stats: user.stats,
			email: user.email,
			phone: user.phone,
			password: user.password,
			favourites: user.favourites,
			lastLogin: user.lastLogin,
			isLoggedIn: true
		});
	},
	logOut: () => set({ isLoggedIn: false })
}));
