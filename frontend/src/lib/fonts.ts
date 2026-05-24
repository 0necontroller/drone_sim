import { Cormorant_Garamond, IBM_Plex_Sans } from 'next/font/google';

export const headingFont = Cormorant_Garamond({
	subsets: ['latin'],
	weight: ['400', '600', '700']
});

export const bodyFont = IBM_Plex_Sans({
	subsets: ['latin'],
	weight: ['300', '400', '500', '600']
});
