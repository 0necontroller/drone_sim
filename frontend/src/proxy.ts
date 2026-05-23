// Description : Middleware to authenticate some routes

// Change cookie-parser to your own cookie parser
import cookieParser from 'cookie-parser';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Change the type of the cookie to your own cookie type
type CookieType = {
	token: string;
	role: 'admin' | 'seller' | 'buyer';
};

export async function proxy(request: NextRequest) {
	const url = request.nextUrl.clone();
	const pathname = url.pathname;

	if (pathname.startsWith('/admin')) {
		const cookie = request.cookies.get('_myadmincookie');

		if (cookie) {
			const parsedCookie = cookieParser.JSONCookie(cookie.value) as CookieType;

			if (parsedCookie.role === 'admin') {
				return NextResponse.next();
			} else {
				url.pathname = '/auth/login';
				return NextResponse.redirect(url);
			}
		} else {
			url.pathname = '/auth/login';
			return NextResponse.redirect(url);
		}
	} else if (pathname.startsWith('/profile/s')) {
		const cookie = request.cookies.get('_myusercookie');

		if (cookie) {
			const parsedCookie = cookieParser.JSONCookie(cookie.value) as CookieType;

			if (parsedCookie.role === 'seller') {
				return NextResponse.next();
			} else {
				url.pathname = '/auth/login';
				return NextResponse.redirect(url);
			}
		} else {
			url.pathname = '/auth/login';
			return NextResponse.redirect(url);
		}
	} else if (pathname.startsWith('/profile/b')) {
		const cookie = request.cookies.get('_myusercookie');

		if (cookie) {
			const parsedCookie = cookieParser.JSONCookie(cookie.value) as CookieType;

			if (parsedCookie.role === 'buyer') {
				return NextResponse.next();
			} else {
				url.pathname = '/auth/login';
				return NextResponse.redirect(url);
			}
		} else {
			url.pathname = '/auth/login';
			return NextResponse.redirect(url);
		}
	}
}

// Change the matcher to your own routes
export const config = {
	matcher: ['/route1/:path*', '/route2/:path*']
};
