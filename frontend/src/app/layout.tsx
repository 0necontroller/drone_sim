import './globals.css';
import { DM_Sans } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { QueryProvider } from '@/hooks/query/query-provider';
import { Toaster } from 'sonner';
import {
	IconAlertTriangle,
	IconCheck,
	IconInfoCircle,
	IconLoader2,
	IconX
} from '@tabler/icons-react';
const dmSans = DM_Sans({
	subsets: ['latin'],
	display: 'swap',
	variable: '--font-dm-sans',
	weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900']
});

export const metadata: Metadata = {
	title: 'Autonomous Drones',
	description: 'Autonomous drones',
	metadataBase: new URL('https://autonomous-drones.vercel.app'),
	openGraph: {
		type: 'website',
		locale: 'en_US',
		url: '/',
		images: '/opengraph-image.png'
	},
	robots: {
		index: true,
		follow: true,
		nocache: true,
		googleBot: {
			'index': true,
			'follow': true,
			'noimageindex': false,
			'max-video-preview': -1,
			'max-image-preview': 'large',
			'max-snippet': -1
		}
	},
	keywords: ['Add', 'your', 'keywords', 'here'],
	category: 'Add your category here'
};
export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	maximumScale: 1
};

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className={dmSans.className}>
				<QueryProvider>{children}</QueryProvider>
				<Toaster
					position="top-center"
					richColors
					icons={{
						success: <IconCheck className="text-primary size-5" />,
						error: <IconX className="text-primary size-5" />,
						info: <IconInfoCircle className="text-primary size-5" />,
						warning: <IconAlertTriangle className="text-primary size-5" />,
						loading: (
							<IconLoader2 className="text-primary size-5 animate-spin" />
						)
					}}
					toastOptions={{
						className: '',
						duration: 2000
					}}
				/>
			</body>
		</html>
	);
}
